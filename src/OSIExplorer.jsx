import { useState, useEffect, useRef } from "react";
import "./osi.css";

const LC = { 7:"#a78bfa", 6:"#63b3ed", 5:"#42d9b8", 4:"#f2c36b", 3:"#fb923c", 2:"#e63946", 1:"#94a3b8" };

const LAYERS = [
  { num:7, name:"Application",  pdu:"Data",    proto:"HTTP · DNS · FTP · SMTP" },
  { num:6, name:"Presentation", pdu:"Data",    proto:"TLS · SSL · ASCII · JSON" },
  { num:5, name:"Session",      pdu:"Data",    proto:"NetBIOS · RPC · SIP" },
  { num:4, name:"Transport",    pdu:"Segment", proto:"TCP · UDP" },
  { num:3, name:"Network",      pdu:"Packet",  proto:"IP · ICMP · OSPF" },
  { num:2, name:"Data Link",    pdu:"Frame",   proto:"Ethernet · Wi-Fi · ARP" },
  { num:1, name:"Physical",     pdu:"Bits",    proto:"Cat5e · Fiber · Wi-Fi" },
];

const DEVICES = {
  A: { name:"PC-A", type:"End Device", rows:[
    {k:"IP Address",     v:"192.168.1.10 / 24"},
    {k:"Subnet Mask",    v:"255.255.255.0"},
    {k:"MAC Address",    v:"AA:BB:CC:11:22:33"},
    {k:"Default Gateway",v:"192.168.1.1"},
    {k:"DHCP Server",    v:"192.168.1.1  (Router)"},
    {k:"DNS Server",     v:"8.8.8.8  (Google DNS)"},
    {k:"Network",        v:"192.168.1.0 / 24  (LAN-A)"},
  ]},
  B: { name:"PC-B", type:"End Device / Web Server", rows:[
    {k:"IP Address",     v:"192.168.2.20 / 24"},
    {k:"Subnet Mask",    v:"255.255.255.0"},
    {k:"MAC Address",    v:"CC:DD:EE:44:55:66"},
    {k:"Default Gateway",v:"192.168.2.1"},
    {k:"DHCP Server",    v:"192.168.2.1  (Router)"},
    {k:"DNS Server",     v:"8.8.8.8  (Google DNS)"},
    {k:"Network",        v:"192.168.2.0 / 24  (LAN-B)"},
    {k:"Listening On",   v:"TCP port 80  (HTTP)"},
  ]},
  router: { name:"Router", type:"Layer 3 Device", rows:[
    {k:"LAN-A IP",       v:"192.168.1.1 / 24"},
    {k:"LAN-A MAC",      v:"DD:EE:FF:00:11:22"},
    {k:"LAN-B IP",       v:"192.168.2.1 / 24"},
    {k:"LAN-B MAC",      v:"EE:FF:00:11:22:33"},
    {k:"DHCP Pool A",    v:"192.168.1.10 – 192.168.1.254"},
    {k:"DHCP Pool B",    v:"192.168.2.10 – 192.168.2.254"},
    {k:"DNS Forwarding", v:"8.8.8.8"},
    {k:"Routing",        v:"Connected + Static routes"},
  ]},
  switchA: { name:"Switch (LAN-A)", type:"Layer 2 Device", rows:[
    {k:"Type",           v:"Unmanaged L2 Switch"},
    {k:"IP Address",     v:"None  (not required)"},
    {k:"Operates At",    v:"OSI Layer 2 (Data Link)"},
    {k:"Forwards By",    v:"Destination MAC address"},
    {k:"MAC Table",      v:"Learned from traffic"},
    {k:"Ports",          v:"24× Gigabit Ethernet"},
  ]},
  switchB: { name:"Switch (LAN-B)", type:"Layer 2 Device", rows:[
    {k:"Type",           v:"Unmanaged L2 Switch"},
    {k:"IP Address",     v:"None  (not required)"},
    {k:"Operates At",    v:"OSI Layer 2 (Data Link)"},
    {k:"Forwards By",    v:"Destination MAC address"},
    {k:"MAC Table",      v:"Learned from traffic"},
    {k:"Ports",          v:"24× Gigabit Ethernet"},
  ]},
};

const HM = {
  APP: {layer:7,short:"HTTP Data"},PRES:{layer:6,short:"TLS Wrap"},SESS:{layer:5,short:"Session"},
  TCP: {layer:4,short:"TCP Header"},IP:{layer:3,short:"IP Header"},ETH:{layer:2,short:"Ethernet"},
  FCS: {layer:2,short:"FCS Trailer"},ETH2:{layer:2,short:"Ethernet*"},FCS2:{layer:2,short:"FCS Trailer"},
};

