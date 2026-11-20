import { useState, useEffect, useRef } from "react";
import "./osi.css";

const LC = { 7:"#a78bfa", 6:"#63b3ed", 5:"#42d9b8", 4:"#f2c36b", 3:"#fb923c", 2:"#e63946", 1:"#94a3b8" };

const LAYERS = [
  { num:7, name:"Application",  pdu:"Data",    protocols:"HTTP · DNS · FTP · SMTP · SSH" },
  { num:6, name:"Presentation", pdu:"Data",    protocols:"TLS · SSL · ASCII · JSON · JPEG" },
  { num:5, name:"Session",      pdu:"Data",    protocols:"NetBIOS · RPC · SIP · NFS" },
  { num:4, name:"Transport",    pdu:"Segment", protocols:"TCP · UDP" },
  { num:3, name:"Network",      pdu:"Packet",  protocols:"IP · ICMP · OSPF · BGP" },
  { num:2, name:"Data Link",    pdu:"Frame",   protocols:"Ethernet · Wi-Fi · ARP · PPP" },
  { num:1, name:"Physical",     pdu:"Bits",    protocols:"Cat5e · Fiber · Wi-Fi · USB" },
];

const HM = {
  APP:  { layer:7, short:"HTTP Data",   detail:"GET / HTTP/1.1\nHost: 192.168.2.20" },
  PRES: { layer:6, short:"TLS Wrap",    detail:"TLS record (encrypted payload)" },
  SESS: { layer:5, short:"Session",     detail:"Session-ID: 0xA4F2B1  OPEN" },
  TCP:  { layer:4, short:"TCP Hdr",     detail:"src:54231  dst:80\nseq:1  ack:0  flags:SYN" },
  IP:   { layer:3, short:"IP Hdr",      detail:"src: 192.168.1.10\ndst: 192.168.2.20\nTTL: 64" },
  ETH:  { layer:2, short:"ETH Hdr",     detail:"src: AA:BB:CC:11:22:33\ndst: Router LAN-A port" },
  FCS:  { layer:2, short:"FCS",         detail:"Frame Check Sequence (error detection)" },
  ETH2: { layer:2, short:"ETH* Hdr",   detail:"src: Router LAN-B port\ndst: CC:DD:EE:44:55:66\n* Re-written by router" },
  FCS2: { layer:2, short:"FCS",         detail:"New Frame Check Sequence" },
};

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
    proto:"Session-ID: 0xA4F2B1  →  OPEN",
    side:"A", layer:5, headers:["SESS","PRES","APP"], pos:0 },

  { id:"pca_l4",   title:"Layer 4 · Transport — PC-A",
    desc:"TCP adds a header with a randomly chosen source port (54231) and destination port (80 for HTTP). It sequences the data into segments and guarantees delivery — lost segments are automatically retransmitted.",
    proto:"TCP  src:54231  dst:80  seq:1  ack:0  SYN",
    side:"A", layer:4, headers:["TCP","SESS","PRES","APP"], pos:0 },

  { id:"pca_l3",   title:"Layer 3 · Network — PC-A",
    desc:"The IP layer adds the source IP (192.168.1.10) and destination IP (192.168.2.20). TTL is set to 64 — it decrements at each router hop to prevent packets looping forever. Routers read this layer to decide where to forward.",
    proto:"IP  src:192.168.1.10  dst:192.168.2.20  TTL:64",
    side:"A", layer:3, headers:["IP","TCP","SESS","PRES","APP"], pos:0 },

  { id:"pca_l2",   title:"Layer 2 · Data Link — PC-A",
    desc:"PC-B is on a different network, so the frame must be sent to the router first. PC-A uses ARP to learn the router's MAC address. An Ethernet frame is built with PC-A's MAC as source and the router's MAC as destination. A Frame Check Sequence (FCS) trailer is appended for error detection.",
    proto:"ETH  AA:BB:CC:11:22:33 → Router MAC  +FCS",
    side:"A", layer:2, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0 },

  { id:"pca_l1",   title:"Layer 1 · Physical — PC-A",
    desc:"The frame is converted to electrical signals (voltage pulses) on copper cable, light pulses on fibre, or radio waves on Wi-Fi. The physical layer knows nothing about addresses — it simply puts bits on the wire at the agreed speed.",
    proto:"10101100 00010000 ... (bits on Cat5e cable)",
    side:"A", layer:1, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0 },

  { id:"transit_a", title:"Crossing LAN-A — Switch forwards the frame",
    desc:"The electrical signals travel to the LAN-A switch. The switch reads only the destination MAC in the Ethernet header, looks it up in its MAC address table, and forwards the frame out the correct port toward the router. Switches operate at Layer 2 — they never look at IP addresses.",
    side:"transit_a", layer:null, headers:["ETH","IP","TCP","SESS","PRES","APP","FCS"], pos:0.3 },

  { id:"router_rx", title:"Router — strips Layer 2, reads Layer 3",
    desc:"The router's LAN-A port receives the frame. It checks that the destination MAC matches its own, verifies the FCS, then strips the entire Ethernet header and trailer. The router now holds a bare IP packet and reads the destination IP to decide where to forward it.",
    proto:"Router strips ETH header + FCS  →  reads IP dst: 192.168.2.20",
    side:"router", layer:null, headers:["IP","TCP","SESS","PRES","APP"], pos:0.5 },

  { id:"router_fwd", title:"Router — routing decision + re-encapsulation",
    desc:"The routing table shows 192.168.2.0/24 is reachable on the LAN-B interface. TTL is decremented (64→63). The router uses ARP to find PC-B's MAC address on LAN-B, then builds a brand-new Ethernet frame — same IP packet inside, but completely new L2 header with new MAC addresses.",
    proto:"New ETH  Router-LAN-B-MAC → CC:DD:EE:44:55:66  IP TTL:63",
    side:"router", layer:null, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:0.5 },

  { id:"transit_b", title:"Crossing LAN-B — Switch delivers to PC-B",
    desc:"The router transmits the re-encapsulated frame onto LAN-B. The LAN-B switch reads the destination MAC (PC-B's NIC MAC) from the Ethernet header and forwards the frame directly out the port where PC-B is connected.",
    side:"transit_b", layer:null, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:0.7 },

  { id:"pcb_l1",   title:"Layer 1 · Physical — PC-B",
    desc:"PC-B's NIC detects the electrical signals and reconstructs the bit stream. It identifies the frame boundaries from the preamble and start-of-frame delimiter, then passes the bits up to Layer 2.",
    side:"B", layer:1, headers:["ETH2","IP","TCP","SESS","PRES","APP","FCS2"], pos:1 },

  { id:"pcb_l2",   title:"Layer 2 · Data Link — PC-B",
    desc:"PC-B checks the destination MAC — it matches its own NIC. The FCS is verified to confirm no bit errors occurred in transit. The Ethernet header and FCS trailer are stripped, and the IP packet is handed up to Layer 3.",
    side:"B", layer:2, headers:["IP","TCP","SESS","PRES","APP"], pos:1 },

  { id:"pcb_l3",   title:"Layer 3 · Network — PC-B",
    desc:"The IP layer reads the destination IP (192.168.2.20) — it matches PC-B's own address, so the packet is accepted. The TTL (63) confirms it passed through exactly one router. The IP header is stripped and the TCP segment is passed up.",
    side:"B", layer:3, headers:["TCP","SESS","PRES","APP"], pos:1 },

  { id:"pcb_l4",   title:"Layer 4 · Transport — PC-B",
    desc:"TCP reads the destination port (80) and delivers the segment to the web server process listening on that port. A TCP ACK is sent back to PC-A. The TCP header is stripped and the session data is passed up.",
    side:"B", layer:4, headers:["SESS","PRES","APP"], pos:1 },

  { id:"pcb_l5",   title:"Layer 5 · Session — PC-B",
    desc:"The session ID is matched to the conversation that was opened at the start. The session layer ensures this data belongs to the correct ongoing exchange and manages synchronisation.",
    side:"B", layer:5, headers:["PRES","APP"], pos:1 },

  { id:"pcb_l6",   title:"Layer 6 · Presentation — PC-B",
    desc:"If TLS was applied by PC-A's Layer 6, it is decrypted here using the shared session keys. The data is decoded from its transmission encoding back into the format the application expects.",
    side:"B", layer:6, headers:["APP"], pos:1 },

  { id:"pcb_l7",   title:"Layer 7 · Application — PC-B",
    desc:"The web server application receives the HTTP GET request. It reads the path, retrieves the page, and sends back an HTTP 200 OK response — which travels back through all 7 layers in the reverse direction!",
    proto:"HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html>...",
    side:"B", layer:7, headers:[], pos:1 },

  { id:"done",     title:"Delivery complete!",
    desc:"Key takeaway: IP addresses (Layer 3) stay the same end-to-end — they identify the final source and destination. MAC addresses (Layer 2) change at every hop — they only matter on the current network segment. The router is the boundary between segments: it reads L3 to route, re-writes L2 to deliver.",
    side:null, layer:null, headers:[], pos:1 },
];

