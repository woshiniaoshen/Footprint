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
const MACS = { rtrA:"DD:EE:FF:00:11:22", rtrB:"EE:FF:00:11:22:33" };
const MAC_POOL_A = ["AA:BB:CC:11:22:33","AA:BB:CC:11:22:44","AA:BB:CC:11:22:55","AA:BB:CC:11:22:66"];
const MAC_POOL_B = ["CC:DD:EE:44:55:66","CC:DD:EE:44:55:77","CC:DD:EE:44:55:88","CC:DD:EE:44:55:99"];
const PC_NAMES_A = ["PC-A","PC-C","PC-E","PC-G"];
const PC_NAMES_B = ["PC-B","PC-D","PC-F","PC-H"];
const PC_KEYS_A  = ["A","A2","A3","A4"];
const PC_KEYS_B  = ["B","B2","B3","B4"];
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

const VLAN_COLORS_A = ["#63b3ed","#f2c36b","#a78bfa"];
const VLAN_COLORS_B = ["#42d9b8","#fb923c","#f472b6"];
const MAX_EXTRA_VLANS = 2;

const DEFAULT_INPUT = {
  lanA: { cidr:"192.168.1.0/24", gatewayIp:"192.168.1.1", pcs:[{ip:"192.168.1.10",vlan:0}], vlanId:10, extraVlans:[] },
  lanB: { cidr:"192.168.2.0/24", gatewayIp:"192.168.2.1", pcs:[{ip:"192.168.2.20",vlan:0}], vlanId:20, extraVlans:[] },
  vlanEnabled: false,
};

function subnetsOverlap(a, b) {
  return ipToNum(a.network) <= ipToNum(b.broadcast) && ipToNum(b.network) <= ipToNum(a.broadcast);
}

function validateVlanId(v, usedIds) {
  const s = String(v ?? "").trim();
  const n = Number(s);
  if (!s || !Number.isInteger(n) || n < 1 || n > 4094) return { ok:false, msg:"VLAN ID must be 1–4094" };
  if (usedIds.includes(n)) return { ok:false, msg:`VLAN ${n} is already used` };
  return { ok:true, msg:`802.1Q tag ${n}` };
}

// Primary VLAN (index 0) comes from the LAN's own cidr/gateway/vlanId fields.
function lanVlanDefs(lan, vlanEnabled) {
  return [
    { id:lan.vlanId, cidr:lan.cidr, gatewayIp:lan.gatewayIp },
    ...(vlanEnabled ? (lan.extraVlans || []) : []),
  ];
}

function validateDraft(input) {
  const ve = input.vlanEnabled;
  const usedIds = [];
  const subnets = [];
  const res = { ok:true };
  for (const [k, label] of [["lanA","LAN-A"],["lanB","LAN-B"]]) {
    const lan  = input[k];
    const defs = lanVlanDefs(lan, ve);
    const vlans = defs.map(d => {
      const si = parseCidr(d.cidr || "");
      let cidrV = si
        ? { ok:true, msg:`${si.mask} · ${si.totalHosts} hosts · ${si.firstHost}–${si.lastHost}` }
        : { ok:false, msg:"Invalid CIDR (e.g. 192.168.30.0/24, /1–/30)" };
      const name = ve ? `VLAN ${d.id}` : label;
      if (si) {
        const clash = subnets.find(s => subnetsOverlap(s.si, si));
        if (clash) cidrV = { ok:false, msg:`Overlaps ${clash.name} (${clash.si.network}/${clash.si.cidr})` };
        else subnets.push({ si, name });
      }
      let idV = { ok:true, msg:"" };
      if (ve) {
        idV = validateVlanId(d.id, usedIds);
        if (idV.ok) usedIds.push(Number(d.id));
      }
      return { si, cidrV, idV, gwV: validateIp(d.gatewayIp, si) };
    });
    const gws = defs.map(d => d.gatewayIp);
    const pcs = (lan.pcs || []).map((pc, i) => {
      const idx = ve && i > 0 ? Math.min(pc.vlan || 0, vlans.length - 1) : 0;
      const others = [...gws, ...lan.pcs.map((p, j) => j !== i ? p.ip : null)];
      return validateIp(pc.ip, vlans[idx].si, ...others);
    });
    res[k] = { vlans, pcs };
    res.ok = res.ok && vlans.every(v => v.cidrV.ok && v.idV.ok && v.gwV.ok) && pcs.every(v => v.ok);
  }
  return res;
}

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
  const ve = input.vlanEnabled;

  function buildVlans(lan, fallbackCidr, defaultId, colors, phys) {
    return lanVlanDefs(lan, ve).map((d, i) => {
      const si = parseCidr(d.cidr || "") || (i === 0 ? parseCidr(fallbackCidr) : null);
      if (!si) return null;
      const id = ve ? (parseInt(d.id) || (i === 0 ? defaultId : null)) : null;
      return {
        ...si, id, color: colors[i],
        gateway:   validateIp(d.gatewayIp, si).ok ? d.gatewayIp : si.firstHost,
        iface:     ve ? `${phys}.${id}` : phys,
        dhcpStart: numToIp(ipToNum(si.network) + 2), dhcpEnd: si.lastHost,
      };
    }).filter(Boolean);
  }

  function buildPcs(pcsInput, vlans, macPool, names, keys, defaultOffset) {
    return (pcsInput || []).slice(0, 4).map((pc, i) => {
      const vlanIdx = ve && i > 0 ? Math.min(pc.vlan || 0, vlans.length - 1) : 0;
      const v = vlans[vlanIdx];
      return {
        ip:   validateIp(pc.ip, v).ok ? pc.ip : numToIp(ipToNum(v.network) + defaultOffset + i*10),
        mac:  macPool[i], mask: v.mask, cidr: v.cidr, network: v.network, gw: v.gateway,
        vlanIdx, vlan: v.id, color: v.color, iface: v.iface,
        name: names[i], key: keys[i],
      };
    });
  }

  const vlansA = buildVlans(input.lanA, "192.168.1.0/24", 10, VLAN_COLORS_A, "eth0");
  const vlansB = buildVlans(input.lanB, "192.168.2.0/24", 20, VLAN_COLORS_B, "eth1");
  const pcsA = buildPcs(input.lanA.pcs, vlansA, MAC_POOL_A, PC_NAMES_A, PC_KEYS_A, 10);
  const pcsB = buildPcs(input.lanB.pcs, vlansB, MAC_POOL_B, PC_NAMES_B, PC_KEYS_B, 20);
  const lanA = { ...vlansA[0], vlan: vlansA[0].id, vlans: vlansA };
  const lanB = { ...vlansB[0], vlan: vlansB[0].id, vlans: vlansB };
  return {
    lanA, lanB, pcsA, pcsB,
    pcA: pcsA[0], pcB: pcsB[0],
    router: { lanAIp:lanA.gateway, lanAMac:MACS.rtrA, lanBIp:lanB.gateway, lanBMac:MACS.rtrB },
    vlanEnabled: ve,
  };
}