const HF = {
  APP:  [{f:"Method",      v:"GET"},{f:"Path",         v:"/index.html"},{f:"HTTP Version",v:"HTTP/1.1"},
         {f:"Host",        v:"192.168.2.20"},{f:"Accept",       v:"text/html"},{f:"Connection",  v:"keep-alive"}],
  PRES: [{f:"Protocol",    v:"TLS 1.3"},{f:"Content-Type",v:"0x17 (Application Data)"},
         {f:"Cipher",      v:"AES-256-GCM"},{f:"Integrity",   v:"HMAC-SHA-256"}],
  SESS: [{f:"Session-ID",  v:"0xA4F2B1C3"},{f:"State",        v:"ESTABLISHED"},{f:"Mode",         v:"Full-duplex"}],
  TCP:  [{f:"Src Port",    v:"54231 (ephemeral)"},{f:"Dst Port",     v:"80 (HTTP)"},
         {f:"Seq Number",  v:"1"},{f:"Ack Number",   v:"0"},
         {f:"Header Len",  v:"20 bytes"},{f:"Flags",        v:"[ SYN ]"},
         {f:"Window",      v:"65535 bytes"},{f:"Checksum",     v:"0x4A2F"}],
  IP:   [{f:"Version",     v:"4 (IPv4)"},{f:"Header Len",  v:"20 bytes"},
         {f:"TTL",         v:"64"},{f:"Protocol",     v:"6 (TCP)"},
         {f:"Src IP",      v:"192.168.1.10"},{f:"Dst IP",       v:"192.168.2.20"},{f:"Checksum",     v:"0x8A4B"}],
  IP_R: [{f:"Version",     v:"4 (IPv4)"},{f:"Header Len",  v:"20 bytes"},
         {f:"TTL",         v:"63  ← decremented by router"},{f:"Protocol",     v:"6 (TCP)"},
         {f:"Src IP",      v:"192.168.1.10  (unchanged)"},{f:"Dst IP",       v:"192.168.2.20  (unchanged)"},
         {f:"Checksum",    v:"0x8A4C  (recalculated)"}],
  ETH:  [{f:"Dst MAC",     v:"DD:EE:FF:00:11:22"},{f:"Dst Host",     v:"Router (LAN-A port)"},
         {f:"Src MAC",     v:"AA:BB:CC:11:22:33"},{f:"Src Host",     v:"PC-A"},
         {f:"EtherType",   v:"0x0800 (IPv4)"}],
  FCS:  [{f:"Algorithm",   v:"CRC-32"},{f:"Value",        v:"0x1A2B3C4D"},{f:"Purpose",     v:"Bit-error detection"}],
  ETH2: [{f:"Dst MAC",     v:"CC:DD:EE:44:55:66"},{f:"Dst Host",     v:"PC-B"},
         {f:"Src MAC",     v:"EE:FF:00:11:22:33"},{f:"Src Host",     v:"Router (LAN-B port)"},
         {f:"EtherType",   v:"0x0800 (IPv4)"},{f:"Note",        v:"New header added by router"}],
  FCS2: [{f:"Algorithm",   v:"CRC-32"},{f:"Value",        v:"0x9E8D7C6B"},{f:"Purpose",     v:"Bit-error detection"}],
};

const ROUTER_AFTER = new Set(["router_fwd","transit_b","pcb_l1","pcb_l2","pcb_l3","pcb_l4","pcb_l5","pcb_l6","pcb_l7","done"]);
const getHF = (key, stepId) => key==="IP"&&ROUTER_AFTER.has(stepId)?HF.IP_R:(HF[key]||[]);