// ── Topology Diagram ──────────────────────────────────────────────────────────
function TopologyDiagram({ pos, activeSide }) {
  const nodes = [
    { x:75,  label:"PC-A",   sub:"192.168.1.10", side:"A",       shape:"pc" },
    { x:240, label:"Switch", sub:"LAN-A",         side:"switchA", shape:"sw" },
    { x:400, label:"Router", sub:"L3 device",     side:"router",  shape:"rt" },
    { x:560, label:"Switch", sub:"LAN-B",         side:"switchB", shape:"sw" },
    { x:725, label:"PC-B",   sub:"192.168.2.20",  side:"B",       shape:"pc" },
  ];

  const isActive = (side) =>
    activeSide === side ||
    (activeSide === "transit_a" && side === "switchA") ||
    (activeSide === "transit_b" && side === "switchB");

  const dotX = 75 + pos * (725 - 75);

  return (
    <svg viewBox="0 0 800 108" className="osi-topo-svg">
      {/* LAN labels */}
      <rect x="82" y="2" width="136" height="15" rx="4" fill="rgba(99,179,237,0.12)" />
      <text x="150" y="13" textAnchor="middle" fontSize="9" fill="#63b3ed" fontFamily="'JetBrains Mono',monospace">LAN-A · 192.168.1.0/24</text>
      <rect x="582" y="2" width="136" height="15" rx="4" fill="rgba(66,217,184,0.12)" />
      <text x="650" y="13" textAnchor="middle" fontSize="9" fill="#42d9b8" fontFamily="'JetBrains Mono',monospace">LAN-B · 192.168.2.0/24</text>

      {/* Connecting line */}
      <line x1="75" y1="50" x2="725" y2="50" stroke="rgba(255,255,255,0.1)" strokeWidth="2" strokeDasharray="6 4" />

      {/* Nodes */}
      {nodes.map(n => {
        const active = isActive(n.side);
        const c = active ? "#42d9b8" : "rgba(255,255,255,0.25)";
        const bg = active ? "rgba(66,217,184,0.14)" : "rgba(17,24,39,0.9)";
        return (
          <g key={n.side}>
            <circle cx={n.x} cy={50} r={22} fill={bg} stroke={c} strokeWidth={active ? 2 : 1} />
            {/* PC shape */}
            {n.shape === "pc" && <>
              <rect x={n.x-9} y={38} width={18} height={13} rx={2} fill="none" stroke={c} strokeWidth={1.5}/>
              <line x1={n.x-6} y1={51} x2={n.x+6} y2={51} stroke={c} strokeWidth={1.5}/>
              <line x1={n.x-4} y1={54} x2={n.x+4} y2={54} stroke={c} strokeWidth={1}/>
            </>}
            {/* Router diamond */}
            {n.shape === "rt" && <polygon points={`${n.x},29 ${n.x+13},50 ${n.x},71 ${n.x-13},50`} fill="none" stroke={c} strokeWidth={1.5}/>}
            {/* Switch box */}
            {n.shape === "sw" && <>
              <rect x={n.x-11} y={39} width={22} height={15} rx={2} fill="none" stroke={c} strokeWidth={1.5}/>
              {[-5,0,5].map(dx => <line key={dx} x1={n.x+dx} y1={39} x2={n.x+dx} y2={34} stroke={c} strokeWidth={1}/>)}
            </>}
            <text x={n.x} y={72} textAnchor="middle" fontSize="9" fontWeight={active?"700":"400"} fill={active?"#42d9b8":"rgba(241,245,249,0.6)"} fontFamily="Inter,sans-serif">{n.label}</text>
            <text x={n.x} y={83} textAnchor="middle" fontSize="8" fill="rgba(241,245,249,0.35)" fontFamily="'JetBrains Mono',monospace">{n.sub}</text>
          </g>
        );
      })}

      {/* Packet dot */}
      <g style={{ transform:`translateX(${dotX - 75}px)`, transition:"transform 0.5s ease-in-out" }}>
        <circle cx={75} cy={50} r={10} fill="rgba(66,217,184,0.25)" />
        <circle cx={75} cy={50} r={5.5} fill="#42d9b8" />
      </g>
    </svg>
  );
}