function vlanIdsLabel(lan) { return lan.vlans.map(v => v.id).join(", "); }

// ── Build HF (header fields) with dynamic IPs ─────────────────────────────────
function buildHF(cfg) {
  const {pcA:a, pcB:b, lanA, lanB, vlanEnabled} = cfg;
  const vlanA = vlanEnabled ? [{f:"TPID",v:"0x8100 (802.1Q)"},{f:"VLAN ID",v:`${lanA.vlan}  (LAN-A)`},{f:"Priority",v:"0 (Best Effort)"}] : [];
  const vlanB = vlanEnabled ? [{f:"TPID",v:"0x8100 (802.1Q)"},{f:"VLAN ID",v:`${lanB.vlan}  (LAN-B)`},{f:"Priority",v:"0 (Best Effort)"}] : [];
  return {
    APP:  [{f:"Method",v:"GET"},{f:"Path",v:"/index.html"},{f:"HTTP Version",v:"HTTP/1.1"},{f:"Host",v:b.ip},{f:"Accept",v:"text/html"},{f:"Connection",v:"keep-alive"}],
    PRES: [{f:"Protocol",v:"TLS 1.3"},{f:"Content-Type",v:"0x17 (Application Data)"},{f:"Cipher",v:"AES-256-GCM"},{f:"Integrity",v:"HMAC-SHA-256"}],
    SESS: [{f:"Session-ID",v:"0xA4F2B1C3"},{f:"State",v:"ESTABLISHED"},{f:"Mode",v:"Full-duplex"}],
    TCP:  [{f:"Src Port",v:"54231 (ephemeral)"},{f:"Dst Port",v:"80 (HTTP)"},{f:"Seq Number",v:"1"},{f:"Ack Number",v:"0"},{f:"Header Len",v:"20 bytes"},{f:"Flags",v:"[ SYN ]"},{f:"Window",v:"65535 bytes"},{f:"Checksum",v:"0x4A2F"}],
    IP:   [{f:"Version",v:"4 (IPv4)"},{f:"Header Len",v:"20 bytes"},{f:"TTL",v:"64"},{f:"Protocol",v:"6 (TCP)"},{f:"Src IP",v:a.ip},{f:"Dst IP",v:b.ip},{f:"Checksum",v:"0x8A4B"}],
    IP_R: [{f:"Version",v:"4 (IPv4)"},{f:"Header Len",v:"20 bytes"},{f:"TTL",v:"63  ← decremented by router"},{f:"Protocol",v:"6 (TCP)"},{f:"Src IP",v:`${a.ip}  (unchanged)`},{f:"Dst IP",v:`${b.ip}  (unchanged)`},{f:"Checksum",v:"0x8A4C  (recalculated)"}],
    ETH:  [{f:"Dst MAC",v:MACS.rtrA},{f:"Dst Host",v:"Router (LAN-A port)"},{f:"Src MAC",v:a.mac},{f:"Src Host",v:"PC-A"},...vlanA,{f:"EtherType",v:"0x0800 (IPv4)"}],
    FCS:  [{f:"Algorithm",v:"CRC-32"},{f:"Value",v:"0x1A2B3C4D"},{f:"Purpose",v:"Bit-error detection"}],
    ETH2: [{f:"Dst MAC",v:b.mac},{f:"Dst Host",v:"PC-B"},{f:"Src MAC",v:MACS.rtrB},{f:"Src Host",v:"Router (LAN-B port)"},...vlanB,{f:"EtherType",v:"0x0800 (IPv4)"},{f:"Note",v:"New header added by router"}],
    FCS2: [{f:"Algorithm",v:"CRC-32"},{f:"Value",v:"0x9E8D7C6B"},{f:"Purpose",v:"Bit-error detection"}],
  };
}