const STEPS = [
  // ═══ Boot Phase ═══════════════════════════════════════════════════════════
  { id:"net_boot", phase:"boot",
    title:"Network initialization — before any data flows",
    desc:"Every device on the network must boot and discover each other before PC-A can send a single packet. The sequence is: Router initializes → Switches run STP → PCs get IPs via DHCP → PCs ARP for their gateway. Click any device in the diagram above to inspect its internal tables at any step.",
    side:null, layer:null, headers:[], pos:0 },

  { id:"router_init", phase:"boot",
    title:"Router powers on — initializes interfaces and services",
    desc:"The router's firmware loads. Both LAN-A (192.168.1.1/24) and LAN-B (192.168.2.1/24) interfaces come up. The routing table is populated with connected routes. The DHCP server starts listening on both interfaces. The router sends LLDP Hello frames out each port to announce its presence to neighbour devices.",
    proto:"eth0 (LAN-A): 192.168.1.1/24  → UP\neth1 (LAN-B): 192.168.2.1/24  → UP\nDHCP server:  listening on eth0 and eth1\nRouting:      192.168.1.0/24 via eth0  [Connected]\n              192.168.2.0/24 via eth1  [Connected]\nLLDP:         Hello frames broadcast on all ports",
    side:"router", layer:null, headers:[], pos:0.5 },

  { id:"switch_init", phase:"boot",
    title:"Switches power on — STP runs, MAC tables are empty",
    desc:"Both LAN-A and LAN-B switches power on with completely empty MAC address tables. Each switch floods STP BPDU (Bridge Protocol Data Units) out every port to elect a Root Bridge and prevent layer-2 loops. After STP converges, all ports enter Forwarding state. The switches are ready — but they don't know any MAC addresses yet. They will learn as frames pass through them.",
    proto:"STP: BPDU broadcast on all ports\nSTP: Root Bridge elected (lowest Bridge ID wins)\nAll ports: Listening → Learning → Forwarding\nMAC tables: EMPTY — will learn from live traffic\nSTP convergence: ~30 seconds (real network)",
    side:null, layer:null, headers:[], pos:0.3 },

  { id:"pca_dhcp", phase:"boot",
    title:"PC-A gets its IP address via DHCP",
    desc:"PC-A's NIC comes up with no IP address. It broadcasts a DHCP Discover (src: 0.0.0.0 → dst: 255.255.255.255) to find any DHCP server. The switch floods the broadcast to all ports — the router receives it. The router replies with a DHCP Offer: IP 192.168.1.10/24, gateway 192.168.1.1, DNS 8.8.8.8. PC-A sends a DHCP Request to accept, and the router sends a DHCP Ack. PC-A is now fully configured. The switch also learns PC-A's MAC from these frames.",
    proto:"→ DHCP Discover  src:0.0.0.0        dst:255.255.255.255\n← DHCP Offer    src:192.168.1.1   dst:255.255.255.255\n→ DHCP Request  src:0.0.0.0        dst:255.255.255.255\n← DHCP Ack      src:192.168.1.1   dst:192.168.1.10\n\nPC-A: 192.168.1.10/24  GW:192.168.1.1  DNS:8.8.8.8",
    side:"A", layer:null, headers:[], pos:0 },

  { id:"pcb_dhcp", phase:"boot",
    title:"PC-B gets its IP address via DHCP",
    desc:"PC-B performs the identical DHCP process on LAN-B. It broadcasts a DHCP Discover, the router's DHCP server on eth1 responds with a DHCP Offer: IP 192.168.2.20/24, gateway 192.168.2.1. After the full four-step handshake (Discover → Offer → Request → Ack), PC-B is configured and the LAN-B switch learns PC-B's MAC.",
    proto:"→ DHCP Discover  src:0.0.0.0        dst:255.255.255.255\n← DHCP Offer    src:192.168.2.1   dst:255.255.255.255\n→ DHCP Request  src:0.0.0.0        dst:255.255.255.255\n← DHCP Ack      src:192.168.2.1   dst:192.168.2.20\n\nPC-B: 192.168.2.20/24  GW:192.168.2.1  DNS:8.8.8.8",
    side:"B", layer:null, headers:[], pos:1 },

  { id:"pca_arp_gw", phase:"boot",
    title:"PC-A resolves the router MAC via ARP",
    desc:"PC-A wants to reach 192.168.2.20 (a different subnet), so it must forward to its default gateway (192.168.1.1). PC-A knows the gateway IP but not its MAC address. It broadcasts an ARP Request on LAN-A: 'Who has 192.168.1.1? Tell 192.168.1.10'. The router replies: '192.168.1.1 is at DD:EE:FF:00:11:22'. PC-A caches the router's MAC and can now build Ethernet frames with the correct destination MAC for all off-LAN traffic.",
    proto:"→ ARP Request  broadcast: Who has 192.168.1.1?  Tell 192.168.1.10\n← ARP Reply    DD:EE:FF:00:11:22: I have 192.168.1.1!\n\nPC-A ARP cache: 192.168.1.1 → DD:EE:FF:00:11:22  (Router LAN-A)",
    side:"A", layer:null, headers:[], pos:0 },

  // ═══ HTTP Phase ════════════════════════════════════════════════════════════
  { id:"start", phase:"http",
    title:"Network ready — PC-A opens browser to 192.168.2.20",
    desc:"The network is fully initialized. PC-A (192.168.1.10) opens a browser and types 192.168.2.20 — the web server running on PC-B. The browser will generate an HTTP GET request that must travel through all 7 OSI layers, across two LANs via the router, to reach PC-B. Press Next to watch encapsulation happen layer by layer.",
    side:null, layer:null, headers:[], pos:0 },
  { id:"pca_l7",   phase:"http", title:"Layer 7 · Application — PC-A",
    desc:"The browser creates an HTTP GET request. This is the raw payload — just the message the application wants to send. No network addressing exists yet.",
    proto:"HTTP  GET /index.html HTTP/1.1\n      Host: 192.168.2.20",
    side:"A", layer:7, headers:["APP"], pos:0 },
  { id:"pca_l6",   phase:"http", title:"Layer 6 · Presentation — PC-A",
    desc:"The data is formatted and encoded. If using HTTPS, TLS encryption wraps the payload here so only the intended recipient can decrypt it.",
    proto:"TLS encrypt → [encrypted ciphertext]",
    side:"A", layer:6, headers:["PRES","APP"], pos:0 },
  { id:"pca_l5",   phase:"http", title:"Layer 5 · Session — PC-A",
    desc:"A session is opened between the two applications. The session layer tracks the conversation and handles synchronisation checkpoints.",
    proto:"Session-ID: 0xA4F2B1C3  →  ESTABLISHED",
    side:"A", layer:5, headers:["SESS","PRES","APP"], pos:0 },
  { id:"pca_l4",   phase:"http", title:"Layer 4 · Transport — PC-A",
    desc:"TCP adds a header with source port 54231 and destination port 80 (HTTP). It sequences the data and guarantees delivery — lost segments are automatically retransmitted.",
    proto:"TCP  src:54231  dst:80  seq:1  ack:0  [SYN]",
    side:"A", layer:4, headers:["TCP","SESS","PRES","APP"], pos:0 },
  { id:"pca_l3",   phase:"http", title:"Layer 3 · Network — PC-A",
    desc:"The IP layer adds source IP (192.168.1.10) and destination IP (192.168.2.20). TTL is set to 64 — it decrements at each router hop to prevent packets looping forever.",
    proto:"IP  src:192.168.1.10  dst:192.168.2.20  TTL:64  proto:TCP",
    side:"A", layer:3, headers:["IP","TCP","SESS","PRES","APP"], pos:0 },
  { id:"pca_l2",   phase:"http", title:"Layer 2 · Data Link — PC-A",
    desc:"PC-B is on a different network, so the frame must go to the router first. PC-A already has the router's MAC in its ARP cache (from the boot phase). An Ethernet frame is built with the router MAC as destination.",
    proto:"ETH  src:AA:BB:CC:11:22:33  dst:DD:EE:FF:00:11:22  +FCS\n(router MAC already in ARP cache from boot phase)",
    side:"A", layer:2, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0 },
  { id:"pca_l1",   phase:"http", title:"Layer 1 · Physical — PC-A",
    desc:"The frame is converted to electrical signals. The physical layer puts bits on the wire at 1 Gbps.",
    proto:"10101100 00010000 ... (bits on Cat5e Gigabit Ethernet)",
    side:"A", layer:1, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0 },
  { id:"transit_a", phase:"http", title:"Crossing LAN-A — Switch forwards the frame",
    desc:"The LAN-A switch reads the destination MAC, looks it up in its MAC address table, and forwards the frame out the correct port toward the router. Switches are Layer 2 — they never look at IP addresses.",
    side:"transit_a", layer:null, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0.3 },
  { id:"router_rx", phase:"http", title:"Router — strips Layer 2, reads Layer 3",
    desc:"The router's LAN-A interface receives the frame. It checks the destination MAC (matches its own), verifies the FCS, strips the Ethernet header and trailer, and reads the destination IP to decide where to forward. PC-A's MAC is now in the router's ARP table.",
    proto:"Router strips ETH header + FCS  →  reads IP dst: 192.168.2.20",
    side:"router", layer:null, headers:["IP","TCP","SESS","PRES","APP"], pos:0.5 },
  { id:"router_fwd", phase:"http", title:"Router — routing decision + re-encapsulation",
    desc:"The routing table shows 192.168.2.0/24 is reachable on LAN-B. TTL is decremented (64→63). The router sends an ARP request on LAN-B to learn PC-B's MAC, then builds a brand-new Ethernet frame with new L2 headers.",
    proto:"New ETH  src:EE:FF:00:11:22:33  dst:CC:DD:EE:44:55:66  IP TTL:63",
    side:"router", layer:null, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:0.5 },
  { id:"transit_b", phase:"http", title:"Crossing LAN-B — Switch delivers to PC-B",
    desc:"The LAN-B switch reads the destination MAC (PC-B's) and forwards the frame out the correct port.",
    side:"transit_b", layer:null, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:0.7 },
  { id:"pcb_l1",   phase:"http", title:"Layer 1 · Physical — PC-B",
    desc:"PC-B's NIC detects the electrical signals and reconstructs the bit stream.",
    side:"B", layer:1, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:1 },
  { id:"pcb_l2",   phase:"http", title:"Layer 2 · Data Link — PC-B",
    desc:"PC-B checks the destination MAC — it matches its own NIC. The FCS is verified. The Ethernet header and FCS trailer are stripped.",
    side:"B", layer:2, headers:["IP","TCP","SESS","PRES","APP"], pos:1 },
  { id:"pcb_l3",   phase:"http", title:"Layer 3 · Network — PC-B",
    desc:"The IP layer reads the destination IP (192.168.2.20) — it matches PC-B. The TTL (63) confirms exactly one router hop. The IP header is stripped.",
    side:"B", layer:3, headers:["TCP","SESS","PRES","APP"], pos:1 },
  { id:"pcb_l4",   phase:"http", title:"Layer 4 · Transport — PC-B",
    desc:"TCP reads the destination port (80) and delivers the segment to the web server process. A TCP ACK is queued.",
    side:"B", layer:4, headers:["SESS","PRES","APP"], pos:1 },
  { id:"pcb_l5",   phase:"http", title:"Layer 5 · Session — PC-B",
    desc:"The session ID (0xA4F2B1C3) is matched to this conversation.",
    side:"B", layer:5, headers:["PRES","APP"], pos:1 },
  { id:"pcb_l6",   phase:"http", title:"Layer 6 · Presentation — PC-B",
    desc:"TLS decrypts the payload using the shared session keys. The data is decoded back into the format the application expects.",
    side:"B", layer:6, headers:["APP"], pos:1 },
  { id:"pcb_l7",   phase:"http", title:"Layer 7 · Application — PC-B",
    desc:"The web server application receives the HTTP GET request and sends back an HTTP 200 OK response.",
    proto:"HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html>...",
    side:"B", layer:7, headers:[], pos:1 },
  { id:"done", phase:"http", title:"Delivery complete!",
    desc:"Key insight: IP addresses (Layer 3) stay the same end-to-end — they identify source and final destination. MAC addresses (Layer 2) change at every hop — they only matter on the current network segment. The router is the boundary: it reads L3 to route, re-writes L2 to deliver.",
    side:null, layer:null, headers:[], pos:1 },
];