// ── Layer Stack ───────────────────────────────────────────────────────────────
function LayerStack({ side, getState }) {
  return (
    <div className="osi-stack">
      <div className="osi-stack-head">
        <span className="osi-stack-pc">{side === "A" ? "PC-A" : "PC-B"}</span>
        <span className="osi-stack-ip">{side === "A" ? "192.168.1.10" : "192.168.2.20"}</span>
      </div>
      <div className="osi-stack-layers">
        {LAYERS.map(l => {
          const state = getState(l.num);
          return (
            <div key={l.num} className={`osi-layer osi-layer-${state}`} style={{"--lc": LC[l.num]}}>
              <span className="osi-ln">{l.num}</span>
              <div className="osi-layer-body">
                <span className="osi-layer-name">{l.name}</span>
                <span className="osi-layer-pdu">{l.pdu}</span>
              </div>
              {state === "done" && <span className="osi-check">✓</span>}
              {state === "active" && <span className="osi-active-pulse" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Packet View ───────────────────────────────────────────────────────────────
function PacketView({ headers, stepId }) {
  const isRouter = stepId === "router_rx" || stepId === "router_fwd";
  const isTransit = stepId === "transit_a" || stepId === "transit_b";
  const isDone = stepId === "done";

  return (
    <div className="osi-packet-col">
      <div className="osi-packet-label">
        {isRouter ? "🔄 Router Processing" : isTransit ? "📡 In Transit" : isDone ? "✅ Delivered" : "📦 Packet Contents"}
      </div>
      <div className="osi-packet-stack">
        {headers.length === 0 && (
          <div className="osi-packet-empty">
            {isDone ? "Payload delivered to application" : "No headers yet"}
          </div>
        )}
        {headers.map((h, i) => {
          const m = HM[h];
          return (
            <div key={i} className="osi-hdr" style={{"--hc": LC[m.layer]}} title={m.detail}>
              <span className="osi-hdr-name">{m.short}</span>
              <span className="osi-hdr-l">L{m.layer}</span>
            </div>
          );
        })}
      </div>
      {headers.length > 0 && (
        <div className="osi-packet-hint">↑ outer wrapper · inner payload ↓</div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function OSIExplorer() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);
  const cur = STEPS[step];

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        setStep(s => {
          if (s >= STEPS.length - 1) { setPlaying(false); return s; }
          return s + 1;
        });
      }, 2800);
    }
    return () => clearInterval(timerRef.current);
  }, [playing]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") { setPlaying(false); setStep(s => Math.min(STEPS.length-1, s+1)); }
      if (e.key === "ArrowLeft")  { setPlaying(false); setStep(s => Math.max(0, s-1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const prev = () => { setPlaying(false); setStep(s => Math.max(0, s-1)); };
  const next = () => { setPlaying(false); setStep(s => Math.min(STEPS.length-1, s+1)); };

  const getStateA = (n) => {
    if (cur.side === "A" && cur.layer === n) return "active";
    const idx = STEPS.findIndex(s => s.id === `pca_l${n}`);
    if (idx !== -1 && step > idx) return "done";
    return "pending";
  };

  const getStateB = (n) => {
    if (cur.side === "B" && cur.layer === n) return "active";
    const idx = STEPS.findIndex(s => s.id === `pcb_l${n}`);
    if (idx !== -1 && step > idx) return "done";
    return "pending";
  };

  const pct = Math.round((step / (STEPS.length - 1)) * 100);

  return (
    <div className="osi-shell">
      <header className="osi-header">
        <div className="osi-brand">
          <div className="osi-logo-mark">OSI</div>
          <div>
            <h1>Layer Explorer</h1>
            <p>Trace a connection from PC to PC through every layer</p>
          </div>
        </div>
        <a href="/" className="osi-back">← Portfolio</a>
      </header>

      <main className="osi-main">

        {/* Topology */}
        <div className="osi-topo-wrap">
          <TopologyDiagram pos={cur.pos} activeSide={cur.side} />
        </div>

        {/* Layer stacks + packet */}
        <div className="osi-mid">
          <LayerStack side="A" getState={getStateA} />
          <PacketView headers={cur.headers} stepId={cur.id} />
          <LayerStack side="B" getState={getStateB} />
        </div>

        {/* Info panel */}
        <div className="osi-info">
          <div className="osi-info-top">
            <span className="osi-step-badge">Step {step + 1} / {STEPS.length}</span>
            {cur.side === "A" && <span className="osi-side-badge osi-side-a">PC-A encapsulating ↓</span>}
            {cur.side === "B" && <span className="osi-side-badge osi-side-b">PC-B decapsulating ↑</span>}
            {cur.side === "router" && <span className="osi-side-badge osi-side-r">Router processing</span>}
            {(cur.side === "transit_a" || cur.side === "transit_b") && <span className="osi-side-badge osi-side-t">In transit</span>}
          </div>
          <h2 className="osi-info-title">{cur.title}</h2>
          <p className="osi-info-desc">{cur.desc}</p>
          {cur.proto && (
            <pre className="osi-proto-block">{cur.proto}</pre>
          )}
        </div>

        {/* Progress */}
        <div className="osi-progress-bar-wrap">
          <div className="osi-progress-bar" style={{ width: pct + "%" }} />
        </div>

        {/* Controls */}
        <div className="osi-controls">
          <button className="osi-btn" onClick={prev} disabled={step === 0}>← Prev</button>
          <div className="osi-step-count">{step + 1} / {STEPS.length}</div>
          <button className="osi-btn osi-btn-play" onClick={() => setPlaying(p => !p)}>
            {playing ? "⏸ Pause" : "▶ Auto-play"}
          </button>
          <button className="osi-btn" onClick={next} disabled={step === STEPS.length - 1}>Next →</button>
        </div>

        <p className="osi-kbd-hint">Tip: use ← → arrow keys to step through</p>

        {/* Layer reference */}
        <section className="osi-ref">
          <h3>OSI Layer Quick Reference</h3>
          <div className="osi-ref-grid">
            {LAYERS.map(l => (
              <div key={l.num} className="osi-ref-row" style={{"--lc": LC[l.num]}}>
                <span className="osi-ref-num">{l.num}</span>
                <span className="osi-ref-name">{l.name}</span>
                <span className="osi-ref-pdu">{l.pdu}</span>
                <span className="osi-ref-proto">{l.protocols}</span>
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
