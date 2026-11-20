import { useState, useEffect, useRef, useMemo } from "react";
import "./osi.css";

// ── Subnet math ───────────────────────────────────────────────────────────────
function ipToNum(ip) { return ip.split(".").reduce((a,o)=>(a<<8)+parseInt(o),0)>>>0; }
function numToIp(n)  { return [(n>>>24),(n>>>16)&255,(n>>>8)&255,n&255].join("."); }
function cidrToMask(c){ return numToIp((0xFFFFFFFF<<(32-c))>>>0); }
function parseCidr(str) {
  const m = str.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return null;
  const cidr = parseInt(m[2]);
  if (cidr < 1 || cidr > 30) return null;
  const maskN = (0xFFFFFFFF<<(32-cidr))>>>0;
  const netN  = ipToNum(m[1]) & maskN;
  const size  = Math.pow(2, 32-cidr);
  return {
    network:   numToIp(netN), cidr, mask: cidrToMask(cidr),
    broadcast: numToIp(netN+size-1),
    firstHost: numToIp(netN+1), lastHost: numToIp(netN+size-2),
    totalHosts: size-2,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const LC = {7:"#a78bfa",6:"#63b3ed",5:"#42d9b8",4:"#f2c36b",3:"#fb923c",2:"#e63946",1:"#94a3b8"};
const MACS = { pcA:"AA:BB:CC:11:22:33", pcB:"CC:DD:EE:44:55:66", rtrA:"DD:EE:FF:00:11:22", rtrB:"EE:FF:00:11:22:33" };
const LAYERS = [
  {num:7,name:"Application", pdu:"Data",    proto:"HTTP · DNS · FTP · SMTP"},
  {num:6,name:"Presentation",pdu:"Data",    proto:"TLS · SSL · ASCII · JSON"},
  {num:5,name:"Session",     pdu:"Data",    proto:"NetBIOS · RPC · SIP"},
  {num:4,name:"Transport",   pdu:"Segment", proto:"TCP · UDP"},
  {num:3,name:"Network",     pdu:"Packet",  proto:"IP · ICMP · OSPF"},
  {num:2,name:"Data Link",   pdu:"Frame",   proto:"Ethernet · Wi-Fi · ARP"},
  {num:1,name:"Physical",    pdu:"Bits",    proto:"Cat5e · Fiber · Wi-Fi"},
];
const HM = {
  APP:{layer:7,short:"HTTP Data"},PRES:{layer:6,short:"TLS Wrap"},SESS:{layer:5,short:"Session"},
  TCP:{layer:4,short:"TCP Header"},IP:{layer:3,short:"IP Header"},ETH:{layer:2,short:"Ethernet"},
  FCS:{layer:2,short:"FCS Trailer"},ETH2:{layer:2,short:"Ethernet*"},FCS2:{layer:2,short:"FCS Trailer"},
};
const ROUTER_AFTER = new Set(["router_fwd","transit_b","pcb_l1","pcb_l2","pcb_l3","pcb_l4","pcb_l5","pcb_l6","pcb_l7","done"]);

const DEFAULT_INPUT = {
  lanA: { cidr:"192.168.1.0/24", gatewayIp:"192.168.1.1", pcAIp:"192.168.1.10", vlanId:10 },
  lanB: { cidr:"192.168.2.0/24", gatewayIp:"192.168.2.1", pcBIp:"192.168.2.20", vlanId:20 },
  vlanEnabled: false,
};

// ── Validate a single IP against a subnet ─────────────────────────────────────
function validateIp(ipStr, si, ...otherIps) {
  if (!ipStr || !ipStr.match(/^\d{1,3}(\.\d{1,3}){3}$/))
    return { ok:false, msg:"Enter a valid IP (e.g. 192.168.1.1)" };
  const parts = ipStr.split(".").map(Number);
  if (parts.some(p=>p<0||p>255))
    return { ok:false, msg:"Each octet must be 0–255" };
  if (!si) return { ok:false, msg:"Fix the CIDR first" };
  const ipN  = ipToNum(ipStr);
  const netN = ipToNum(si.network);
  const bcN  = ipToNum(si.broadcast);
  if (ipN === netN) return { ok:false, msg:`${si.network} is the network address` };
  if (ipN === bcN)  return { ok:false, msg:`${si.broadcast} is the broadcast address` };
  if (ipN < netN || ipN > bcN) return { ok:false, msg:`Not in ${si.network}/${si.cidr}` };
  for (const other of otherIps) {
    if (other && ipStr === other) return { ok:false, msg:"Same IP as another device in this LAN" };
  }
  return { ok:true, msg:`In subnet · host ${ipN - netN}` };
}

// ── Build config from input ───────────────────────────────────────────────────
function buildCfg(input) {
  const siA = parseCidr(input.lanA.cidr) || parseCidr("192.168.1.0/24");
  const siB = parseCidr(input.lanB.cidr) || parseCidr("192.168.2.0/24");
  const vA  = validateIp(input.lanA.gatewayIp, siA);
  const vB  = validateIp(input.lanB.gatewayIp, siB);
  const gwA = vA.ok ? input.lanA.gatewayIp : siA.firstHost;
  const gwB = vB.ok ? input.lanB.gatewayIp : siB.firstHost;
  const vpA = validateIp(input.lanA.pcAIp, siA, gwA);
  const vpB = validateIp(input.lanB.pcBIp, siB, gwB);
  const pcAIp = vpA.ok ? input.lanA.pcAIp : numToIp(ipToNum(siA.network)+10);
  const pcBIp = vpB.ok ? input.lanB.pcBIp : numToIp(ipToNum(siB.network)+20);
  const lanA = { ...siA, gateway:gwA,
    dhcpStart: numToIp(ipToNum(siA.network)+2), dhcpEnd: siA.lastHost,
    vlan: input.vlanEnabled ? (parseInt(input.lanA.vlanId)||10) : null };
  const lanB = { ...siB, gateway:gwB,
    dhcpStart: numToIp(ipToNum(siB.network)+2), dhcpEnd: siB.lastHost,
    vlan: input.vlanEnabled ? (parseInt(input.lanB.vlanId)||20) : null };
  return {
    lanA, lanB,
    pcA:  { ip:pcAIp,  mac:MACS.pcA, mask:siA.mask, cidr:siA.cidr, gw:gwA },
    pcB:  { ip:pcBIp,  mac:MACS.pcB, mask:siB.mask, cidr:siB.cidr, gw:gwB },
    router:{ lanAIp:gwA, lanAMac:MACS.rtrA, lanBIp:gwB, lanBMac:MACS.rtrB },
    vlanEnabled: input.vlanEnabled,
  };
}

// ── Build HF (header fields) with dynamic IPs ─────────────────────────────────
function buildHF(cfg) {
  const {pcA:a, pcB:b, router:r, lanA, lanB, vlanEnabled} = cfg;
  const vlanA = vlanEnabled ? [{f:"TPID",v:"0x8100 (802.1Q)"},{f:"VLAN ID",v:`${lanA.vlan}  (LAN-A)`},{f:"Priority",v:"0 (Best Effort)"}] : [];
  const vlanB = vlanEnabled ? [{f:"TPID",v:"0x8100 (802.1Q)"},{f:"VLAN ID",v:`${lanB.vlan}  (LAN-B)`},{f:"Priority",v:"0 (Best Effort)"}] : [];
  return {
    APP:  [{f:"Method",v:"GET"},{f:"Path",v:"/index.html"},{f:"HTTP Version",v:"HTTP/1.1"},{f:"Host",v:b.ip},{f:"Accept",v:"text/html"},{f:"Connection",v:"keep-alive"}],
    PRES: [{f:"Protocol",v:"TLS 1.3"},{f:"Content-Type",v:"0x17 (Application Data)"},{f:"Cipher",v:"AES-256-GCM"},{f:"Integrity",v:"HMAC-SHA-256"}],
    SESS: [{f:"Session-ID",v:"0xA4F2B1C3"},{f:"State",v:"ESTABLISHED"},{f:"Mode",v:"Full-duplex"}],
    TCP:  [{f:"Src Port",v:"54231 (ephemeral)"},{f:"Dst Port",v:"80 (HTTP)"},{f:"Seq Number",v:"1"},{f:"Ack Number",v:"0"},{f:"Header Len",v:"20 bytes"},{f:"Flags",v:"[ SYN ]"},{f:"Window",v:"65535 bytes"},{f:"Checksum",v:"0x4A2F"}],
    IP:   [{f:"Version",v:"4 (IPv4)"},{f:"Header Len",v:"20 bytes"},{f:"TTL",v:"64"},{f:"Protocol",v:"6 (TCP)"},{f:"Src IP",v:a.ip},{f:"Dst IP",v:b.ip},{f:"Checksum",v:"0x8A4B"}],
    IP_R: [{f:"Version",v:"4 (IPv4)"},{f:"Header Len",v:"20 bytes"},{f:"TTL",v:"63  ← decremented by router"},{f:"Protocol",v:"6 (TCP)"},{f:"Src IP",v:`${a.ip}  (unchanged)`},{f:"Dst IP",v:`${b.ip}  (unchanged)`},{f:"Checksum",v:"0x8A4C  (recalculated)"}],
    ETH:  [{f:"Dst MAC",v:MACS.rtrA},{f:"Dst Host",v:"Router (LAN-A port)"},{f:"Src MAC",v:MACS.pcA},{f:"Src Host",v:"PC-A"},...vlanA,{f:"EtherType",v:"0x0800 (IPv4)"}],
    FCS:  [{f:"Algorithm",v:"CRC-32"},{f:"Value",v:"0x1A2B3C4D"},{f:"Purpose",v:"Bit-error detection"}],
    ETH2: [{f:"Dst MAC",v:MACS.pcB},{f:"Dst Host",v:"PC-B"},{f:"Src MAC",v:MACS.rtrB},{f:"Src Host",v:"Router (LAN-B port)"},...vlanB,{f:"EtherType",v:"0x0800 (IPv4)"},{f:"Note",v:"New header added by router"}],
    FCS2: [{f:"Algorithm",v:"CRC-32"},{f:"Value",v:"0x9E8D7C6B"},{f:"Purpose",v:"Bit-error detection"}],
  };
}

// ── Build DEVICES with dynamic IPs ────────────────────────────────────────────
function buildDevices(cfg) {
  const {pcA:a,pcB:b,router:r,lanA,lanB,vlanEnabled} = cfg;
  return {
    A:{ name:"PC-A", type:"End Device", rows:[
      {k:"IP Address",     v:`${a.ip} / ${a.cidr}`},
      {k:"Subnet Mask",    v:a.mask},
      {k:"MAC Address",    v:MACS.pcA},
      {k:"Default Gateway",v:a.gw},
      {k:"DHCP Server",    v:`${a.gw}  (Router)`},
      {k:"DNS Server",     v:"8.8.8.8  (Google DNS)"},
      {k:"Network",        v:`${lanA.network}/${lanA.cidr}  (LAN-A)`},
      ...(vlanEnabled?[{k:"VLAN",v:`${lanA.vlan}  (Access port)`}]:[]),
    ]},
    B:{ name:"PC-B", type:"End Device / Web Server", rows:[
      {k:"IP Address",     v:`${b.ip} / ${b.cidr}`},
      {k:"Subnet Mask",    v:b.mask},
      {k:"MAC Address",    v:MACS.pcB},
      {k:"Default Gateway",v:b.gw},
      {k:"DHCP Server",    v:`${b.gw}  (Router)`},
      {k:"DNS Server",     v:"8.8.8.8  (Google DNS)"},
      {k:"Network",        v:`${lanB.network}/${lanB.cidr}  (LAN-B)`},
      {k:"Listening On",   v:"TCP port 80  (HTTP)"},
      ...(vlanEnabled?[{k:"VLAN",v:`${lanB.vlan}  (Access port)`}]:[]),
    ]},
    router:{ name:"Router", type:"Layer 3 Device", rows:[
      {k:"LAN-A IP",       v:`${r.lanAIp} / ${lanA.cidr}`},
      {k:"LAN-A MAC",      v:MACS.rtrA},
      {k:"LAN-B IP",       v:`${r.lanBIp} / ${lanB.cidr}`},
      {k:"LAN-B MAC",      v:MACS.rtrB},
      {k:"DHCP Pool A",    v:`${lanA.dhcpStart} – ${lanA.dhcpEnd}`},
      {k:"DHCP Pool B",    v:`${lanB.dhcpStart} – ${lanB.dhcpEnd}`},
      {k:"DNS Forwarding", v:"8.8.8.8"},
      {k:"Routing",        v:"Connected + Static routes"},
    ]},
    switchA:{ name:"Switch (LAN-A)", type:"Layer 2 Device", rows:[
      {k:"Type",           v:`${vlanEnabled?"Managed (VLAN-aware)":"Unmanaged"} L2 Switch`},
      {k:"IP Address",     v:"None  (not required)"},
      {k:"Operates At",    v:"OSI Layer 2 (Data Link)"},
      {k:"Forwards By",    v:"Destination MAC address"},
      {k:"Ports",          v:"24× Gigabit Ethernet"},
      ...(vlanEnabled?[{k:"VLAN",v:`VLAN ${lanA.vlan} on access ports`}]:[]),
    ]},
    switchB:{ name:"Switch (LAN-B)", type:"Layer 2 Device", rows:[
      {k:"Type",           v:`${vlanEnabled?"Managed (VLAN-aware)":"Unmanaged"} L2 Switch`},
      {k:"IP Address",     v:"None  (not required)"},
      {k:"Operates At",    v:"OSI Layer 2 (Data Link)"},
      {k:"Forwards By",    v:"Destination MAC address"},
      {k:"Ports",          v:"24× Gigabit Ethernet"},
      ...(vlanEnabled?[{k:"VLAN",v:`VLAN ${lanB.vlan} on access ports`}]:[]),
    ]},
  };
}

// ── Dynamic proto blocks (override STEPS.proto when IPs/MACs needed) ──────────
function getProto(id, cfg) {
  const {pcA:a,pcB:b,router:r,lanA,lanB,vlanEnabled} = cfg;
  const vA = vlanEnabled ? `  VLAN:${lanA.vlan}` : "";
  const vB = vlanEnabled ? `  VLAN:${lanB.vlan}` : "";
  const map = {
    router_init:
`eth0 (LAN-A): ${r.lanAIp}/${lanA.cidr}  → UP
eth1 (LAN-B): ${r.lanBIp}/${lanB.cidr}  → UP
DHCP server:  listening on eth0 and eth1
Routing:      ${lanA.network}/${lanA.cidr} via eth0  [Connected]
              ${lanB.network}/${lanB.cidr} via eth1  [Connected]
LLDP:         Hello frames broadcast on all ports`,
    pca_dhcp:
`→ DHCP Discover  src:0.0.0.0        dst:255.255.255.255
← DHCP Offer    src:${r.lanAIp}   dst:255.255.255.255
→ DHCP Request  src:0.0.0.0        dst:255.255.255.255
← DHCP Ack      src:${r.lanAIp}   dst:${a.ip}

PC-A: ${a.ip}/${lanA.cidr}  GW:${r.lanAIp}  DNS:8.8.8.8`,
    pcb_dhcp:
`→ DHCP Discover  src:0.0.0.0        dst:255.255.255.255
← DHCP Offer    src:${r.lanBIp}   dst:255.255.255.255
→ DHCP Request  src:0.0.0.0        dst:255.255.255.255
← DHCP Ack      src:${r.lanBIp}   dst:${b.ip}

PC-B: ${b.ip}/${lanB.cidr}  GW:${r.lanBIp}  DNS:8.8.8.8`,
    pca_arp_gw:
`→ ARP Request  broadcast: Who has ${r.lanAIp}?  Tell ${a.ip}
← ARP Reply    ${MACS.rtrA}: I have ${r.lanAIp}!

PC-A ARP cache: ${r.lanAIp} → ${MACS.rtrA}  (Router LAN-A)`,
    pca_l7: `HTTP  GET /index.html HTTP/1.1\n      Host: ${b.ip}`,
    pca_l3: `IP  src:${a.ip}  dst:${b.ip}  TTL:64  proto:TCP`,
    pca_l2:
`ETH  src:${MACS.pcA}  dst:${MACS.rtrA}${vA}  +FCS
(router MAC already in ARP cache from boot phase)`,
    router_rx: `Router strips ETH header + FCS  →  reads IP dst: ${b.ip}`,
    router_fwd: `New ETH  src:${MACS.rtrB}  dst:${MACS.pcB}${vB}  IP TTL:63`,
  };
  return map[id] ?? null;
}

// ── Build per-device boot logs (dynamic IPs in details) ───────────────────────
function buildBootLogs(cfg) {
  const {pcA:a,pcB:b,router:r,lanA,lanB} = cfg;
  return {
    router:[
      {stepId:null,          t:"0.00s",icon:"⚡",event:"Power on",           detail:"Firmware loading"},
      {stepId:"router_init", t:"0.30s",icon:"🔌",event:"eth0 UP (LAN-A)",   detail:`${r.lanAIp}/${lanA.cidr} assigned`},
      {stepId:"router_init", t:"0.30s",icon:"🔌",event:"eth1 UP (LAN-B)",   detail:`${r.lanBIp}/${lanB.cidr} assigned`},
      {stepId:"router_init", t:"0.50s",icon:"🗺", event:"Routing table built",detail:`${lanA.network}/${lanA.cidr}, ${lanB.network}/${lanB.cidr}`},
      {stepId:"router_init", t:"0.60s",icon:"📡",event:"DHCP server started",detail:`Pools on both LANs`},
      {stepId:"router_init", t:"0.70s",icon:"📢",event:"LLDP Hello sent",   detail:"Announced on all ports"},
      {stepId:"router_init", t:"1.00s",icon:"✅",event:"Ready",             detail:"Forwarding enabled"},
    ],
    switchA:[
      {stepId:null,          t:" 0.0s",icon:"⚡",event:"Power on",          detail:"24 ports initialized"},
      {stepId:"switch_init", t:" 0.1s",icon:"📢",event:"STP BPDU sent",    detail:"Bridge ID broadcast on all ports"},
      {stepId:"switch_init", t:" 0.5s",icon:"👂",event:"STP Listening",    detail:"No superior BPDU received"},
      {stepId:"switch_init", t:"15.0s",icon:"📖",event:"STP Learning",     detail:"Populating MAC table"},
      {stepId:"switch_init", t:"30.0s",icon:"✅",event:"STP Forwarding",   detail:"All ports active"},
      {stepId:"pca_dhcp",    t:"30+s", icon:"📋",event:"MAC table updated", detail:`${MACS.pcA.slice(0,8)}... learned on Fa0/1`},
    ],
    switchB:[
      {stepId:null,          t:" 0.0s",icon:"⚡",event:"Power on",          detail:"24 ports initialized"},
      {stepId:"switch_init", t:" 0.1s",icon:"📢",event:"STP BPDU sent",    detail:"Bridge ID broadcast on all ports"},
      {stepId:"switch_init", t:" 0.5s",icon:"👂",event:"STP Listening",    detail:"No superior BPDU received"},
      {stepId:"switch_init", t:"15.0s",icon:"📖",event:"STP Learning",     detail:"Populating MAC table"},
      {stepId:"switch_init", t:"30.0s",icon:"✅",event:"STP Forwarding",   detail:"All ports active"},
      {stepId:"pcb_dhcp",    t:"30+s", icon:"📋",event:"MAC table updated", detail:`${MACS.pcB.slice(0,8)}... learned on Fa0/1`},
    ],
    A:[
      {stepId:null,          t:"0.00s",icon:"⚡",event:"NIC powered on",   detail:"eth0 link up (1 Gbps)"},
      {stepId:"pca_dhcp",    t:"0.10s",icon:"📡",event:"DHCP Discover",    detail:"Broadcast → 255.255.255.255"},
      {stepId:"pca_dhcp",    t:"0.20s",icon:"📨",event:"DHCP Offer",       detail:`${r.lanAIp} offers ${a.ip}/${lanA.cidr}`},
      {stepId:"pca_dhcp",    t:"0.25s",icon:"📤",event:"DHCP Request",     detail:`Requesting ${a.ip}`},
      {stepId:"pca_dhcp",    t:"0.30s",icon:"✉", event:"DHCP Ack",         detail:`IP:${a.ip} GW:${a.gw} DNS:8.8.8.8`},
      {stepId:"pca_arp_gw",  t:"0.40s",icon:"❓",event:"ARP for gateway",  detail:`Who has ${a.gw}? (broadcast)`},
      {stepId:"pca_arp_gw",  t:"0.45s",icon:"💡",event:"ARP Reply",        detail:`${MACS.rtrA} → cached as GW`},
      {stepId:"pca_arp_gw",  t:"0.50s",icon:"✅",event:"Ready",            detail:"Network stack fully configured"},
    ],
    B:[
      {stepId:null,          t:"0.00s",icon:"⚡",event:"NIC powered on",   detail:"eth0 link up (1 Gbps)"},
      {stepId:"pcb_dhcp",    t:"0.10s",icon:"📡",event:"DHCP Discover",    detail:"Broadcast → 255.255.255.255"},
      {stepId:"pcb_dhcp",    t:"0.20s",icon:"📨",event:"DHCP Offer",       detail:`${r.lanBIp} offers ${b.ip}/${lanB.cidr}`},
      {stepId:"pcb_dhcp",    t:"0.25s",icon:"📤",event:"DHCP Request",     detail:`Requesting ${b.ip}`},
      {stepId:"pcb_dhcp",    t:"0.30s",icon:"✉", event:"DHCP Ack",         detail:`IP:${b.ip} GW:${b.gw} DNS:8.8.8.8`},
      {stepId:"pcb_dhcp",    t:"0.40s",icon:"❓",event:"ARP for gateway",  detail:`Who has ${b.gw}? (broadcast)`},
      {stepId:"pcb_dhcp",    t:"0.45s",icon:"💡",event:"ARP Reply",        detail:`${MACS.rtrB} → cached as GW`},
      {stepId:"pcb_dhcp",    t:"0.50s",icon:"✅",event:"Ready",            detail:"Network stack fully configured"},
    ],
  };
}

// ── Simulation steps (IPs removed from desc — shown in proto blocks) ───────────
const STEPS = [
  // ═══ Boot Phase ══════════════════════════════════════
  {id:"net_boot",   phase:"boot",  title:"Network initialization — before any data flows",
   desc:"Every device on the network must boot and discover each other before PC-A can send a single packet. The sequence is: Router initializes → Switches run STP → PCs get IPs via DHCP → PCs ARP for their gateway. Click any device in the diagram to inspect its internal tables at any step.",
   side:null, layer:null, headers:[], pos:0},

  {id:"router_init",phase:"boot",  title:"Router powers on — initializes interfaces and services",
   desc:"The router's firmware loads. Both LAN-A and LAN-B interfaces come up. The routing table is populated with connected routes. The DHCP server starts listening on both interfaces. The router sends LLDP Hello frames out each port to announce itself to neighbours.",
   side:"router", layer:null, headers:[], pos:0.5},

  {id:"switch_init",phase:"boot",  title:"Switches power on — STP runs, MAC tables are empty",
   desc:"Both switches power on with empty MAC address tables. Each switch floods STP BPDUs (Bridge Protocol Data Units) out every port to elect a Root Bridge and prevent layer-2 loops. After STP converges (~30 s), all ports enter Forwarding state. MAC tables are still empty — switches will learn as frames pass through.",
   proto:"STP: BPDU broadcast on all ports\nSTP: Root Bridge elected (lowest Bridge ID wins)\nAll ports: Listening → Learning → Forwarding\nMAC tables: EMPTY — will learn from live traffic",
   side:null, layer:null, headers:[], pos:0.3},

  {id:"pca_dhcp",   phase:"boot",  title:"PC-A gets its IP address via DHCP",
   desc:"PC-A's NIC comes up with no IP address. It broadcasts a DHCP Discover to find any DHCP server. The switch floods the broadcast to all ports — the router receives it. The router replies with a DHCP Offer: an IP address, subnet mask, gateway, and DNS server. PC-A sends a DHCP Request to accept, and the router sends a DHCP Ack. The switch learns PC-A's MAC from these frames.",
   side:"A", layer:null, headers:[], pos:0},

  {id:"pcb_dhcp",   phase:"boot",  title:"PC-B gets its IP address via DHCP",
   desc:"PC-B performs the identical DHCP process on LAN-B. It broadcasts a DHCP Discover, the router's DHCP server on eth1 responds with a DHCP Offer containing PC-B's IP, subnet mask, and gateway. After the full four-step handshake (Discover → Offer → Request → Ack), PC-B is configured and the LAN-B switch learns PC-B's MAC.",
   side:"B", layer:null, headers:[], pos:1},

  {id:"pca_arp_gw", phase:"boot",  title:"PC-A resolves the router MAC via ARP",
   desc:"PC-A wants to reach PC-B (a different subnet), so it must forward to its default gateway. PC-A knows the gateway IP from DHCP but not its MAC address. It broadcasts an ARP Request on LAN-A. The router replies with its MAC. PC-A caches the router's MAC and can now build Ethernet frames with the correct destination MAC for all off-LAN traffic.",
   side:"A", layer:null, headers:[], pos:0},

  // ═══ HTTP Phase ═══════════════════════════════════════
  {id:"start",      phase:"http",  title:"Network ready — PC-A opens browser to reach PC-B",
   desc:"The network is fully initialized. PC-A opens a browser and enters PC-B's IP address — the web server. The browser will generate an HTTP GET request that must travel through all 7 OSI layers, across two LANs via the router, to reach PC-B. Press Next to watch encapsulation happen layer by layer.",
   side:null, layer:null, headers:[], pos:0},

  {id:"pca_l7",     phase:"http",  title:"Layer 7 · Application — PC-A",
   desc:"The browser creates an HTTP GET request. This is the raw payload — just the message the application wants to send. No network addressing exists yet.",
   side:"A", layer:7, headers:["APP"], pos:0},

  {id:"pca_l6",     phase:"http",  title:"Layer 6 · Presentation — PC-A",
   desc:"The data is formatted and encoded. If using HTTPS, TLS encryption wraps the payload here so only the intended recipient can decrypt it.",
   proto:"TLS encrypt → [encrypted ciphertext]",
   side:"A", layer:6, headers:["PRES","APP"], pos:0},

  {id:"pca_l5",     phase:"http",  title:"Layer 5 · Session — PC-A",
   desc:"A session is opened between the two applications. The session layer tracks the conversation and handles synchronisation checkpoints.",
   proto:"Session-ID: 0xA4F2B1C3  →  ESTABLISHED",
   side:"A", layer:5, headers:["SESS","PRES","APP"], pos:0},

  {id:"pca_l4",     phase:"http",  title:"Layer 4 · Transport — PC-A",
   desc:"TCP adds a header with source port 54231 and destination port 80 (HTTP). It sequences the data and guarantees delivery — lost segments are automatically retransmitted.",
   proto:"TCP  src:54231  dst:80  seq:1  ack:0  [SYN]",
   side:"A", layer:4, headers:["TCP","SESS","PRES","APP"], pos:0},

  {id:"pca_l3",     phase:"http",  title:"Layer 3 · Network — PC-A",
   desc:"The IP layer adds the source IP (PC-A) and destination IP (PC-B). TTL is set to 64 — it decrements at each router hop to prevent packets looping forever.",
   side:"A", layer:3, headers:["IP","TCP","SESS","PRES","APP"], pos:0},

  {id:"pca_l2",     phase:"http",  title:"Layer 2 · Data Link — PC-A",
   desc:"PC-B is on a different network, so the frame must go to the router first. PC-A already has the router's MAC in its ARP cache. An Ethernet frame is built with the router MAC as destination.",
   side:"A", layer:2, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0},

  {id:"pca_l1",     phase:"http",  title:"Layer 1 · Physical — PC-A",
   desc:"The frame is converted to electrical signals. The physical layer puts bits on the wire at 1 Gbps.",
   proto:"10101100 00010000 ... (bits on Cat5e Gigabit Ethernet)",
   side:"A", layer:1, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0},

  {id:"transit_a",  phase:"http",  title:"Crossing LAN-A — Switch forwards the frame",
   desc:"The LAN-A switch reads the destination MAC, looks it up in its MAC address table, and forwards the frame out the correct port toward the router. Switches are Layer 2 — they never look at IP addresses.",
   side:"transit_a", layer:null, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0.3},

  {id:"router_rx",  phase:"http",  title:"Router — strips Layer 2, reads Layer 3",
   desc:"The router's LAN-A interface receives the frame. It checks the destination MAC (matches its own), verifies the FCS, strips the Ethernet header and trailer, and reads the destination IP to decide where to forward. PC-A's MAC is now in the router's ARP table.",
   side:"router", layer:null, headers:["IP","TCP","SESS","PRES","APP"], pos:0.5},

  {id:"router_fwd", phase:"http",  title:"Router — routing decision + re-encapsulation",
   desc:"The routing table shows the destination is reachable on LAN-B. TTL is decremented (64→63). The router sends an ARP request on LAN-B to learn PC-B's MAC, then builds a brand-new Ethernet frame with new L2 headers.",
   side:"router", layer:null, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:0.5},

  {id:"transit_b",  phase:"http",  title:"Crossing LAN-B — Switch delivers to PC-B",
   desc:"The LAN-B switch reads the destination MAC (PC-B's) and forwards the frame out the correct port.",
   side:"transit_b", layer:null, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:0.7},

  {id:"pcb_l1",     phase:"http",  title:"Layer 1 · Physical — PC-B",
   desc:"PC-B's NIC detects the electrical signals and reconstructs the bit stream.",
   side:"B", layer:1, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:1},

  {id:"pcb_l2",     phase:"http",  title:"Layer 2 · Data Link — PC-B",
   desc:"PC-B checks the destination MAC — it matches its own NIC. The FCS is verified. The Ethernet header and FCS trailer are stripped.",
   side:"B", layer:2, headers:["IP","TCP","SESS","PRES","APP"], pos:1},

  {id:"pcb_l3",     phase:"http",  title:"Layer 3 · Network — PC-B",
   desc:"The IP layer reads the destination IP — it matches PC-B's own IP. The TTL (63) confirms exactly one router hop. The IP header is stripped.",
   side:"B", layer:3, headers:["TCP","SESS","PRES","APP"], pos:1},

  {id:"pcb_l4",     phase:"http",  title:"Layer 4 · Transport — PC-B",
   desc:"TCP reads the destination port (80) and delivers the segment to the web server process. A TCP ACK is queued.",
   side:"B", layer:4, headers:["SESS","PRES","APP"], pos:1},

  {id:"pcb_l5",     phase:"http",  title:"Layer 5 · Session — PC-B",
   desc:"The session ID (0xA4F2B1C3) is matched to this conversation.",
   side:"B", layer:5, headers:["PRES","APP"], pos:1},

  {id:"pcb_l6",     phase:"http",  title:"Layer 6 · Presentation — PC-B",
   desc:"TLS decrypts the payload using the shared session keys. The data is decoded back into the format the application expects.",
   side:"B", layer:6, headers:["APP"], pos:1},

  {id:"pcb_l7",     phase:"http",  title:"Layer 7 · Application — PC-B",
   desc:"The web server application receives the HTTP GET request and sends back an HTTP 200 OK response.",
   proto:"HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html>...",
   side:"B", layer:7, headers:[], pos:1},

  {id:"done",       phase:"http",  title:"Delivery complete!",
   desc:"Key insight: IP addresses (Layer 3) stay the same end-to-end — they identify source and final destination. MAC addresses (Layer 2) change at every hop — they only matter on the current network segment. The router is the boundary: it reads L3 to route, re-writes L2 to deliver.",
   side:null, layer:null, headers:[], pos:1},
];

// ── State helpers ─────────────────────────────────────────────────────────────
function stepAtOrPast(si, id) {
  const target = STEPS.findIndex(s => s.id === id);
  return target !== -1 && si >= target;
}

function getArpState(si, cfg) {
  return {
    router: [
      stepAtOrPast(si,"router_rx")  && {ip:cfg.pcA.ip, mac:MACS.pcA, iface:"LAN-A"},
      stepAtOrPast(si,"router_fwd") && {ip:cfg.pcB.ip, mac:MACS.pcB, iface:"LAN-B"},
    ].filter(Boolean),
    pcA: stepAtOrPast(si,"pca_arp_gw") ? [{ip:cfg.router.lanAIp, mac:MACS.rtrA, host:"Router LAN-A"}] : [],
    pcB: stepAtOrPast(si,"pcb_l2")     ? [{ip:cfg.router.lanBIp, mac:MACS.rtrB, host:"Router LAN-B"}] : [],
  };
}
function getDhcpLeases(si, cfg) {
  return [
    stepAtOrPast(si,"pca_dhcp") && {ip:cfg.pcA.ip, mac:MACS.pcA, host:"PC-A", iface:"LAN-A", lease:"24h"},
    stepAtOrPast(si,"pcb_dhcp") && {ip:cfg.pcB.ip, mac:MACS.pcB, host:"PC-B", iface:"LAN-B", lease:"24h"},
  ].filter(Boolean);
}
function getSwitchAMac(si, cfg) {
  if (!stepAtOrPast(si,"pca_dhcp")) return [];
  const vlan = cfg.vlanEnabled ? cfg.lanA.vlan : 1;
  return [
    {mac:MACS.pcA,  port:"Fa0/1",  host:"PC-A",          vlan, type:"Dynamic"},
    {mac:MACS.rtrA, port:"Fa0/24", host:"Router (LAN-A)", vlan, type:"Dynamic"},
  ];
}
function getSwitchBMac(si, cfg) {
  if (!stepAtOrPast(si,"pcb_dhcp")) return [];
  const vlan = cfg.vlanEnabled ? cfg.lanB.vlan : 1;
  return [
    {mac:MACS.pcB,  port:"Fa0/1",  host:"PC-B",          vlan, type:"Dynamic"},
    {mac:MACS.rtrB, port:"Fa0/24", host:"Router (LAN-B)", vlan, type:"Dynamic"},
  ];
}
function getRouterRoutes(cfg) {
  return [
    {dst:`${cfg.lanA.network}/${cfg.lanA.cidr}`, nh:"0.0.0.0 (direct)", iface:"LAN-A (eth0)", type:"C"},
    {dst:`${cfg.lanB.network}/${cfg.lanB.cidr}`, nh:"0.0.0.0 (direct)", iface:"LAN-B (eth1)", type:"C"},
    {dst:"0.0.0.0/0", nh:"ISP gateway", iface:"WAN", type:"S*"},
  ];
}
function getPcRoutes(side, si, cfg) {
  if (!stepAtOrPast(si, side==="A"?"pca_dhcp":"pcb_dhcp")) return [];
  return side==="A"
    ? [{dst:`${cfg.lanA.network}/${cfg.lanA.cidr}`,nh:"0.0.0.0 (direct)",iface:"eth0",type:"C"},{dst:"0.0.0.0/0",nh:cfg.router.lanAIp,iface:"eth0",type:"default"}]
    : [{dst:`${cfg.lanB.network}/${cfg.lanB.cidr}`,nh:"0.0.0.0 (direct)",iface:"eth0",type:"C"},{dst:"0.0.0.0/0",nh:cfg.router.lanBIp,iface:"eth0",type:"default"}];
}

// ── Network Config Panel ──────────────────────────────────────────────────────
function IpField({ label, value, onChange, validation, placeholder }) {
  return (
    <label className="osi-cfg-label">
      {label}
      <div className="osi-cfg-iprow">
        <input className={`osi-cfg-input${validation && !validation.ok ? " osi-cfg-input-err" : ""}`}
          value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
        {validation && (
          <span className={`osi-cfg-ipstatus ${validation.ok?"osi-cfg-ipok":"osi-cfg-iperr"}`}>
            {validation.ok ? "✓" : "✗"} {validation.msg}
          </span>
        )}
      </div>
    </label>
  );
}

function LanBlock({ title, color, cidr, onCidr, gatewayIp, onGateway, pcIp, onPc, pcLabel, vlanEnabled, vlanId, onVlanId, si }) {
  const vGw = si ? validateIp(gatewayIp, si)                 : null;
  const vPc = si ? validateIp(pcIp, si, gatewayIp)          : null;
  return (
    <div className="osi-cfg-lan">
      <div className="osi-cfg-lanhead" style={{color}}>{title}</div>

      <label className="osi-cfg-label">Network / CIDR
        <input className="osi-cfg-input" value={cidr} onChange={e=>onCidr(e.target.value)} placeholder="192.168.1.0/24"/>
        {si
          ? <span className="osi-cfg-preview">{si.mask} · {si.totalHosts} hosts · {si.firstHost}–{si.lastHost}</span>
          : <span className="osi-cfg-err">Invalid CIDR (e.g. 192.168.1.0/24, /8–/30)</span>}
      </label>

      <IpField label="Router / Gateway IP" value={gatewayIp} onChange={onGateway}
        placeholder={si?.firstHost||"192.168.1.1"} validation={si ? vGw : null}/>

      <IpField label={`${pcLabel} IP`} value={pcIp} onChange={onPc}
        placeholder={si ? numToIp(ipToNum(si.network)+10) : "192.168.1.10"} validation={si ? vPc : null}/>

      {vlanEnabled && (
        <label className="osi-cfg-label">VLAN ID
          <input className="osi-cfg-input osi-cfg-short" type="number" min="1" max="4094"
            value={vlanId} onChange={e=>onVlanId(e.target.value)}/>
        </label>
      )}
    </div>
  );
}

function NetworkConfigPanel({ draft, setDraft, onApply, onReset, onClose }) {
  function setLanA(key, val) { setDraft(d=>({...d, lanA:{...d.lanA, [key]:val}})); }
  function setLanB(key, val) { setDraft(d=>({...d, lanB:{...d.lanB, [key]:val}})); }

  const siA = parseCidr(draft.lanA.cidr);
  const siB = parseCidr(draft.lanB.cidr);
  const vGwA = siA ? validateIp(draft.lanA.gatewayIp, siA) : null;
  const vGwB = siB ? validateIp(draft.lanB.gatewayIp, siB) : null;
  const vPcA = siA ? validateIp(draft.lanA.pcAIp, siA, draft.lanA.gatewayIp) : null;
  const vPcB = siB ? validateIp(draft.lanB.pcBIp, siB, draft.lanB.gatewayIp) : null;
  const canApply = siA && siB && vGwA?.ok && vGwB?.ok && vPcA?.ok && vPcB?.ok;

  return (
    <div className="osi-cfg-panel">
      <div className="osi-cfg-panelhead">
        <span>⚙ Network Configuration</span>
        <button className="osi-cfg-close" onClick={onClose}>✕</button>
      </div>
      <div className="osi-cfg-grid">
        <LanBlock title="LAN-A" color="#63b3ed" si={siA}
          cidr={draft.lanA.cidr}       onCidr={v=>setLanA("cidr",v)}
          gatewayIp={draft.lanA.gatewayIp} onGateway={v=>setLanA("gatewayIp",v)}
          pcIp={draft.lanA.pcAIp}      onPc={v=>setLanA("pcAIp",v)}
          pcLabel="PC-A"
          vlanEnabled={draft.vlanEnabled} vlanId={draft.lanA.vlanId} onVlanId={v=>setLanA("vlanId",v)}/>
        <LanBlock title="LAN-B" color="#42d9b8" si={siB}
          cidr={draft.lanB.cidr}       onCidr={v=>setLanB("cidr",v)}
          gatewayIp={draft.lanB.gatewayIp} onGateway={v=>setLanB("gatewayIp",v)}
          pcIp={draft.lanB.pcBIp}      onPc={v=>setLanB("pcBIp",v)}
          pcLabel="PC-B"
          vlanEnabled={draft.vlanEnabled} vlanId={draft.lanB.vlanId} onVlanId={v=>setLanB("vlanId",v)}/>
      </div>
      <div className="osi-cfg-opts">
        <label className="osi-cfg-toggle">
          <input type="checkbox" checked={draft.vlanEnabled}
            onChange={e=>setDraft(d=>({...d,vlanEnabled:e.target.checked}))}/>
          <span>Enable 802.1Q VLANs</span>
          {draft.vlanEnabled && <span className="osi-cfg-vlan-badge">VLAN</span>}
        </label>
      </div>
      <div className="osi-cfg-actions">
        <button className="osi-cfg-apply" disabled={!canApply} onClick={onApply}>Apply — restart simulation</button>
        <button className="osi-cfg-reset" onClick={onReset}>Reset to default</button>
      </div>
      {!canApply && <p className="osi-cfg-warn">Fix the highlighted errors above before applying.</p>}
    </div>
  );
}

// ── Topology Diagram ──────────────────────────────────────────────────────────
function TopologyDiagram({ pos, activeSide, selectedDevice, onSelectDevice, cfg }) {
  const {pcA:a, pcB:b, router:r, lanA, lanB, vlanEnabled} = cfg;
  const nodes = [
    {x:85,  label:"PC-A",   ip:a.ip,            mac:MACS.pcA,  key:"A",       shape:"pc"},
    {x:255, label:"Switch", ip:"No IP  (L2)",    mac:"",        key:"switchA", shape:"sw"},
    {x:445, label:"Router", ip:`${r.lanAIp}/${r.lanBIp}`, mac:"DD:.. / EE:..", key:"router", shape:"rt"},
    {x:635, label:"Switch", ip:"No IP  (L2)",    mac:"",        key:"switchB", shape:"sw"},
    {x:815, label:"PC-B",   ip:b.ip,            mac:MACS.pcB,  key:"B",       shape:"pc"},
  ];
  const isActive   = k => activeSide===k||(activeSide==="transit_a"&&k==="switchA")||(activeSide==="transit_b"&&k==="switchB");
  const isSelected = k => selectedDevice===k;
  const dotX = 85 + pos * (815 - 85);
  const lanALabel = `LAN-A · ${lanA.network}/${lanA.cidr}${vlanEnabled?`  · VLAN ${lanA.vlan}`:"  · DHCP: "+lanA.gateway}  ·  DNS: 8.8.8.8`;
  const lanBLabel = `LAN-B · ${lanB.network}/${lanB.cidr}${vlanEnabled?`  · VLAN ${lanB.vlan}`:"  · DHCP: "+lanB.gateway}  ·  DNS: 8.8.8.8`;

  return (
    <div className="osi-topo-wrap">
      <p className="osi-topo-hint">↑ Click any device to inspect its internal tables and boot log</p>
      <svg viewBox="0 0 900 162" className="osi-topo-svg">
        <rect x="6"   y="18" width="344" height="122" rx="12" fill="rgba(99,179,237,0.05)" stroke="rgba(99,179,237,0.2)" strokeWidth="1"/>
        <text x="16"  y="31" fontSize="9" fill="#63b3ed" fontFamily="'JetBrains Mono',monospace" fontWeight="600" letterSpacing="0.4">{lanALabel}</text>
        {vlanEnabled && <rect x="12" y="34" width="88" height="10" rx="3" fill="rgba(99,179,237,0.15)" stroke="rgba(99,179,237,0.4)" strokeWidth="0.5"/>}
        {vlanEnabled && <text x="56" y="41" fontSize="7" fill="#63b3ed" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontWeight="700">VLAN {lanA.vlan}</text>}
        <rect x="550" y="18" width="344" height="122" rx="12" fill="rgba(66,217,184,0.05)" stroke="rgba(66,217,184,0.2)" strokeWidth="1"/>
        <text x="560" y="31" fontSize="9" fill="#42d9b8" fontFamily="'JetBrains Mono',monospace" fontWeight="600" letterSpacing="0.4">{lanBLabel}</text>
        {vlanEnabled && <rect x="556" y="34" width="88" height="10" rx="3" fill="rgba(66,217,184,0.15)" stroke="rgba(66,217,184,0.4)" strokeWidth="0.5"/>}
        {vlanEnabled && <text x="600" y="41" fontSize="7" fill="#42d9b8" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontWeight="700">VLAN {lanB.vlan}</text>}
        <rect x="378" y="30" width="134" height="100" rx="10" fill="rgba(251,146,60,0.05)" stroke="rgba(251,146,60,0.25)" strokeWidth="1"/>
        <line x1="85" y1="78" x2="815" y2="78" stroke="rgba(255,255,255,0.1)" strokeWidth="2"/>
        {nodes.map(n => {
          const active = isActive(n.key), selected = isSelected(n.key);
          const c   = selected?"#f2c36b":active?"#42d9b8":"rgba(255,255,255,0.28)";
          const bg  = selected?"rgba(242,195,107,0.14)":active?"rgba(66,217,184,0.14)":"rgba(13,19,30,0.95)";
          const sw  = selected||active?2.5:1;
          return (
            <g key={n.key} style={{cursor:"pointer"}} onClick={()=>onSelectDevice(selected?null:n.key)}>
              {selected&&<circle cx={n.x} cy={78} r={35} fill="none" stroke="rgba(242,195,107,0.35)" strokeWidth="1.5" strokeDasharray="4 3"/>}
              <circle cx={n.x} cy={78} r={28} fill={bg} stroke={c} strokeWidth={sw}/>
              {n.shape==="pc"&&<>
                <rect x={n.x-11} y={64} width={22} height={15} rx={2} fill="none" stroke={c} strokeWidth={1.5}/>
                <line x1={n.x-7} y1={79} x2={n.x+7} y2={79} stroke={c} strokeWidth={1.5}/>
                <line x1={n.x-5} y1={82} x2={n.x+5} y2={82} stroke={c} strokeWidth={1}/>
              </>}
              {n.shape==="rt"&&<polygon points={`${n.x},51 ${n.x+18},78 ${n.x},105 ${n.x-18},78`} fill="none" stroke={c} strokeWidth={1.5}/>}
              {n.shape==="sw"&&<>
                <rect x={n.x-14} y={67} width={28} height={19} rx={2} fill="none" stroke={c} strokeWidth={1.5}/>
                {[-8,-2,4,10].map(dx=><line key={dx} x1={n.x+dx} y1={67} x2={n.x+dx} y2={61} stroke={c} strokeWidth={1}/>)}
              </>}
              <text x={n.x} y={114} textAnchor="middle" fontSize="10" fontWeight={active||selected?"700":"500"} fill={selected?"#f2c36b":active?"#42d9b8":"rgba(241,245,249,0.8)"} fontFamily="Inter,sans-serif">{n.label}</text>
              <text x={n.x} y={126} textAnchor="middle" fontSize="8" fill={active||selected?"rgba(241,245,249,0.7)":"rgba(241,245,249,0.42)"} fontFamily="'JetBrains Mono',monospace">{n.ip}</text>
              {n.mac&&<text x={n.x} y={137} textAnchor="middle" fontSize="7.5" fill="rgba(241,245,249,0.26)" fontFamily="'JetBrains Mono',monospace">{n.mac.slice(0,17)}</text>}
            </g>
          );
        })}
        <g style={{transform:`translateX(${dotX-85}px)`,transition:"transform 0.5s ease-in-out"}}>
          <circle cx={85} cy={78} r={14} fill="rgba(66,217,184,0.12)"/>
          <circle cx={85} cy={78} r={8}  fill="rgba(66,217,184,0.35)"/>
          <circle cx={85} cy={78} r={4}  fill="#42d9b8"/>
        </g>
      </svg>
    </div>
  );
}

// ── Device Inspector with tabs ────────────────────────────────────────────────
function DiTable({ cols, rows, empty }) {
  if (!rows.length) return <p className="osi-di-empty">{empty}</p>;
  return (
    <table className="osi-di-tbl">
      <thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r,i)=><tr key={i}>{r.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}

function BootLogTab({ deviceKey, si, bootLogs }) {
  const logs = bootLogs[deviceKey] || [];
  return (
    <div className="osi-bootlog">
      {logs.map((entry, i) => {
        const done = entry.stepId === null ? si >= 0 : stepAtOrPast(si, entry.stepId);
        return (
          <div key={i} className={`osi-bl-row ${done?"osi-bl-done":"osi-bl-pending"}`}>
            <span className="osi-bl-time">{entry.t}</span>
            <span className="osi-bl-icon">{entry.icon}</span>
            <div className="osi-bl-content">
              <span className="osi-bl-event">{entry.event}</span>
              <span className="osi-bl-detail">{entry.detail}</span>
            </div>
          </div>
        );
      })}
      {!logs.length && <p className="osi-di-empty">No boot log for this device</p>}
    </div>
  );
}

function DeviceInspector({ deviceKey, si, cfg, DEVICES, bootLogs, onClose }) {
  const [tab, setTab] = useState("tables");
  const arp = getArpState(si, cfg);
  const dev = DEVICES[deviceKey];
  const routerUp = stepAtOrPast(si,"router_init");
  const switchUp = stepAtOrPast(si,"switch_init");
  const cfgA     = stepAtOrPast(si,"pca_dhcp");
  const cfgB     = stepAtOrPast(si,"pcb_dhcp");

  return (
    <div className="osi-di">
      <div className="osi-di-hdr">
        <div>
          <span className="osi-di-name">{dev?.name||deviceKey}</span>
          <span className="osi-di-type">{dev?.type}</span>
        </div>
        <button className="osi-di-close" onClick={onClose}>✕ Close</button>
      </div>
      <div className="osi-di-tabs">
        <button className={`osi-di-tab${tab==="tables"?" osi-di-tab-active":""}`} onClick={()=>setTab("tables")}>📊 Tables</button>
        <button className={`osi-di-tab${tab==="bootlog"?" osi-di-tab-active":""}`} onClick={()=>setTab("bootlog")}>🔌 Boot Log</button>
      </div>

      {tab==="bootlog" && <BootLogTab deviceKey={deviceKey} si={si} bootLogs={bootLogs}/>}

      {tab==="tables" && <div className="osi-di-body">
        {/* PC-A */}
        {deviceKey==="A"&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">Network Configuration</div>
            {cfgA
              ? <DiTable cols={["Parameter","Value"]} rows={DEVICES.A.rows.map(r=>[r.k,r.v])} empty=""/>
              : <p className="osi-di-empty">Not yet configured — DHCP has not completed</p>}
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">ARP Cache</div>
            <DiTable cols={["IP Address","MAC Address","Host"]} rows={arp.pcA.map(r=>[r.ip,r.mac,r.host])} empty="Empty — ARP not yet resolved"/>
            <div className="osi-di-section" style={{marginTop:14}}>Routing Table</div>
            <DiTable cols={["Destination","Next Hop","Interface","Type"]} rows={getPcRoutes("A",si,cfg).map(r=>[r.dst,r.nh,r.iface,r.type])} empty="No routes — waiting for DHCP"/>
          </div>
        </>}
        {/* PC-B */}
        {deviceKey==="B"&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">Network Configuration</div>
            {cfgB
              ? <DiTable cols={["Parameter","Value"]} rows={DEVICES.B.rows.map(r=>[r.k,r.v])} empty=""/>
              : <p className="osi-di-empty">Not yet configured — DHCP has not completed</p>}
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">ARP Cache</div>
            <DiTable cols={["IP Address","MAC Address","Host"]} rows={arp.pcB.map(r=>[r.ip,r.mac,r.host])} empty="Empty — ARP not yet resolved"/>
            <div className="osi-di-section" style={{marginTop:14}}>Routing Table</div>
            <DiTable cols={["Destination","Next Hop","Interface","Type"]} rows={getPcRoutes("B",si,cfg).map(r=>[r.dst,r.nh,r.iface,r.type])} empty="No routes — waiting for DHCP"/>
          </div>
        </>}
        {/* Router */}
        {deviceKey==="router"&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">Routing Table</div>
            {routerUp
              ? <DiTable cols={["Destination","Next Hop","Interface","Type"]} rows={getRouterRoutes(cfg).map(r=>[r.dst,r.nh,r.iface,r.type])} empty=""/>
              : <p className="osi-di-empty">Router not yet initialized</p>}
            <div className="osi-di-section" style={{marginTop:14}}>Interfaces</div>
            <DiTable cols={["Interface","IP","MAC","State"]}
              rows={routerUp?[
                ["LAN-A (eth0)",`${cfg.router.lanAIp}/${cfg.lanA.cidr}`,MACS.rtrA,"UP"],
                ["LAN-B (eth1)",`${cfg.router.lanBIp}/${cfg.lanB.cidr}`,MACS.rtrB,"UP"],
              ]:[]} empty="Interfaces down"/>
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">ARP Table</div>
            <DiTable cols={["IP Address","MAC Address","Interface"]} rows={arp.router.map(r=>[r.ip,r.mac,r.iface])} empty="Empty — no frames received yet"/>
            <div className="osi-di-section" style={{marginTop:14}}>DHCP Leases</div>
            <DiTable cols={["IP","MAC","Host","Interface","Lease"]} rows={getDhcpLeases(si,cfg).map(r=>[r.ip,r.mac,r.host,r.iface,r.lease])} empty="No leases yet"/>
          </div>
        </>}
        {/* Switch-A */}
        {deviceKey==="switchA"&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">MAC Address Table</div>
            <DiTable cols={["MAC Address","Port","Host","VLAN","Type"]}
              rows={getSwitchAMac(si,cfg).map(r=>[r.mac,r.port,r.host,r.vlan,r.type])}
              empty={switchUp?"Empty — no traffic yet":"Switch not initialized"}/>
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">STP / Port State</div>
            <DiTable cols={["Property","Value"]} rows={switchUp?[
              ["Role","Root Bridge"],["All ports","Forwarding"],
              ["BPDU","Sent during boot"],["IP Address","None (L2 only)"],
              ["Unknown frames","Flooded to all ports"],["Broadcast","Flooded to all ports"],
              ...(cfg.vlanEnabled?[["VLAN mode",`Access, VLAN ${cfg.lanA.vlan}`]]:[]),
            ]:[["Status","Not initialized"]]} empty=""/>
          </div>
        </>}
        {/* Switch-B */}
        {deviceKey==="switchB"&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">MAC Address Table</div>
            <DiTable cols={["MAC Address","Port","Host","VLAN","Type"]}
              rows={getSwitchBMac(si,cfg).map(r=>[r.mac,r.port,r.host,r.vlan,r.type])}
              empty={switchUp?"Empty — no traffic yet":"Switch not initialized"}/>
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">STP / Port State</div>
            <DiTable cols={["Property","Value"]} rows={switchUp?[
              ["Role","Root Bridge"],["All ports","Forwarding"],
              ["BPDU","Sent during boot"],["IP Address","None (L2 only)"],
              ["Unknown frames","Flooded to all ports"],["Broadcast","Flooded to all ports"],
              ...(cfg.vlanEnabled?[["VLAN mode",`Access, VLAN ${cfg.lanB.vlan}`]]:[]),
            ]:[["Status","Not initialized"]]} empty=""/>
          </div>
        </>}
      </div>}
    </div>
  );
}

// ── Layer Stack ───────────────────────────────────────────────────────────────
function LayerStack({ side, getState, cfg }) {
  const ip = side==="A" ? cfg.pcA.ip : cfg.pcB.ip;
  return (
    <div className="osi-stack">
      <div className="osi-stack-head">
        <span className="osi-stack-pc">{side==="A"?"PC-A":"PC-B"}</span>
        <span className="osi-stack-ip">{ip}</span>
      </div>
      <div className="osi-stack-layers">
        {LAYERS.map(l=>{
          const st=getState(l.num);
          return (
            <div key={l.num} className={`osi-layer osi-layer-${st}`} style={{"--lc":LC[l.num]}}>
              <span className="osi-ln">{l.num}</span>
              <div className="osi-layer-body">
                <span className="osi-layer-name">{l.name}</span>
                <span className="osi-layer-pdu">{l.pdu}</span>
              </div>
              {st==="done"   && <span className="osi-check">✓</span>}
              {st==="active" && <span className="osi-pulse"/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Packet Inspector ──────────────────────────────────────────────────────────
function PacketInspector({ headers, activeLayer, stepId, HF }) {
  const [open,setOpen] = useState(null);
  const getHF = key => key==="IP"&&ROUTER_AFTER.has(stepId)?HF.IP_R:(HF[key]||[]);

  useEffect(()=>{
    const target=headers.find(h=>HM[h]?.layer===activeLayer)||headers[0]||null;
    setOpen(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[stepId]);

  const isBoot    = STEPS.find(s=>s.id===stepId)?.phase==="boot";
  const isRouter  = stepId==="router_rx"||stepId==="router_fwd";
  const isTransit = stepId==="transit_a"||stepId==="transit_b";
  const label = isRouter?"🔄 Router Processing":isTransit?"📡 In Transit":isBoot&&!headers.length?"🔌 Control Traffic":"📦 Packet Inspector";

  return (
    <div className="osi-inspector">
      <div className="osi-inspector-label">{label}</div>
      {!headers.length && (
        <div className="osi-inspector-empty">
          {stepId==="done"?"Payload delivered to application layer":isBoot?"No data frame — this is network control traffic (DHCP, ARP, STP BPDUs)":"No headers yet — waiting for encapsulation"}
        </div>
      )}
      {headers.map((h,i)=>{
        const meta=HM[h]; const lc=LC[meta.layer];
        const isOpen=open===h; const isActive=meta.layer===activeLayer;
        const fields=getHF(h);
        return (
          <div key={`${h}${i}`} className={`osi-ihdr${isActive?" osi-ihdr-active":""}`} style={{"--hc":lc}}>
            <button className="osi-ihdr-btn" onClick={()=>setOpen(isOpen?null:h)}>
              <span className="osi-ihdr-arrow">{isOpen?"▼":"▶"}</span>
              <span className="osi-ihdr-badge">L{meta.layer}</span>
              <span className="osi-ihdr-name">{meta.short}</span>
              <span className="osi-ihdr-layer">{LAYERS.find(l=>l.num===meta.layer)?.name}</span>
              {isActive&&<span className="osi-ihdr-new">← added now</span>}
            </button>
            {isOpen&&(
              <div className="osi-ihdr-fields">
                {fields.map((f,j)=>(
                  <div key={j} className="osi-ifield">
                    <span className="osi-ifield-k">{f.f}</span>
                    <span className="osi-ifield-v">{f.v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Device Config Panel (bottom-left default) ─────────────────────────────────
function DevicePanel({ activeSide, DEVICES }) {
  const key = activeSide==="A"?"A":activeSide==="B"?"B":activeSide==="router"?"router":
              activeSide==="transit_a"||activeSide==="switchA"?"switchA":
              activeSide==="transit_b"||activeSide==="switchB"?"switchB":null;
  const dev = key ? DEVICES[key] : null;
  return (
    <div className="osi-devpanel">
      <div className="osi-devpanel-title">{dev?`${dev.name}  —  ${dev.type}`:"Network Devices"}</div>
      {dev
        ? <table className="osi-devtable"><tbody>
            {dev.rows.map((r,i)=><tr key={i}><td className="osi-devtable-k">{r.k}</td><td className="osi-devtable-v">{r.v}</td></tr>)}
          </tbody></table>
        : <div className="osi-devpanel-hint">Step through the simulation to inspect each device. Click a device in the diagram to see its full tables and boot log.</div>}
    </div>
  );
}

// ── ARP Panel ─────────────────────────────────────────────────────────────────
function ArpPanel({ si, activeSide, cfg }) {
  const arp = getArpState(si, cfg);
  const showPcA=activeSide==="A", showPcB=activeSide==="B";
  const table = showPcA?arp.pcA:showPcB?arp.pcB:arp.router;
  const title = showPcA?"PC-A ARP Cache":showPcB?"PC-B ARP Cache":"Router ARP Table";
  const cols  = showPcA||showPcB?["IP Address","MAC Address","Host"]:["IP Address","MAC Address","Interface"];
  return (
    <div className="osi-arppanel">
      <div className="osi-arppanel-title">{title}</div>
      {!table.length
        ? <div className="osi-arppanel-empty">{showPcA||showPcB?"ARP cache empty":"ARP table empty"}</div>
        : <table className="osi-arptable">
            <thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
            <tbody>{table.map((r,i)=>(
              <tr key={i}>
                <td className="osi-arp-ip">{r.ip}</td>
                <td className="osi-arp-mac">{r.mac}</td>
                <td className="osi-arp-iface">{r.iface||r.host}</td>
              </tr>
            ))}</tbody>
          </table>}
      <div className="osi-arppanel-note">
        {!showPcA&&!showPcB&&"Router learns MAC addresses by inspecting frames it receives"}
        {showPcA&&"PC-A learns router MAC via ARP before sending off-LAN frames"}
        {showPcB&&"PC-B learns router MAC from frames it receives"}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function OSIExplorer() {
  const [inputCfg, setInputCfg] = useState(DEFAULT_INPUT);
  const [draft,    setDraft]    = useState(DEFAULT_INPUT);
  const [showCfg,  setShowCfg]  = useState(false);
  const [step,     setStep]     = useState(0);
  const [playing,  setPlaying]  = useState(false);
  const [selDev,   setSelDev]   = useState(null);
  const timer = useRef(null);

  const cfg      = useMemo(()=>buildCfg(inputCfg),   [inputCfg]);
  const HF       = useMemo(()=>buildHF(cfg),          [cfg]);
  const DEVICES  = useMemo(()=>buildDevices(cfg),     [cfg]);
  const bootLogs = useMemo(()=>buildBootLogs(cfg),    [cfg]);
  const cur = STEPS[step];

  function applyConfig() {
    setInputCfg(draft);
    setStep(0);
    setPlaying(false);
    setSelDev(null);
    setShowCfg(false);
  }
  function resetConfig() {
    setDraft(DEFAULT_INPUT);
    setInputCfg(DEFAULT_INPUT);
    setStep(0);
    setPlaying(false);
    setSelDev(null);
  }

  useEffect(()=>{
    if (playing) {
      timer.current=setInterval(()=>{
        setStep(s=>{if(s>=STEPS.length-1){setPlaying(false);return s;}return s+1;});
      },3000);
    }
    return ()=>clearInterval(timer.current);
  },[playing]);

  useEffect(()=>{
    const fn=e=>{
      if(e.key==="ArrowRight"){setPlaying(false);setStep(s=>Math.min(STEPS.length-1,s+1));}
      if(e.key==="ArrowLeft") {setPlaying(false);setStep(s=>Math.max(0,s-1));}
    };
    window.addEventListener("keydown",fn);
    return ()=>window.removeEventListener("keydown",fn);
  },[]);

  const getStateA = n => {
    if(cur.side==="A"&&cur.layer===n) return "active";
    const idx=STEPS.findIndex(s=>s.id===`pca_l${n}`);
    return idx!==-1&&step>idx?"done":"pending";
  };
  const getStateB = n => {
    if(cur.side==="B"&&cur.layer===n) return "active";
    const idx=STEPS.findIndex(s=>s.id===`pcb_l${n}`);
    return idx!==-1&&step>idx?"done":"pending";
  };

  const proto = getProto(cur.id, cfg) ?? cur.proto;
  const pct = Math.round((step/(STEPS.length-1))*100);

  return (
    <div className="osi-shell">
      <header className="osi-header">
        <div className="osi-brand">
          <div className="osi-logo-mark">OSI</div>
          <div>
            <h1>Layer Explorer</h1>
            <p>Trace an HTTP connection from PC to PC through every layer</p>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button className={`osi-cfg-btn${showCfg?" osi-cfg-btn-active":""}`}
            onClick={()=>{ setDraft(inputCfg); setShowCfg(v=>!v); }}>
            ⚙ Configure
          </button>
          <a href="/" className="osi-back">← Portfolio</a>
        </div>
      </header>

      {showCfg && (
        <NetworkConfigPanel
          draft={draft} setDraft={setDraft}
          onApply={applyConfig} onReset={resetConfig}
          onClose={()=>setShowCfg(false)}
        />
      )}

      <main className="osi-main">
        <TopologyDiagram pos={cur.pos} activeSide={cur.side} selectedDevice={selDev}
          onSelectDevice={setSelDev} cfg={cfg}/>

        {selDev && <DeviceInspector deviceKey={selDev} si={step} cfg={cfg}
          DEVICES={DEVICES} bootLogs={bootLogs} onClose={()=>setSelDev(null)}/>}

        <div className="osi-mid">
          <LayerStack side="A" getState={getStateA} cfg={cfg}/>
          <PacketInspector headers={cur.headers} activeLayer={cur.layer} stepId={cur.id} HF={HF}/>
          <LayerStack side="B" getState={getStateB} cfg={cfg}/>
        </div>

        {!selDev && (
          <div className="osi-details">
            <DevicePanel activeSide={cur.side} DEVICES={DEVICES}/>
            <ArpPanel si={step} activeSide={cur.side} cfg={cfg}/>
          </div>
        )}

        <div className="osi-info">
          <div className="osi-info-top">
            <span className="osi-step-badge">Step {step+1} / {STEPS.length}</span>
            {cfg.vlanEnabled && <span className="osi-sbadge osi-sbadge-vlan">802.1Q VLAN</span>}
            {cur.phase==="boot" && <span className="osi-sbadge osi-sbadge-boot">🔌 Boot Phase</span>}
            {cur.phase==="http"&&cur.side==="A"&&<span className="osi-sbadge osi-sbadge-a">PC-A encapsulating ↓</span>}
            {cur.phase==="http"&&cur.side==="B"&&<span className="osi-sbadge osi-sbadge-b">PC-B decapsulating ↑</span>}
            {cur.side==="router"&&<span className="osi-sbadge osi-sbadge-r">Router processing</span>}
            {(cur.side==="transit_a"||cur.side==="transit_b")&&<span className="osi-sbadge osi-sbadge-t">In transit</span>}
          </div>
          <h2 className="osi-info-title">{cur.title}</h2>
          <p  className="osi-info-desc">{cur.desc}</p>
          {proto && <pre className="osi-proto-block">{proto}</pre>}
        </div>

        <div className="osi-pbar-wrap"><div className="osi-pbar" style={{width:pct+"%"}}/></div>

        <div className="osi-controls">
          <button className="osi-btn" onClick={()=>{setPlaying(false);setStep(s=>Math.max(0,s-1));}} disabled={step===0}>← Prev</button>
          <span className="osi-step-count">{step+1} / {STEPS.length}</span>
          <button className="osi-btn osi-btn-play" onClick={()=>setPlaying(p=>!p)}>
            {playing?"⏸ Pause":"▶ Auto-play"}
          </button>
          <button className="osi-btn" onClick={()=>{setPlaying(false);setStep(s=>Math.min(STEPS.length-1,s+1));}} disabled={step===STEPS.length-1}>Next →</button>
        </div>
        <p className="osi-kbd-hint">← → arrow keys to step through</p>

        <section className="osi-ref">
          <h3>OSI Layer Quick Reference</h3>
          <div className="osi-ref-grid">
            {LAYERS.map(l=>(
              <div key={l.num} className="osi-ref-row" style={{"--lc":LC[l.num]}}>
                <span className="osi-ref-num">{l.num}</span>
                <span className="osi-ref-name">{l.name}</span>
                <span className="osi-ref-pdu">{l.pdu}</span>
                <span className="osi-ref-proto">{l.proto}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="osi-footer">
        <span>OSI Layer Explorer · Nelson Tan</span>
        <a href="https://github.com/woshiniaoshen" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}