// ── State helpers ─────────────────────────────────────────────────────────────
function stepAtOrPast(si, id) {
  const target = STEPS.findIndex(s => s.id === id);
  return target !== -1 && si >= target;
}

function getArpState(si) {
  return {
    router: [
      stepAtOrPast(si,"router_rx")  && {ip:"192.168.1.10", mac:"AA:BB:CC:11:22:33", iface:"LAN-A"},
      stepAtOrPast(si,"router_fwd") && {ip:"192.168.2.20", mac:"CC:DD:EE:44:55:66", iface:"LAN-B"},
    ].filter(Boolean),
    pcA: stepAtOrPast(si,"pca_arp_gw") ? [{ip:"192.168.1.1", mac:"DD:EE:FF:00:11:22", host:"Router LAN-A"}] : [],
    pcB: stepAtOrPast(si,"pcb_l2")     ? [{ip:"192.168.2.1", mac:"EE:FF:00:11:22:33", host:"Router LAN-B"}] : [],
  };
}

function getDhcpLeases(si) {
  return [
    stepAtOrPast(si,"pca_dhcp") && {ip:"192.168.1.10",mac:"AA:BB:CC:11:22:33",host:"PC-A", iface:"LAN-A",lease:"24h"},
    stepAtOrPast(si,"pcb_dhcp") && {ip:"192.168.2.20",mac:"CC:DD:EE:44:55:66",host:"PC-B", iface:"LAN-B",lease:"24h"},
  ].filter(Boolean);
}

