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
const getHF = (key, stepId) => key === "IP" && ROUTER_AFTER.has(stepId) ? HF.IP_R : (HF[key] || []);

const STEPS = [
  { id:"start",     title:"How data travels across networks",
    desc:"PC-A (192.168.1.10) wants to load a web page from PC-B (192.168.2.20). They sit on different LANs separated by a router. Press Next to watch the HTTP request travel through every OSI layer, hop by hop, all the way to its destination.",
    side:null, layer:null, headers:[], pos:0 },
  { id:"pca_l7",   title:"Layer 7 · Application — PC-A",
    desc:"The browser creates an HTTP GET request. This is the raw payload — just the message the application wants to send. No network addressing exists yet.",
    proto:"HTTP  GET /index.html HTTP/1.1\n      Host: 192.168.2.20",
    side:"A", layer:7, headers:["APP"], pos:0 },
  { id:"pca_l6",   title:"Layer 6 · Presentation — PC-A",
    desc:"The data is formatted and encoded. If using HTTPS, TLS encryption wraps the payload here so only the intended recipient can decrypt it. Both sides must agree on the data format (UTF-8, JSON, etc.).",
    proto:"TLS encrypt → [encrypted ciphertext]",
    side:"A", layer:6, headers:["PRES","APP"], pos:0 },
  { id:"pca_l5",   title:"Layer 5 · Session — PC-A",
    desc:"A session is opened between the two applications. The session layer tracks the conversation and handles synchronisation checkpoints so a broken transfer can resume without starting over.",
    proto:"Session-ID: 0xA4F2B1C3  →  ESTABLISHED",
    side:"A", layer:5, headers:["SESS","PRES","APP"], pos:0 },
  { id:"pca_l4",   title:"Layer 4 · Transport — PC-A",
    desc:"TCP adds a header with a randomly chosen source port (54231) and destination port (80 for HTTP). It sequences the data into segments and guarantees delivery — lost segments are automatically retransmitted.",
    proto:"TCP  src:54231  dst:80  seq:1  ack:0  [SYN]",
    side:"A", layer:4, headers:["TCP","SESS","PRES","APP"], pos:0 },
  { id:"pca_l3",   title:"Layer 3 · Network — PC-A",
    desc:"The IP layer adds the source IP (192.168.1.10) and destination IP (192.168.2.20). TTL is set to 64 — it decrements at each router hop to prevent packets looping forever. Routers read this layer to decide where to forward.",
    proto:"IP  src:192.168.1.10  dst:192.168.2.20  TTL:64  proto:TCP",
    side:"A", layer:3, headers:["IP","TCP","SESS","PRES","APP"], pos:0 },
  { id:"pca_l2",   title:"Layer 2 · Data Link — PC-A",
    desc:"PC-B is on a different network, so the frame must go to the router first. PC-A sends an ARP request to discover the router's MAC address (DD:EE:FF:00:11:22). An Ethernet frame is built with that MAC as destination. A Frame Check Sequence (FCS) trailer is appended for error detection.",
    proto:"ARP: Who has 192.168.1.1? → DD:EE:FF:00:11:22\nETH  src:AA:BB:CC:11:22:33  dst:DD:EE:FF:00:11:22  +FCS",
    side:"A", layer:2, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0 },
  { id:"pca_l1",   title:"Layer 1 · Physical — PC-A",
    desc:"The frame is converted to electrical signals (voltage pulses on Cat5e cable, or radio waves on Wi-Fi). The physical layer knows nothing about addresses — it simply puts bits on the wire at the agreed speed (e.g. 1 Gbps).",
    proto:"10101100 00010000 ... (bits on Cat5e Gigabit Ethernet)",
    side:"A", layer:1, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0 },
  { id:"transit_a", title:"Crossing LAN-A — Switch forwards the frame",
    desc:"The electrical signals travel to the LAN-A switch. The switch reads only the destination MAC in the Ethernet header, looks it up in its MAC address table, and forwards the frame out the correct port toward the router. Switches operate at Layer 2 — they never look at IP addresses.",
    side:"transit_a", layer:null, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0.3 },
  { id:"router_rx", title:"Router — strips Layer 2, reads Layer 3",
    desc:"The router's LAN-A interface receives the Ethernet frame. It checks the destination MAC (matches its own), verifies the FCS, then strips the entire Ethernet header and trailer. The router now has a bare IP packet and reads the destination IP to decide where to forward it. PC-A's MAC is now in the router's ARP table.",
    proto:"Router strips ETH header + FCS  →  reads IP dst: 192.168.2.20",
    side:"router", layer:null, headers:["IP","TCP","SESS","PRES","APP"], pos:0.5 },
  { id:"router_fwd", title:"Router — routing decision + re-encapsulation",
    desc:"The routing table shows 192.168.2.0/24 is reachable on the LAN-B interface. TTL is decremented (64→63). The router sends an ARP request on LAN-B to learn PC-B's MAC (CC:DD:EE:44:55:66), then builds a brand-new Ethernet frame — same IP packet inside, completely new L2 header with new MACs.",
    proto:"New ETH  src:EE:FF:00:11:22:33  dst:CC:DD:EE:44:55:66  IP TTL:63",
    side:"router", layer:null, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:0.5 },
  { id:"transit_b", title:"Crossing LAN-B — Switch delivers to PC-B",
    desc:"The router transmits the re-encapsulated frame onto LAN-B. The LAN-B switch reads the destination MAC (PC-B's MAC) and forwards the frame directly out the port where PC-B is connected.",
    side:"transit_b", layer:null, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:0.7 },
  { id:"pcb_l1",   title:"Layer 1 · Physical — PC-B",
    desc:"PC-B's NIC detects the electrical signals and reconstructs the bit stream. It identifies the frame boundaries from the preamble and start-of-frame delimiter, then passes the bits up to Layer 2.",
    side:"B", layer:1, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:1 },
  { id:"pcb_l2",   title:"Layer 2 · Data Link — PC-B",
    desc:"PC-B checks the destination MAC — it matches its own NIC. The FCS is verified to confirm no bit errors occurred in transit. The Ethernet header and FCS trailer are stripped, and the IP packet is handed up to Layer 3.",
    side:"B", layer:2, headers:["IP","TCP","SESS","PRES","APP"], pos:1 },
  { id:"pcb_l3",   title:"Layer 3 · Network — PC-B",
    desc:"The IP layer reads the destination IP (192.168.2.20) — it matches PC-B's own address. The TTL (63) confirms it passed through exactly one router. The IP header is stripped and the TCP segment is passed up.",
    side:"B", layer:3, headers:["TCP","SESS","PRES","APP"], pos:1 },
  { id:"pcb_l4",   title:"Layer 4 · Transport — PC-B",
    desc:"TCP reads the destination port (80) and delivers the segment to the web server process. A TCP ACK is queued to confirm receipt. The TCP header is stripped.",
    side:"B", layer:4, headers:["SESS","PRES","APP"], pos:1 },
  { id:"pcb_l5",   title:"Layer 5 · Session — PC-B",
    desc:"The session ID (0xA4F2B1C3) is matched to this conversation. The session layer ensures this data belongs to the correct ongoing exchange.",
    side:"B", layer:5, headers:["PRES","APP"], pos:1 },
  { id:"pcb_l6",   title:"Layer 6 · Presentation — PC-B",
    desc:"If TLS was applied by PC-A's Layer 6, it is decrypted here using the shared session keys. The data is decoded back into the format the application expects.",
    side:"B", layer:6, headers:["APP"], pos:1 },
  { id:"pcb_l7",   title:"Layer 7 · Application — PC-B",
    desc:"The web server application receives the HTTP GET request and can now send back an HTTP 200 OK response — which travels back through all 7 layers in the reverse direction.",
    proto:"HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html>...",
    side:"B", layer:7, headers:[], pos:1 },
  { id:"done",     title:"Delivery complete!",
    desc:"Key insight: IP addresses (Layer 3) stay the same end-to-end — they identify source and final destination. MAC addresses (Layer 2) change at every hop — they only matter on the current network segment. The router is the boundary: it reads L3 to route, re-writes L2 to deliver.",
    side:null, layer:null, headers:[], pos:1 },
];