// ── Build DEVICES with dynamic IPs ────────────────────────────────────────────
function buildDevices(cfg) {
  const {pcsA,pcsB,lanA,lanB,vlanEnabled} = cfg;
  function pcDev(pc, lanName, isServer=false) {
    return { name:pc.name, type:isServer?"End Device / Web Server":"End Device", rows:[
      {k:"IP Address",     v:`${pc.ip} / ${pc.cidr}`},
      {k:"Subnet Mask",    v:pc.mask},
      {k:"MAC Address",    v:pc.mac},
      {k:"Default Gateway",v:`${pc.gw}${vlanEnabled?`  (Router ${pc.iface})`:""}`},
      {k:"DHCP Server",    v:`${pc.gw}  (Router)`},
      {k:"DNS Server",     v:"8.8.8.8  (Google DNS)"},
      {k:"Network",        v:`${pc.network}/${pc.cidr}  (${lanName}${vlanEnabled?` · VLAN ${pc.vlan}`:""})`},
      ...(isServer?[{k:"Listening On",v:"TCP port 80  (HTTP)"}]:[]),
      ...(vlanEnabled?[{k:"VLAN",v:`${pc.vlan}  (Access port — frames untagged at the PC)`}]:[]),
    ]};
  }
  function routerIfRows(lan, label, mac) {
    return [
      ...lan.vlans.map(v => ({k:vlanEnabled?`${label} ${v.iface}`:`${label} IP`, v:`${v.gateway} / ${v.cidr}${vlanEnabled?`  (VLAN ${v.id})`:""}`})),
      {k:`${label} MAC`, v:mac},
      ...lan.vlans.map(v => ({k:vlanEnabled?`DHCP Pool VLAN ${v.id}`:`DHCP Pool ${label.slice(-1)}`, v:`${v.dhcpStart} – ${v.dhcpEnd}`})),
    ];
  }
  function switchDev(lan, pcs, label) {
    const trunk = lan.vlans.length > 1;
    return { name:`Switch (${label})`, type:"Layer 2 Device", rows:[
      {k:"Type",           v:`${vlanEnabled?"Managed (VLAN-aware)":"Unmanaged"} L2 Switch`},
      {k:"IP Address",     v:"None  (not required)"},
      {k:"Operates At",    v:"OSI Layer 2 (Data Link)"},
      {k:"Forwards By",    v:vlanEnabled?"VLAN + destination MAC":"Destination MAC address"},
      {k:"Ports",          v:"24× Gigabit Ethernet"},
      ...(vlanEnabled ? lan.vlans.map(v => ({k:`VLAN ${v.id}`, v:pcs.filter(p=>p.vlan===v.id).map(p=>p.name).join(", ") || "no hosts"})) : []),
      ...(vlanEnabled ? [{k:"Uplink Fa0/24", v:trunk?`802.1Q trunk → Router (allowed ${vlanIdsLabel(lan)})`:`Tagged VLAN ${lan.vlan} → Router`}] : []),
    ]};
  }
  const devs = {};
  pcsA.forEach(pc => { devs[pc.key] = pcDev(pc, "LAN-A"); });
  pcsB.forEach((pc,i) => { devs[pc.key] = pcDev(pc, "LAN-B", i===0); });
  return { ...devs,
    router:{ name:"Router", type:"Layer 3 Device", rows:[
      ...routerIfRows(lanA, "LAN-A", MACS.rtrA),
      ...routerIfRows(lanB, "LAN-B", MACS.rtrB),
      ...(vlanEnabled && (lanA.vlans.length>1 || lanB.vlans.length>1)
        ? [{k:"Inter-VLAN",v:"Router-on-a-stick: one physical port, one subinterface per VLAN"}] : []),
      {k:"DNS Forwarding", v:"8.8.8.8"},
      {k:"Routing",        v:"Connected + Static routes"},
    ]},
    switchA: switchDev(lanA, pcsA, "LAN-A"),
    switchB: switchDev(lanB, pcsB, "LAN-B"),
  };
}

// ── Dynamic proto blocks (override STEPS.proto when IPs/MACs needed) ──────────
function getProto(id, cfg) {
  const {pcA:a,pcB:b,router:r,lanA,lanB,vlanEnabled} = cfg;
  const vA = vlanEnabled ? `  VLAN:${lanA.vlan}` : "";
  const vB = vlanEnabled ? `  VLAN:${lanB.vlan}` : "";
  const map = {
    router_init: [
      ...[[lanA,"LAN-A"],[lanB,"LAN-B"]].flatMap(([lan,label]) => lan.vlans.map(v =>
        `${v.iface.padEnd(8)} (${label}${vlanEnabled?` VLAN ${v.id}`:""}): ${v.gateway}/${v.cidr}  → UP`)),
      `DHCP server:  one pool per ${vlanEnabled?"VLAN subinterface":"interface"}`,
      ...[...lanA.vlans, ...lanB.vlans].map((v,i) =>
        `${i===0?"Routing:     ":"             "} ${v.network}/${v.cidr} via ${v.iface}  [Connected]`),
      "LLDP:         Hello frames broadcast on all ports",
    ].join("\n"),
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
`ETH  src:${a.mac}  dst:${MACS.rtrA}${vA}  +FCS
(router MAC already in ARP cache from boot phase)`,
    router_rx: `Router strips ETH header + FCS  →  reads IP dst: ${b.ip}`,
    router_fwd: `New ETH  src:${MACS.rtrB}  dst:${b.mac}${vB}  IP TTL:63`,
  };
  return map[id] ?? null;
}