function getSwitchAMac(si) {
  if (!stepAtOrPast(si,"pca_dhcp")) return [];
  return [
    {mac:"AA:BB:CC:11:22:33", port:"Fa0/1",  host:"PC-A",          vlan:1, type:"Dynamic"},
    {mac:"DD:EE:FF:00:11:22", port:"Fa0/24", host:"Router (LAN-A)", vlan:1, type:"Dynamic"},
  ];
}

function getSwitchBMac(si) {
  if (!stepAtOrPast(si,"pcb_dhcp")) return [];
  return [
    {mac:"CC:DD:EE:44:55:66", port:"Fa0/1",  host:"PC-B",          vlan:1, type:"Dynamic"},
    {mac:"EE:FF:00:11:22:33", port:"Fa0/24", host:"Router (LAN-B)", vlan:1, type:"Dynamic"},
  ];
}

function getRouterRoutes() {
  return [
    {dst:"192.168.1.0/24", nh:"0.0.0.0 (direct)", iface:"LAN-A (eth0)", type:"C"},
    {dst:"192.168.2.0/24", nh:"0.0.0.0 (direct)", iface:"LAN-B (eth1)", type:"C"},
    {dst:"0.0.0.0/0",      nh:"ISP gateway",       iface:"WAN",          type:"S*"},
  ];
}