function getArpState(si) {
  return {
    router: [
      si >= 9  && {ip:"192.168.1.10", mac:"AA:BB:CC:11:22:33", iface:"LAN-A"},
      si >= 10 && {ip:"192.168.2.20", mac:"CC:DD:EE:44:55:66", iface:"LAN-B"},
    ].filter(Boolean),
    pcA: si >= 6  ? [{ip:"192.168.1.1", mac:"DD:EE:FF:00:11:22", host:"Router LAN-A"}] : [],
    pcB: si >= 12 ? [{ip:"192.168.2.1", mac:"EE:FF:00:11:22:33", host:"Router LAN-B"}] : [],
  };
}

// ── Topology Diagram ──────────────────────────────────────────────────────────
function TopologyDiagram({ pos, activeSide }) {
  const nodes = [
    { x:85,  label:"PC-A",   ip:"192.168.1.10",  mac:"AA:BB:CC:11:22:33", side:"A",       shape:"pc" },
    { x:255, label:"Switch", ip:"No IP  (L2)",   mac:"",                   side:"switchA", shape:"sw" },
    { x:445, label:"Router", ip:"1.1 / 2.1",     mac:"DD:EE:FF... / EE:FF...", side:"router", shape:"rt" },
    { x:635, label:"Switch", ip:"No IP  (L2)",   mac:"",                   side:"switchB", shape:"sw" },
    { x:815, label:"PC-B",   ip:"192.168.2.20",  mac:"CC:DD:EE:44:55:66", side:"B",       shape:"pc" },
  ];
  const isActive = (s) => activeSide === s || (activeSide==="transit_a"&&s==="switchA") || (activeSide==="transit_b"&&s==="switchB");
  const dotX = 85 + pos * (815 - 85);
  return (
    <svg viewBox="0 0 900 162" className="osi-topo-svg">
      {/* Segment backgrounds */}
      <rect x="6" y="18" width="344" height="122" rx="12" fill="rgba(99,179,237,0.05)" stroke="rgba(99,179,237,0.2)" strokeWidth="1"/>
      <text x="16" y="31" fontSize="9" fill="#63b3ed" fontFamily="'JetBrains Mono',monospace" fontWeight="600" letterSpacing="0.4">LAN-A · 192.168.1.0/24  ·  DHCP: 192.168.1.1  ·  DNS: 8.8.8.8</text>
      <rect x="550" y="18" width="344" height="122" rx="12" fill="rgba(66,217,184,0.05)" stroke="rgba(66,217,184,0.2)" strokeWidth="1"/>
      <text x="560" y="31" fontSize="9" fill="#42d9b8" fontFamily="'JetBrains Mono',monospace" fontWeight="600" letterSpacing="0.4">LAN-B · 192.168.2.0/24  ·  DHCP: 192.168.2.1  ·  DNS: 8.8.8.8</text>
      {/* Router zone */}
      <rect x="378" y="30" width="134" height="100" rx="10" fill="rgba(251,146,60,0.05)" stroke="rgba(251,146,60,0.25)" strokeWidth="1"/>
      {/* Wire */}
      <line x1="85" y1="78" x2="815" y2="78" stroke="rgba(255,255,255,0.1)" strokeWidth="2"/>
      {/* Nodes */}
      {nodes.map(n => {
        const active = isActive(n.side);
        const c = active ? "#42d9b8" : "rgba(255,255,255,0.28)";
        const bg = active ? "rgba(66,217,184,0.14)" : "rgba(13,19,30,0.95)";
        return (
          <g key={n.side}>
            <circle cx={n.x} cy={78} r={28} fill={bg} stroke={c} strokeWidth={active?2.5:1}/>
            {n.shape==="pc" && <>
              <rect x={n.x-11} y={64} width={22} height={15} rx={2} fill="none" stroke={c} strokeWidth={1.5}/>
              <line x1={n.x-7} y1={79} x2={n.x+7} y2={79} stroke={c} strokeWidth={1.5}/>
              <line x1={n.x-5} y1={82} x2={n.x+5} y2={82} stroke={c} strokeWidth={1}/>
            </>}
            {n.shape==="rt" && <polygon points={`${n.x},51 ${n.x+18},78 ${n.x},105 ${n.x-18},78`} fill="none" stroke={c} strokeWidth={1.5}/>}
            {n.shape==="sw" && <>
              <rect x={n.x-14} y={67} width={28} height={19} rx={2} fill="none" stroke={c} strokeWidth={1.5}/>
              {[-8,-2,4,10].map(dx=><line key={dx} x1={n.x+dx} y1={67} x2={n.x+dx} y2={61} stroke={c} strokeWidth={1}/>)}
            </>}
            <text x={n.x} y={114} textAnchor="middle" fontSize="10" fontWeight={active?"700":"500"} fill={active?"#42d9b8":"rgba(241,245,249,0.8)"} fontFamily="Inter,sans-serif">{n.label}</text>
            <text x={n.x} y={126} textAnchor="middle" fontSize="8" fill={active?"rgba(66,217,184,0.8)":"rgba(241,245,249,0.42)"} fontFamily="'JetBrains Mono',monospace">{n.ip}</text>
            {n.mac && <text x={n.x} y={137} textAnchor="middle" fontSize="7.5" fill="rgba(241,245,249,0.28)" fontFamily="'JetBrains Mono',monospace">{n.mac.slice(0,17)}</text>}
          </g>
        );
      })}
      {/* Packet dot */}
      <g style={{transform:`translateX(${dotX-85}px)`,transition:"transform 0.5s ease-in-out"}}>
        <circle cx={85} cy={78} r={14} fill="rgba(66,217,184,0.12)"/>
        <circle cx={85} cy={78} r={8}  fill="rgba(66,217,184,0.35)"/>
        <circle cx={85} cy={78} r={4}  fill="#42d9b8"/>
      </g>
    </svg>
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
        {LAYERS.map(l => {
          const st = getState(l.num);
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

// ── Packet Inspector (Wireshark-style) ────────────────────────────────────────
function PacketInspector({ headers, activeLayer, stepId }) {
  const [open, setOpen] = useState(null);

  useEffect(() => {
    // Auto-open the header matching the active layer
    const target = headers.find(h => HM[h]?.layer === activeLayer) || headers[0] || null;
    setOpen(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  const isRouter  = stepId === "router_rx" || stepId === "router_fwd";
  const isTransit = stepId === "transit_a" || stepId === "transit_b";
  const isDone    = stepId === "done" || stepId === "start";

  const label = isRouter ? "🔄 Router Processing" : isTransit ? "📡 In Transit" : isDone ? (stepId==="done"?"✅ Delivered":"📦 Packet") : "📦 Packet Inspector";

  return (
    <div className="osi-inspector">
      <div className="osi-inspector-label">{label}</div>

      {headers.length === 0 && (
        <div className="osi-inspector-empty">
          {stepId === "done" ? "Payload delivered to application layer" : "No headers yet — waiting for encapsulation"}
        </div>
      )}

      {headers.map((h, i) => {
        const meta = HM[h];
        const lc   = LC[meta.layer];
        const isOpen   = open === h;
        const isActive = meta.layer === activeLayer;
        const fields   = getHF(h, stepId);
        return (
          <div key={`${h}${i}`} className={`osi-ihdr${isActive?" osi-ihdr-active":""}`} style={{"--hc":lc}}>
            <button className="osi-ihdr-btn" onClick={() => setOpen(isOpen ? null : h)}>
              <span className="osi-ihdr-arrow">{isOpen ? "▼" : "▶"}</span>
              <span className="osi-ihdr-badge">L{meta.layer}</span>
              <span className="osi-ihdr-name">{meta.short}</span>
              <span className="osi-ihdr-layer">{LAYERS.find(l=>l.num===meta.layer)?.name}</span>
              {isActive && <span className="osi-ihdr-new">← added now</span>}
            </button>
            {isOpen && (
              <div className="osi-ihdr-fields">
                {fields.map((f,j) => (
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
  const key = activeSide === "A" ? "A"
            : activeSide === "B" ? "B"
            : activeSide === "router" ? "router"
            : activeSide === "transit_a" || activeSide === "switchA" ? "switchA"
            : activeSide === "transit_b" || activeSide === "switchB" ? "switchB"
            : null;

  const dev = key ? DEVICES[key] : null;

  return (
    <div className="osi-devpanel">
      <div className="osi-devpanel-title">
        {dev ? `${dev.name}  —  ${dev.type}` : "Network Devices"}
      </div>
      {dev ? (
        <table className="osi-devtable">
          <tbody>
            {dev.rows.map((r,i) => (
              <tr key={i}>
                <td className="osi-devtable-k">{r.k}</td>
                <td className="osi-devtable-v">{r.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="osi-devpanel-hint">
          Step through the simulation to inspect each device's network configuration.
        </div>
      )}
    </div>
  );
}

// ── ARP Table Panel ───────────────────────────────────────────────────────────
function ArpPanel({ step, activeSide }) {
  const arp = getArpState(step);
  const showPcA = activeSide === "A";
  const showPcB = activeSide === "B";
  const table   = showPcA ? arp.pcA : showPcB ? arp.pcB : arp.router;
  const title   = showPcA ? "PC-A ARP Cache" : showPcB ? "PC-B ARP Cache" : "Router ARP Table";
  const cols    = showPcA || showPcB
    ? [{label:"IP Address"},{label:"MAC Address"},{label:"Host"}]
    : [{label:"IP Address"},{label:"MAC Address"},{label:"Interface"}];

  return (
    <div className="osi-arppanel">
      <div className="osi-arppanel-title">{title}</div>
      {table.length === 0 ? (
        <div className="osi-arppanel-empty">
          {showPcA || showPcB ? "ARP cache empty — no resolved neighbours yet" : "ARP table empty — no traffic seen yet"}
        </div>
      ) : (
        <table className="osi-arptable">
          <thead>
            <tr>{cols.map(c=><th key={c.label}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.map((row, i) => (
              <tr key={i}>
                <td className="osi-arp-ip">{row.ip}</td>
                <td className="osi-arp-mac">{row.mac}</td>
                <td className="osi-arp-iface">{row.iface || row.host}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="osi-arppanel-note">
        {!showPcA && !showPcB && "Router learns MAC addresses by inspecting frames it receives and forwards"}
        {showPcA && "PC-A learns router MAC via ARP before sending the first frame"}
        {showPcB && "PC-B learns router MAC from the frame it receives"}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function OSIExplorer() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  const cur = STEPS[step];

  useEffect(() => {
    if (playing) {
      timer.current = setInterval(() => {
        setStep(s => { if (s >= STEPS.length-1) { setPlaying(false); return s; } return s+1; });
      }, 3000);
    }
    return () => clearInterval(timer.current);
  }, [playing]);

  useEffect(() => {
    const fn = e => {
      if (e.key==="ArrowRight") { setPlaying(false); setStep(s=>Math.min(STEPS.length-1,s+1)); }
      if (e.key==="ArrowLeft")  { setPlaying(false); setStep(s=>Math.max(0,s-1)); }
    };
    window.addEventListener("keydown",fn);
    return () => window.removeEventListener("keydown",fn);
  }, []);

  const prev = () => { setPlaying(false); setStep(s=>Math.max(0,s-1)); };
  const next = () => { setPlaying(false); setStep(s=>Math.min(STEPS.length-1,s+1)); };

  const getStateA = n => {
    if (cur.side==="A" && cur.layer===n) return "active";
    const idx = STEPS.findIndex(s=>s.id===`pca_l${n}`);
    return idx!==-1 && step>idx ? "done" : "pending";
  };
  const getStateB = n => {
    if (cur.side==="B" && cur.layer===n) return "active";
    const idx = STEPS.findIndex(s=>s.id===`pcb_l${n}`);
    return idx!==-1 && step>idx ? "done" : "pending";
  };

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
        <a href="/" className="osi-back">← Portfolio</a>
      </header>

      <main className="osi-main">

        {/* Topology */}
        <div className="osi-topo-wrap">
          <TopologyDiagram pos={cur.pos} activeSide={cur.side} />
        </div>

        {/* Layer stacks + packet inspector */}
        <div className="osi-mid">
          <LayerStack side="A" getState={getStateA} />
          <PacketInspector headers={cur.headers} activeLayer={cur.layer} stepId={cur.id} />
          <LayerStack side="B" getState={getStateB} />
        </div>

        {/* Device config + ARP table */}
        <div className="osi-details">
          <DevicePanel activeSide={cur.side} />
          <ArpPanel step={step} activeSide={cur.side} />
        </div>

        {/* Step info */}
        <div className="osi-info">
          <div className="osi-info-top">
            <span className="osi-step-badge">Step {step+1} / {STEPS.length}</span>
            {cur.side==="A"       && <span className="osi-sbadge osi-sbadge-a">PC-A encapsulating ↓</span>}
            {cur.side==="B"       && <span className="osi-sbadge osi-sbadge-b">PC-B decapsulating ↑</span>}
            {cur.side==="router"  && <span className="osi-sbadge osi-sbadge-r">Router processing</span>}
            {(cur.side==="transit_a"||cur.side==="transit_b") && <span className="osi-sbadge osi-sbadge-t">In transit</span>}
          </div>
          <h2 className="osi-info-title">{cur.title}</h2>
          <p  className="osi-info-desc">{cur.desc}</p>
          {cur.proto && <pre className="osi-proto-block">{cur.proto}</pre>}
        </div>

        {/* Progress bar */}
        <div className="osi-pbar-wrap"><div className="osi-pbar" style={{width:pct+"%"}}/></div>

        {/* Controls */}
        <div className="osi-controls">
          <button className="osi-btn" onClick={prev} disabled={step===0}>← Prev</button>
          <span className="osi-step-count">{step+1} / {STEPS.length}</span>
          <button className="osi-btn osi-btn-play" onClick={()=>setPlaying(p=>!p)}>
            {playing?"⏸ Pause":"▶ Auto-play"}
          </button>
          <button className="osi-btn" onClick={next} disabled={step===STEPS.length-1}>Next →</button>
        </div>
        <p className="osi-kbd-hint">← → arrow keys to step through</p>

        {/* Reference */}
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