// ── Build per-device boot logs (dynamic IPs in details) ───────────────────────
function buildBootLogs(cfg) {
  const {lanA,lanB,pcsA,pcsB} = cfg;
  function pcLog(pc, dhcpStep, arpStep, gwRtrMac) {
    return [
      {stepId:null,       t:"0.00s",icon:"⚡",event:"NIC powered on",  detail:"eth0 link up (1 Gbps)"},
      {stepId:dhcpStep,   t:"0.10s",icon:"📡",event:"DHCP Discover",   detail:"Broadcast → 255.255.255.255"},
      {stepId:dhcpStep,   t:"0.20s",icon:"📨",event:"DHCP Offer",      detail:`${pc.gw} offers ${pc.ip}/${pc.cidr}`},
      {stepId:dhcpStep,   t:"0.25s",icon:"📤",event:"DHCP Request",    detail:`Requesting ${pc.ip}`},
      {stepId:dhcpStep,   t:"0.30s",icon:"✉", event:"DHCP Ack",        detail:`IP:${pc.ip} GW:${pc.gw} DNS:8.8.8.8`},
      {stepId:arpStep,    t:"0.40s",icon:"❓",event:"ARP for gateway", detail:`Who has ${pc.gw}? (broadcast)`},
      {stepId:arpStep,    t:"0.45s",icon:"💡",event:"ARP Reply",       detail:`${gwRtrMac} → cached as GW`},
      {stepId:arpStep,    t:"0.50s",icon:"✅",event:"Ready",           detail:"Network stack fully configured"},
    ];
  }
  const logs = {
    router:[
      {stepId:null,          t:"0.00s",icon:"⚡",event:"Power on",           detail:"Firmware loading"},
      ...[...lanA.vlans, ...lanB.vlans].map(v =>
        ({stepId:"router_init", t:"0.30s",icon:"🔌",event:`${v.iface} UP${cfg.vlanEnabled?` (VLAN ${v.id})`:""}`, detail:`${v.gateway}/${v.cidr} assigned`})),
      {stepId:"router_init", t:"0.50s",icon:"🗺", event:"Routing table built",detail:[...lanA.vlans, ...lanB.vlans].map(v=>`${v.network}/${v.cidr}`).join(", ")},
      {stepId:"router_init", t:"0.60s",icon:"📡",event:"DHCP server started",detail:`${lanA.vlans.length+lanB.vlans.length} pools`},
      {stepId:"router_init", t:"0.70s",icon:"📢",event:"LLDP Hello sent",   detail:"Announced on all ports"},
      {stepId:"router_init", t:"1.00s",icon:"✅",event:"Ready",             detail:"Forwarding enabled"},
    ],
    switchA:[
      {stepId:null,          t:" 0.0s",icon:"⚡",event:"Power on",          detail:"24 ports initialized"},
      {stepId:"switch_init", t:" 0.1s",icon:"📢",event:"STP BPDU sent",    detail:"Bridge ID broadcast on all ports"},
      {stepId:"switch_init", t:" 0.5s",icon:"👂",event:"STP Listening",    detail:"No superior BPDU received"},
      {stepId:"switch_init", t:"15.0s",icon:"📖",event:"STP Learning",     detail:"Populating MAC table"},
      {stepId:"switch_init", t:"30.0s",icon:"✅",event:"STP Forwarding",   detail:"All ports active"},
      {stepId:"pca_dhcp",    t:"30+s", icon:"📋",event:"MAC table updated", detail:`${MAC_POOL_A[0].slice(0,8)}... learned on Fa0/1`},
    ],
    switchB:[
      {stepId:null,          t:" 0.0s",icon:"⚡",event:"Power on",          detail:"24 ports initialized"},
      {stepId:"switch_init", t:" 0.1s",icon:"📢",event:"STP BPDU sent",    detail:"Bridge ID broadcast on all ports"},
      {stepId:"switch_init", t:" 0.5s",icon:"👂",event:"STP Listening",    detail:"No superior BPDU received"},
      {stepId:"switch_init", t:"15.0s",icon:"📖",event:"STP Learning",     detail:"Populating MAC table"},
      {stepId:"switch_init", t:"30.0s",icon:"✅",event:"STP Forwarding",   detail:"All ports active"},
      {stepId:"pcb_dhcp",    t:"30+s", icon:"📋",event:"MAC table updated", detail:`${MAC_POOL_B[0].slice(0,8)}... learned on Fa0/1`},
    ],
  };
  if (cfg.vlanEnabled) {
    for (const [sw, lan] of [["switchA", lanA], ["switchB", lanB]]) {
      logs[sw].splice(1, 0,
        {stepId:"switch_init", t:" 0.1s",icon:"🏷", event:"VLANs loaded",     detail:`VLAN ${vlanIdsLabel(lan)} from startup-config`},
        {stepId:"switch_init", t:" 0.1s",icon:"🔗", event:"Fa0/24 uplink",    detail:lan.vlans.length>1?`802.1Q trunk, allowed ${vlanIdsLabel(lan)}`:`Tagged VLAN ${lan.vlan}`});
    }
  }
  pcsA.forEach(pc => { logs[pc.key] = pcLog(pc, "pca_dhcp", "pca_arp_gw", MACS.rtrA); });
  pcsB.forEach(pc => { logs[pc.key] = pcLog(pc, "pcb_dhcp", "pcb_dhcp",   MACS.rtrB); });
  return logs;
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
      stepAtOrPast(si,"router_rx")  && {ip:cfg.pcA.ip, mac:cfg.pcA.mac, iface:`LAN-A ${cfg.pcA.iface}`},
      stepAtOrPast(si,"router_fwd") && {ip:cfg.pcB.ip, mac:cfg.pcB.mac, iface:`LAN-B ${cfg.pcB.iface}`},
    ].filter(Boolean),
  };
}
function getDhcpLeases(si, cfg) {
  const leases = [];
  if (stepAtOrPast(si,"pca_dhcp"))
    cfg.pcsA.forEach(pc => leases.push({ip:pc.ip, mac:pc.mac, host:pc.name, iface:`LAN-A ${pc.iface}`, lease:"24h"}));
  if (stepAtOrPast(si,"pcb_dhcp"))
    cfg.pcsB.forEach(pc => leases.push({ip:pc.ip, mac:pc.mac, host:pc.name, iface:`LAN-B ${pc.iface}`, lease:"24h"}));
  return leases;
}
function getSwitchMac(si, cfg, side) {
  const lan = side==="A" ? cfg.lanA : cfg.lanB;
  const pcs = side==="A" ? cfg.pcsA : cfg.pcsB;
  if (!stepAtOrPast(si, side==="A"?"pca_dhcp":"pcb_dhcp")) return [];
  const ve = cfg.vlanEnabled;
  return [
    ...pcs.map((pc,i) => ({mac:pc.mac, port:`Fa0/${i+1}`, host:pc.name, vlan:ve?pc.vlan:1, type:"Dynamic"})),
    {mac:side==="A"?MACS.rtrA:MACS.rtrB, port:"Fa0/24", host:`Router (LAN-${side})`,
     vlan:ve?(lan.vlans.length>1?`trunk ${vlanIdsLabel(lan)}`:lan.vlan):1, type:"Dynamic"},
  ];
}
function getRouterRoutes(cfg) {
  return [
    ...[[cfg.lanA,"LAN-A"],[cfg.lanB,"LAN-B"]].flatMap(([lan,label]) => lan.vlans.map(v =>
      ({dst:`${v.network}/${v.cidr}`, nh:"0.0.0.0 (direct)", iface:`${label} (${v.iface})`, type:"C"}))),
    {dst:"0.0.0.0/0", nh:"ISP gateway", iface:"WAN", type:"S*"},
  ];
}
function getPcRoutes(pc, side, si) {
  if (!stepAtOrPast(si, side==="A"?"pca_dhcp":"pcb_dhcp")) return [];
  return [
    {dst:`${pc.network}/${pc.cidr}`, nh:"0.0.0.0 (direct)", iface:"eth0", type:"C"},
    {dst:"0.0.0.0/0", nh:pc.gw, iface:"eth0", type:"default"},
  ];
}
function getPcArp(pc, side, si) {
  const step = side==="A" ? "pca_arp_gw" : (pc.key==="B" ? "pcb_l2" : "pcb_dhcp");
  if (!stepAtOrPast(si, step)) return [];
  return [{ip:pc.gw, mac:side==="A"?MACS.rtrA:MACS.rtrB, host:`Router ${pc.iface}`}];
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

function VlanBox({ title, color, def, v, showId, onField, onRemove }) {
  return (
    <div className="osi-cfg-vlanbox" style={{borderColor:`${color}55`}}>
      {title && <div className="osi-cfg-vlanhead" style={{color}}>
        <span>{title}</span>
        {onRemove && <button className="osi-cfg-vlan-remove" onClick={onRemove} title="Remove VLAN">Remove</button>}
      </div>}
      {showId && <IpField label="VLAN ID" value={String(def.id ?? "")} onChange={x=>onField("id",x)}
        placeholder="30" validation={v.idV}/>}
      <IpField label="Network / CIDR" value={def.cidr || ""} onChange={x=>onField("cidr",x)}
        placeholder="192.168.30.0/24" validation={v.cidrV}/>
      <IpField label={showId ? "Router subinterface IP (gateway)" : "Router / Gateway IP"}
        value={def.gatewayIp || ""} onChange={x=>onField("gatewayIp",x)}
        placeholder={v.si?.firstHost || ""} validation={v.si ? v.gwV : null}/>
    </div>
  );
}

function suggestVlan(draft) {
  const allDefs = [draft.lanA, draft.lanB].flatMap(l => lanVlanDefs(l, true));
  const usedIds = new Set(allDefs.map(d => Number(d.id)));
  let id = 30;
  while (usedIds.has(id)) id += 10;
  const subnets = allDefs.map(d => parseCidr(d.cidr || "")).filter(Boolean);
  let third = id <= 255 ? id : 100;
  while (third < 255 && subnets.some(s => subnetsOverlap(s, parseCidr(`192.168.${third}.0/24`)))) third++;
  return { id:String(id), cidr:`192.168.${third}.0/24`, gatewayIp:`192.168.${third}.1` };
}

function LanBlock({ title, colors, lan, setLan, vr, pcNames, vlanEnabled, onAddVlan }) {
  const defs = lanVlanDefs(lan, vlanEnabled);
  const pcs  = lan.pcs || [];
  const nExtra = (lan.extraVlans || []).length;

  function setVlanField(i, key, val) {
    if (i === 0) setLan(l => ({...l, [key==="id" ? "vlanId" : key]: val}));
    else setLan(l => ({...l, extraVlans: l.extraVlans.map((x,j) => j===i-1 ? {...x, [key]:val} : x)}));
  }
  function removeVlan(i) {
    setLan(l => ({...l,
      extraVlans: l.extraVlans.filter((_,j) => j !== i-1),
      pcs: l.pcs.map(p => {
        const cur = p.vlan || 0;
        return {...p, vlan: cur===i ? 0 : cur>i ? cur-1 : cur};
      }),
    }));
  }
  function setPc(i, patch) { setLan(l => ({...l, pcs: l.pcs.map((p,j) => j===i ? {...p, ...patch} : p)})); }
  function changePcVlan(i, idx) {
    const si = vr.vlans[idx]?.si;
    const patch = { vlan: idx };
    if (si && !validateIp(pcs[i].ip, si).ok) {
      const used = new Set([...defs.map(d=>d.gatewayIp), ...pcs.map(p=>p.ip)]);
      const bc = ipToNum(si.broadcast);
      let n = ipToNum(si.network) + 10;
      while (n < bc && used.has(numToIp(n))) n++;
      if (n < bc) patch.ip = numToIp(n);
    }
    setPc(i, patch);
  }

  return (
    <div className="osi-cfg-lan">
      <div className="osi-cfg-lanhead" style={{color:colors[0]}}>{title}</div>

      {defs.map((d, i) => (
        <VlanBox key={i} def={d} v={vr.vlans[i]} color={colors[i]} showId={vlanEnabled}
          title={vlanEnabled ? (i===0 ? `VLAN ${d.id || "?"} · primary` : `VLAN ${d.id || "?"}`) : null}
          onField={(k,x)=>setVlanField(i,k,x)}
          onRemove={i>0 ? ()=>removeVlan(i) : null}/>
      ))}
      {vlanEnabled && nExtra < MAX_EXTRA_VLANS && (
        <button className="osi-cfg-pc-add" onClick={onAddVlan}>+ Add VLAN</button>
      )}

      <div className="osi-cfg-subhead">Hosts</div>
      {pcs.map((pc, i) => {
        const idx   = vlanEnabled && i > 0 ? Math.min(pc.vlan || 0, defs.length-1) : 0;
        const color = colors[idx];
        return (
          <div key={i} className="osi-cfg-pcrow">
            <IpField label={`${pcNames[i]} IP${i===0 ? " · trace endpoint" : ""}`} value={pc.ip}
              onChange={val=>setPc(i, {ip:val})}
              placeholder={vr.vlans[idx]?.si ? numToIp(ipToNum(vr.vlans[idx].si.network)+10+i*10) : ""}
              validation={vr.pcs[i]}/>
            {vlanEnabled && (i === 0
              ? <span className="osi-cfg-vlan-fixed" style={{color, borderColor:`${color}66`}}
                  title="The packet trace starts/ends here, so this PC stays on the primary VLAN">VLAN {defs[0].id || "?"}</span>
              : <select className="osi-cfg-select" style={{color, borderColor:`${color}66`}} value={idx}
                  onChange={e=>changePcVlan(i, Number(e.target.value))}>
                  {defs.map((d,j) => <option key={j} value={j}>VLAN {d.id || "?"}</option>)}
                </select>)}
            {i > 0 && (
              <button className="osi-cfg-pc-remove" onClick={()=>setLan(l=>({...l, pcs:l.pcs.filter((_,j)=>j!==i)}))} title="Remove PC">−</button>
            )}
          </div>
        );
      })}
      {pcs.length < 4 && (
        <button className="osi-cfg-pc-add" onClick={()=>setLan(l=>({...l, pcs:[...l.pcs, {ip:"", vlan:0}]}))}>+ Add PC</button>
      )}
    </div>
  );
}

function NetworkConfigPanel({ draft, setDraft, onApply, onReset, onClose }) {
  const vr = validateDraft(draft);
  const canApply = vr.ok;
  const setLanA = fn => setDraft(d => ({...d, lanA: fn(d.lanA)}));
  const setLanB = fn => setDraft(d => ({...d, lanB: fn(d.lanB)}));

  const addVlan = k => setDraft(d => ({...d, [k]: {...d[k], extraVlans: [...(d[k].extraVlans || []), suggestVlan(d)]}}));

  return (
    <div className="osi-cfg-panel">
      <div className="osi-cfg-panelhead">
        <span>⚙ Network Configuration</span>
        <button className="osi-cfg-close" onClick={onClose}>✕</button>
      </div>
      <div className="osi-cfg-opts">
        <label className="osi-cfg-toggle">
          <input type="checkbox" checked={draft.vlanEnabled}
            onChange={e=>setDraft(d=>({...d,vlanEnabled:e.target.checked}))}/>
          <span>Enable 802.1Q VLANs</span>
          {draft.vlanEnabled && <span className="osi-cfg-vlan-badge">VLAN</span>}
        </label>
        {draft.vlanEnabled && <span className="osi-cfg-hint">
          Each VLAN is its own subnet and broadcast domain. The router reaches every VLAN through one subinterface on a trunk (router-on-a-stick).
        </span>}
      </div>
      <div className="osi-cfg-grid">
        <LanBlock title="LAN-A" colors={VLAN_COLORS_A} lan={draft.lanA} setLan={setLanA} vr={vr.lanA}
          pcNames={PC_NAMES_A} vlanEnabled={draft.vlanEnabled} onAddVlan={()=>addVlan("lanA")}/>
        <LanBlock title="LAN-B" colors={VLAN_COLORS_B} lan={draft.lanB} setLan={setLanB} vr={vr.lanB}
          pcNames={PC_NAMES_B} vlanEnabled={draft.vlanEnabled} onAddVlan={()=>addVlan("lanB")}/>
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
  const {pcA:a, pcB:b, router:r, lanA, lanB, vlanEnabled, pcsA, pcsB} = cfg;
  const nExtraA = pcsA.length - 1;
  const nExtraB = pcsB.length - 1;
  const ROW2_Y = 190;
  const anyExtra = nExtraA > 0 || nExtraB > 0;
  const svgHeight = anyExtra ? 272 : 162;
  const lanAHeight = nExtraA > 0 ? 240 : 122;
  const lanBHeight = nExtraB > 0 ? 240 : 122;

  const mainNodes = [
    {x:85,  y:78, label:a.name,  ip:a.ip,  mac:a.mac,  key:"A",       shape:"pc", color:a.color, vlan:a.vlan},
    {x:255, y:78, label:"Switch",ip:"No IP  (L2)", mac:"", key:"switchA", shape:"sw"},
    {x:445, y:78, label:"Router",ip:`${r.lanAIp}/${r.lanBIp}`,
     mac:vlanEnabled?`${lanA.vlans.length+lanB.vlans.length} subinterfaces`:"DD:.. / EE:..", key:"router", shape:"rt"},
    {x:635, y:78, label:"Switch",ip:"No IP  (L2)", mac:"", key:"switchB", shape:"sw"},
    {x:815, y:78, label:b.name,  ip:b.ip,  mac:b.mac,  key:"B",       shape:"pc", color:b.color, vlan:b.vlan},
  ];
  const ROW2_XA = [85, 175, 265];
  const ROW2_XB = [815, 725, 635];
  const extraNode = (pc, x) => ({x, y:ROW2_Y, label:pc.name, ip:pc.ip, mac:pc.mac, key:pc.key, shape:"pc", color:pc.color, vlan:pc.vlan});
  const extraNodesA = pcsA.slice(1).map((pc, i) => extraNode(pc, ROW2_XA[i]));
  const extraNodesB = pcsB.slice(1).map((pc, i) => extraNode(pc, ROW2_XB[i]));
  const allNodes = [...mainNodes, ...extraNodesA, ...extraNodesB];

  const isActive   = k => activeSide===k||(activeSide==="transit_a"&&k==="switchA")||(activeSide==="transit_b"&&k==="switchB");
  const isSelected = k => selectedDevice===k;
  const dotX = 85 + pos * (815 - 85);
  const lanLabel = (lan, name) => vlanEnabled
    ? `${name} · VLAN${lan.vlans.length>1?"s":""} ${vlanIdsLabel(lan)}  ·  DNS: 8.8.8.8`
    : `${name} · ${lan.network}/${lan.cidr}  · DHCP: ${lan.gateway}  ·  DNS: 8.8.8.8`;
  const lanALabel = lanLabel(lanA, "LAN-A");
  const lanBLabel = lanLabel(lanB, "LAN-B");

  function vlanBadges(lan, x0) {
    return lan.vlans.map((v, i) => (
      <g key={v.id}>
        <rect x={x0+i*110} y="35" width="104" height="11" rx="3" fill={`${v.color}22`} stroke={`${v.color}88`} strokeWidth="0.6"/>
        <text x={x0+i*110+52} y="43" fontSize="7" fill={v.color} textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontWeight="700">
          VLAN {v.id} · {v.network}/{v.cidr}
        </text>
      </g>
    ));
  }

  function renderNode(n) {
    const active = isActive(n.key), selected = isSelected(n.key);
    const idle = vlanEnabled && n.color ? `${n.color}bb` : "rgba(255,255,255,0.28)";
    const c  = selected?"#f2c36b":active?"#42d9b8":idle;
    const bg = selected?"rgba(242,195,107,0.14)":active?"rgba(66,217,184,0.14)":"rgba(13,19,30,0.95)";
    const sw = selected||active?2.5:1;
    return (
      <g key={n.key} style={{cursor:"pointer"}} onClick={()=>onSelectDevice(selected?null:n.key)}>
        {selected&&<circle cx={n.x} cy={n.y} r={35} fill="none" stroke="rgba(242,195,107,0.35)" strokeWidth="1.5" strokeDasharray="4 3"/>}
        <circle cx={n.x} cy={n.y} r={28} fill={bg} stroke={c} strokeWidth={sw}/>
        {n.shape==="pc"&&<>
          <rect x={n.x-11} y={n.y-14} width={22} height={15} rx={2} fill="none" stroke={c} strokeWidth={1.5}/>
          <line x1={n.x-7} y1={n.y+1} x2={n.x+7} y2={n.y+1} stroke={c} strokeWidth={1.5}/>
          <line x1={n.x-5} y1={n.y+4} x2={n.x+5} y2={n.y+4} stroke={c} strokeWidth={1}/>
        </>}
        {n.shape==="rt"&&<polygon points={`${n.x},${n.y-27} ${n.x+18},${n.y} ${n.x},${n.y+27} ${n.x-18},${n.y}`} fill="none" stroke={c} strokeWidth={1.5}/>}
        {n.shape==="sw"&&<>
          <rect x={n.x-14} y={n.y-11} width={28} height={19} rx={2} fill="none" stroke={c} strokeWidth={1.5}/>
          {[-8,-2,4,10].map(dx=><line key={dx} x1={n.x+dx} y1={n.y-11} x2={n.x+dx} y2={n.y-17} stroke={c} strokeWidth={1}/>)}
        </>}
        <text x={n.x} y={n.y+36} textAnchor="middle" fontSize="10" fontWeight={active||selected?"700":"500"} fill={selected?"#f2c36b":active?"#42d9b8":"rgba(241,245,249,0.8)"} fontFamily="Inter,sans-serif">{n.label}</text>
        <text x={n.x} y={n.y+48} textAnchor="middle" fontSize="8" fill={active||selected?"rgba(241,245,249,0.7)":"rgba(241,245,249,0.42)"} fontFamily="'JetBrains Mono',monospace">{n.ip}</text>
        {n.mac&&<text x={n.x} y={n.y+59} textAnchor="middle" fontSize="7.5" fill="rgba(241,245,249,0.26)" fontFamily="'JetBrains Mono',monospace">{n.mac.slice(0,17)}</text>}
        {vlanEnabled&&n.vlan!=null&&<>
          <rect x={n.x+12} y={n.y-31} width={30} height={12} rx={6} fill="rgba(13,19,30,0.95)" stroke={n.color} strokeWidth={1}/>
          <text x={n.x+27} y={n.y-22} textAnchor="middle" fontSize="7.5" fontWeight="700" fill={n.color} fontFamily="'JetBrains Mono',monospace">V{n.vlan}</text>
        </>}
      </g>
    );
  }

  return (
    <div className="osi-topo-wrap">
      <p className="osi-topo-hint">↑ Click any device to inspect its internal tables and boot log</p>
      <svg viewBox={`0 0 900 ${svgHeight}`} className="osi-topo-svg">
        <rect x="6"   y="18" width="344" height={lanAHeight} rx="12" fill="rgba(99,179,237,0.05)" stroke="rgba(99,179,237,0.2)" strokeWidth="1"/>
        <text x="16"  y="31" fontSize="9" fill="#63b3ed" fontFamily="'JetBrains Mono',monospace" fontWeight="600" letterSpacing="0.4">{lanALabel}</text>
        {vlanEnabled && vlanBadges(lanA, 14)}
        <rect x="550" y="18" width="344" height={lanBHeight} rx="12" fill="rgba(66,217,184,0.05)" stroke="rgba(66,217,184,0.2)" strokeWidth="1"/>
        <text x="560" y="31" fontSize="9" fill="#42d9b8" fontFamily="'JetBrains Mono',monospace" fontWeight="600" letterSpacing="0.4">{lanBLabel}</text>
        {vlanEnabled && vlanBadges(lanB, 558)}
        <rect x="378" y="30" width="134" height="100" rx="10" fill="rgba(251,146,60,0.05)" stroke="rgba(251,146,60,0.25)" strokeWidth="1"/>
        <line x1="85" y1="78" x2="815" y2="78" stroke="rgba(255,255,255,0.1)" strokeWidth="2"/>
        {vlanEnabled && lanA.vlans.length>1 && <text x="330" y="72" textAnchor="middle" fontSize="7.5" fill="rgba(241,245,249,0.5)" fontFamily="'JetBrains Mono',monospace">802.1Q trunk</text>}
        {vlanEnabled && lanB.vlans.length>1 && <text x="560" y="72" textAnchor="middle" fontSize="7.5" fill="rgba(241,245,249,0.5)" fontFamily="'JetBrains Mono',monospace">802.1Q trunk</text>}
        {nExtraA>0 && <path fill="none" stroke="rgba(99,179,237,0.35)" strokeWidth="1.5" strokeDasharray="4 3"
          d={`M275 98 L300 123 L300 152 L${Math.min(...extraNodesA.map(n=>n.x))} 152 ${extraNodesA.map(n=>`M${n.x} 152 L${n.x} 162`).join(" ")}`}/>}
        {nExtraB>0 && <path fill="none" stroke="rgba(66,217,184,0.35)" strokeWidth="1.5" strokeDasharray="4 3"
          d={`M615 98 L590 123 L590 152 L${Math.max(...extraNodesB.map(n=>n.x))} 152 ${extraNodesB.map(n=>`M${n.x} 152 L${n.x} 162`).join(" ")}`}/>}
        {allNodes.map(renderNode)}
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
  const pcA_     = cfg.pcsA.find(p=>p.key===deviceKey);
  const pc       = pcA_ || cfg.pcsB.find(p=>p.key===deviceKey);
  const pcSide   = pcA_ ? "A" : "B";
  const swSide   = deviceKey==="switchA" ? "A" : deviceKey==="switchB" ? "B" : null;
  const swLan    = swSide==="B" ? cfg.lanB : cfg.lanA;
  const swPcs    = swSide==="B" ? cfg.pcsB : cfg.pcsA;

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
        {pc&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">Network Configuration</div>
            {(pcSide==="A"?cfgA:cfgB)
              ? <DiTable cols={["Parameter","Value"]} rows={(DEVICES[deviceKey]?.rows||[]).map(r=>[r.k,r.v])} empty=""/>
              : <p className="osi-di-empty">Not yet configured — DHCP has not completed</p>}
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">ARP Cache</div>
            <DiTable cols={["IP Address","MAC Address","Host"]} rows={getPcArp(pc,pcSide,si).map(r=>[r.ip,r.mac,r.host])} empty="Empty — ARP not yet resolved"/>
            <div className="osi-di-section" style={{marginTop:14}}>Routing Table</div>
            <DiTable cols={["Destination","Next Hop","Interface","Type"]} rows={getPcRoutes(pc,pcSide,si).map(r=>[r.dst,r.nh,r.iface,r.type])} empty="No routes — waiting for DHCP"/>
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
                ...cfg.lanA.vlans.map(v=>[`LAN-A (${v.iface})`,`${v.gateway}/${v.cidr}`,MACS.rtrA,"UP"]),
                ...cfg.lanB.vlans.map(v=>[`LAN-B (${v.iface})`,`${v.gateway}/${v.cidr}`,MACS.rtrB,"UP"]),
              ]:[]} empty="Interfaces down"/>
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">ARP Table</div>
            <DiTable cols={["IP Address","MAC Address","Interface"]} rows={arp.router.map(r=>[r.ip,r.mac,r.iface])} empty="Empty — no frames received yet"/>
            <div className="osi-di-section" style={{marginTop:14}}>DHCP Leases</div>
            <DiTable cols={["IP","MAC","Host","Interface","Lease"]} rows={getDhcpLeases(si,cfg).map(r=>[r.ip,r.mac,r.host,r.iface,r.lease])} empty="No leases yet"/>
          </div>
        </>}
        {swSide&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">MAC Address Table</div>
            <DiTable cols={["MAC Address","Port","Host","VLAN","Type"]}
              rows={getSwitchMac(si,cfg,swSide).map(r=>[r.mac,r.port,r.host,r.vlan,r.type])}
              empty={switchUp?"Empty — no traffic yet":"Switch not initialized"}/>
            {cfg.vlanEnabled&&<>
              <div className="osi-di-section" style={{marginTop:14}}>Port VLAN Assignment</div>
              <DiTable cols={["Port","Mode","VLAN","Device"]} rows={switchUp?[
                ...swPcs.map((p,i)=>[`Fa0/${i+1}`,"Access",p.vlan,p.name]),
                ["Fa0/24",swLan.vlans.length>1?"Trunk (802.1Q)":"Tagged",vlanIdsLabel(swLan),"Router"],
              ]:[]} empty="Switch not initialized"/>
            </>}
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">STP / Port State</div>
            <DiTable cols={["Property","Value"]} rows={switchUp?[
              ["Role","Root Bridge"],["All ports","Forwarding"],
              ["BPDU","Sent during boot"],["IP Address","None (L2 only)"],
              ["Unknown frames",cfg.vlanEnabled?"Flooded within the same VLAN only":"Flooded to all ports"],
              ["Broadcast",cfg.vlanEnabled?"Stays inside its VLAN (separate broadcast domains)":"Flooded to all ports"],
              ...(cfg.vlanEnabled&&swLan.vlans.length>1?[["Inter-VLAN traffic","Must go up the trunk to the router and back"]]:[]),
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
  const table = showPcA?getPcArp(cfg.pcA,"A",si):showPcB?getPcArp(cfg.pcB,"B",si):arp.router;
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