function getPcRoutes(side, si) {
  if (!stepAtOrPast(si, side==="A"?"pca_dhcp":"pcb_dhcp")) return [];
  return side==="A"
    ? [{dst:"192.168.1.0/24",nh:"0.0.0.0 (direct)",iface:"eth0",type:"C"},{dst:"0.0.0.0/0",nh:"192.168.1.1",iface:"eth0",type:"default"}]
    : [{dst:"192.168.2.0/24",nh:"0.0.0.0 (direct)",iface:"eth0",type:"C"},{dst:"0.0.0.0/0",nh:"192.168.2.1",iface:"eth0",type:"default"}];
}

// ── Topology Diagram ──────────────────────────────────────────────────────────
const TOPO_NODES = [
  {x:85,  label:"PC-A",   ip:"192.168.1.10",  mac:"AA:BB:CC:11:22:33", key:"A",       shape:"pc"},
  {x:255, label:"Switch", ip:"No IP  (L2)",   mac:"",                   key:"switchA", shape:"sw"},
  {x:445, label:"Router", ip:"1.1 / 2.1",     mac:"DD:.. / EE:..",     key:"router",  shape:"rt"},
  {x:635, label:"Switch", ip:"No IP  (L2)",   mac:"",                   key:"switchB", shape:"sw"},
  {x:815, label:"PC-B",   ip:"192.168.2.20",  mac:"CC:DD:EE:44:55:66", key:"B",       shape:"pc"},
];

function TopologyDiagram({ pos, activeSide, selectedDevice, onSelectDevice }) {
  const isActive   = k => activeSide===k||(activeSide==="transit_a"&&k==="switchA")||(activeSide==="transit_b"&&k==="switchB");
  const isSelected = k => selectedDevice===k;
  const dotX = 85 + pos * (815 - 85);

  return (
    <div className="osi-topo-wrap">
      <p className="osi-topo-hint">↑ Click any device to inspect its internal tables</p>
      <svg viewBox="0 0 900 162" className="osi-topo-svg">
        <rect x="6"   y="18" width="344" height="122" rx="12" fill="rgba(99,179,237,0.05)"  stroke="rgba(99,179,237,0.2)"  strokeWidth="1"/>
        <text x="16" y="31" fontSize="9" fill="#63b3ed" fontFamily="'JetBrains Mono',monospace" fontWeight="600" letterSpacing="0.4">LAN-A · 192.168.1.0/24  ·  DHCP: 192.168.1.1  ·  DNS: 8.8.8.8</text>
        <rect x="550" y="18" width="344" height="122" rx="12" fill="rgba(66,217,184,0.05)"  stroke="rgba(66,217,184,0.2)"  strokeWidth="1"/>
        <text x="560" y="31" fontSize="9" fill="#42d9b8" fontFamily="'JetBrains Mono',monospace" fontWeight="600" letterSpacing="0.4">LAN-B · 192.168.2.0/24  ·  DHCP: 192.168.2.1  ·  DNS: 8.8.8.8</text>
        <rect x="378" y="30" width="134" height="100" rx="10" fill="rgba(251,146,60,0.05)"  stroke="rgba(251,146,60,0.25)" strokeWidth="1"/>
        <line x1="85" y1="78" x2="815" y2="78" stroke="rgba(255,255,255,0.1)" strokeWidth="2"/>
        {TOPO_NODES.map(n => {
          const active   = isActive(n.key);
          const selected = isSelected(n.key);
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

// ── Device Inspector ──────────────────────────────────────────────────────────
function DiTable({ cols, rows, empty }) {
  if (!rows.length) return <p className="osi-di-empty">{empty}</p>;
  return (
    <table className="osi-di-tbl">
      <thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r,i)=><tr key={i}>{r.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}

function DeviceInspector({ deviceKey, si, onClose }) {
  const arp     = getArpState(si);
  const dev     = DEVICES[deviceKey];
  const routerUp   = stepAtOrPast(si,"router_init");
  const switchUp   = stepAtOrPast(si,"switch_init");
  const cfgA       = stepAtOrPast(si,"pca_dhcp");
  const cfgB       = stepAtOrPast(si,"pcb_dhcp");

  return (
    <div className="osi-di">
      <div className="osi-di-hdr">
        <div>
          <span className="osi-di-name">{dev?.name||deviceKey}</span>
          <span className="osi-di-type">{dev?.type}</span>
        </div>
        <button className="osi-di-close" onClick={onClose}>✕ Close</button>
      </div>
      <div className="osi-di-body">

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
            <DiTable cols={["Destination","Next Hop","Interface","Type"]} rows={getPcRoutes("A",si).map(r=>[r.dst,r.nh,r.iface,r.type])} empty="No routes — waiting for DHCP"/>
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
            <DiTable cols={["Destination","Next Hop","Interface","Type"]} rows={getPcRoutes("B",si).map(r=>[r.dst,r.nh,r.iface,r.type])} empty="No routes — waiting for DHCP"/>
          </div>
        </>}

        {/* Router */}
        {deviceKey==="router"&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">Routing Table</div>
            {routerUp
              ? <DiTable cols={["Destination","Next Hop","Interface","Type"]} rows={getRouterRoutes().map(r=>[r.dst,r.nh,r.iface,r.type])} empty=""/>
              : <p className="osi-di-empty">Router not yet initialized</p>}
            <div className="osi-di-section" style={{marginTop:14}}>Interfaces</div>
            <DiTable cols={["Interface","IP","MAC","State"]}
              rows={routerUp?[["LAN-A (eth0)","192.168.1.1/24","DD:EE:FF:00:11:22","UP"],["LAN-B (eth1)","192.168.2.1/24","EE:FF:00:11:22:33","UP"]]:[]}
              empty="Interfaces down"/>
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">ARP Table</div>
            <DiTable cols={["IP Address","MAC Address","Interface"]} rows={arp.router.map(r=>[r.ip,r.mac,r.iface])} empty="Empty — no frames received yet"/>
            <div className="osi-di-section" style={{marginTop:14}}>DHCP Leases</div>
            <DiTable cols={["IP","MAC","Host","Interface","Lease"]} rows={getDhcpLeases(si).map(r=>[r.ip,r.mac,r.host,r.iface,r.lease])} empty="No leases yet"/>
          </div>
        </>}

        {/* Switch-A */}
        {deviceKey==="switchA"&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">MAC Address Table</div>
            <DiTable cols={["MAC Address","Port","Host","VLAN","Type"]}
              rows={getSwitchAMac(si).map(r=>[r.mac,r.port,r.host,r.vlan,r.type])}
              empty={switchUp?"Empty — no traffic has passed through yet":"Switch not yet initialized"}/>
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">STP / Port State</div>
            <DiTable cols={["Property","Value"]} rows={switchUp?[
              ["Role",          "Root Bridge"],
              ["All ports",     "Forwarding"],
              ["BPDU",          "Sent during boot"],
              ["IP Address",    "None (L2 only)"],
              ["Unknown frames","Flooded to all ports"],
              ["Broadcast",     "Flooded to all ports"],
            ]:[["Status","Not initialized"]]} empty=""/>
          </div>
        </>}

        {/* Switch-B */}
        {deviceKey==="switchB"&&<>
          <div className="osi-di-col">
            <div className="osi-di-section">MAC Address Table</div>
            <DiTable cols={["MAC Address","Port","Host","VLAN","Type"]}
              rows={getSwitchBMac(si).map(r=>[r.mac,r.port,r.host,r.vlan,r.type])}
              empty={switchUp?"Empty — no traffic has passed through yet":"Switch not yet initialized"}/>
          </div>
          <div className="osi-di-col">
            <div className="osi-di-section">STP / Port State</div>
            <DiTable cols={["Property","Value"]} rows={switchUp?[
              ["Role",          "Root Bridge"],
              ["All ports",     "Forwarding"],
              ["BPDU",          "Sent during boot"],
              ["IP Address",    "None (L2 only)"],
              ["Unknown frames","Flooded to all ports"],
              ["Broadcast",     "Flooded to all ports"],
            ]:[["Status","Not initialized"]]} empty=""/>
          </div>
        </>}

      </div>
    </div>
  );
}

// ── Layer Stack ───────────────────────────────────────────────────────────────
function LayerStack({ side, getState }) {
  return (
    <div className="osi-stack">
      <div className="osi-stack-head">
        <span className="osi-stack-pc">{side==="A"?"PC-A":"PC-B"}</span>
        <span className="osi-stack-ip">{side==="A"?"192.168.1.10":"192.168.2.20"}</span>
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
function PacketInspector({ headers, activeLayer, stepId }) {
  const [open,setOpen]=useState(null);
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
      {!headers.length&&(
        <div className="osi-inspector-empty">
          {stepId==="done"?"Payload delivered to application layer":isBoot?"No data frame — this is network control traffic (DHCP, ARP, STP BPDUs)":"No headers yet — waiting for encapsulation"}
        </div>
      )}
      {headers.map((h,i)=>{
        const meta=HM[h];const lc=LC[meta.layer];
        const isOpen=open===h;const isActive=meta.layer===activeLayer;
        const fields=getHF(h,stepId);
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

// ── Device Config Panel ───────────────────────────────────────────────────────
function DevicePanel({ activeSide }) {
  const key=activeSide==="A"?"A":activeSide==="B"?"B":activeSide==="router"?"router":
            activeSide==="transit_a"||activeSide==="switchA"?"switchA":
            activeSide==="transit_b"||activeSide==="switchB"?"switchB":null;
  const dev=key?DEVICES[key]:null;
  return (
    <div className="osi-devpanel">
      <div className="osi-devpanel-title">{dev?`${dev.name}  —  ${dev.type}`:"Network Devices"}</div>
      {dev
        ? <table className="osi-devtable"><tbody>
            {dev.rows.map((r,i)=><tr key={i}><td className="osi-devtable-k">{r.k}</td><td className="osi-devtable-v">{r.v}</td></tr>)}
          </tbody></table>
        : <div className="osi-devpanel-hint">Step through the simulation to inspect each device's config. Click a device in the diagram to see its full tables.</div>}
    </div>
  );
}

// ── ARP Panel ─────────────────────────────────────────────────────────────────
function ArpPanel({ si, activeSide }) {
  const arp=getArpState(si);
  const showPcA=activeSide==="A";const showPcB=activeSide==="B";
  const table=showPcA?arp.pcA:showPcB?arp.pcB:arp.router;
  const title=showPcA?"PC-A ARP Cache":showPcB?"PC-B ARP Cache":"Router ARP Table";
  const cols=showPcA||showPcB?["IP Address","MAC Address","Host"]:["IP Address","MAC Address","Interface"];
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
  const [step,setStep]       = useState(0);
  const [playing,setPlaying] = useState(false);
  const [selDev,setSelDev]   = useState(null);
  const timer=useRef(null);
  const cur=STEPS[step];

  useEffect(()=>{
    if(playing){
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

  const getStateA=n=>{
    if(cur.side==="A"&&cur.layer===n)return"active";
    const idx=STEPS.findIndex(s=>s.id===`pca_l${n}`);
    return idx!==-1&&step>idx?"done":"pending";
  };
  const getStateB=n=>{
    if(cur.side==="B"&&cur.layer===n)return"active";
    const idx=STEPS.findIndex(s=>s.id===`pcb_l${n}`);
    return idx!==-1&&step>idx?"done":"pending";
  };

  const pct=Math.round((step/(STEPS.length-1))*100);

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
        <a href="/" className="osi-back">← Portfolio</a>
      </header>

      <main className="osi-main">

        <TopologyDiagram pos={cur.pos} activeSide={cur.side} selectedDevice={selDev} onSelectDevice={setSelDev}/>

        {selDev && <DeviceInspector deviceKey={selDev} si={step} onClose={()=>setSelDev(null)}/>}

        <div className="osi-mid">
          <LayerStack side="A" getState={getStateA}/>
          <PacketInspector headers={cur.headers} activeLayer={cur.layer} stepId={cur.id}/>
          <LayerStack side="B" getState={getStateB}/>
        </div>

        {!selDev && (
          <div className="osi-details">
            <DevicePanel activeSide={cur.side}/>
            <ArpPanel si={step} activeSide={cur.side}/>
          </div>
        )}

        <div className="osi-info">
          <div className="osi-info-top">
            <span className="osi-step-badge">Step {step+1} / {STEPS.length}</span>
            {cur.phase==="boot" && <span className="osi-sbadge osi-sbadge-boot">🔌 Boot Phase</span>}
            {cur.phase==="http"&&cur.side==="A"&&<span className="osi-sbadge osi-sbadge-a">PC-A encapsulating ↓</span>}
            {cur.phase==="http"&&cur.side==="B"&&<span className="osi-sbadge osi-sbadge-b">PC-B decapsulating ↑</span>}
            {cur.side==="router"&&<span className="osi-sbadge osi-sbadge-r">Router processing</span>}
            {(cur.side==="transit_a"||cur.side==="transit_b")&&<span className="osi-sbadge osi-sbadge-t">In transit</span>}
          </div>
          <h2 className="osi-info-title">{cur.title}</h2>
          <p  className="osi-info-desc">{cur.desc}</p>
          {cur.proto&&<pre className="osi-proto-block">{cur.proto}</pre>}
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
