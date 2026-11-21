import { useState, useMemo, useEffect, useRef } from "react";
import { PROTOCOLS, DEFAULTS, SCENARIOS, simulate, stateAt, nextFault } from "./transportEngine.js";
import "./transport.css";

const W = 900, SX = 330, RX = 620, TOP = 56, SCALE = 64;
const yOf = t => TOP + t * SCALE;

const EXPLAIN = {
  rdt20: [
    "Sender sends one packet and waits for an ACK or NAK.",
    "Receiver checks the checksum: OK → deliver and ACK; corrupted → NAK.",
    "Flaw: if the ACK/NAK itself is corrupted, the sender can't tell which it was. Resending may deliver a duplicate.",
    "No timer, so a lost packet means waiting forever.",
  ],
  rdt21: [
    "Adds a sequence number (0/1) to each packet.",
    "If the ACK/NAK is garbled, the sender just resends; the receiver sees the repeated sequence number, re-ACKs and doesn't deliver it twice.",
    "Still no timer: a lost packet or ACK deadlocks.",
  ],
  rdt30: [
    "Stop-and-wait with sequence numbers 0/1 and a countdown timer.",
    "ACKs carry the sequence number of the packet being acknowledged (no NAKs).",
    "Timeout → resend. Duplicates caused by a lost ACK or premature timeout are re-ACKed, not delivered twice.",
    "Correct but slow: the sender sits idle for a whole RTT per packet.",
  ],
  gbn: [
    "Sender may have up to N unACKed packets in flight (the window), with one timer for the oldest.",
    "ACKs are cumulative: ACK n means “everything up to n arrived”.",
    "Receiver only accepts packets in order; anything else is discarded and the last ACK is repeated.",
    "Timeout → go back and resend every packet from the oldest unACKed one.",
  ],
  sr: [
    "Sender may have up to N unACKed packets in flight, each with its own timer.",
    "Receiver ACKs each packet individually and buffers out-of-order ones.",
    "When the missing packet arrives, the buffered ones are delivered together.",
    "Timeout → resend only that one packet.",
  ],
};

function arrowColor(tx) {
  if (tx.fate !== "ok") return "#e63946";
  if (tx.kind === "nak") return "#fb923c";
  if (tx.kind === "ack") return "#42d9b8";
  return tx.attempt > 1 ? "#f2c36b" : "#63b3ed";
}

export default function TransportLab() {
  const [protocol, setProtocol] = useState("gbn");
  const [packets, setPackets]   = useState(8);
  const [window_, setWindow]    = useState(4);
  const [timeout, setTimeoutV]  = useState(DEFAULTS.timeout);
  const [faults, setFaults]     = useState({ "d2#1":"lost" });
  const [scenario, setScenario] = useState("gbn-loss");
  const [cursor, setCursor]     = useState(null);
  const [playing, setPlaying]   = useState(false);
  const scrollRef = useRef(null);
  const cursorRef = useRef(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const sim = useMemo(() => simulate({ protocol, packets, window:window_, timeout, faults }), [protocol, packets, window_, timeout, faults]);
  const t = cursor ?? sim.end;
  const st = stateAt(sim, t);
  const pipelined = PROTOCOLS[protocol].pipelined;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = (cursorRef.current ?? 0) + 0.05;
      if (next >= sim.end) { setPlaying(false); setCursor(null); }
      else setCursor(next);
    }, 40);
    return () => clearInterval(id);
  }, [playing, sim.end]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || cursor === null) return;
    const svg = el.querySelector("svg");
    const px = yOf(cursor) * (svg.clientWidth / W);
    if (px < el.scrollTop + 60 || px > el.scrollTop + el.clientHeight - 80) el.scrollTop = px - el.clientHeight / 3;
  }, [cursor]);

  const change = fn => { fn(); setScenario(""); setCursor(null); setPlaying(false); };
  function loadScenario(id) {
    const s = SCENARIOS.find(x => x.id === id);
    if (!s) return;
    setScenario(id);
    setProtocol(s.protocol);
    setPackets(s.packets ?? DEFAULTS.packets);
    setWindow(s.window ?? DEFAULTS.window);
    setTimeoutV(s.timeout ?? DEFAULTS.timeout);
    setFaults(s.faults);
    setCursor(null); setPlaying(false);
  }
  const toggle = key => change(() => setFaults(f => {
    const n = { ...f };
    const v = nextFault(f[key]);
    if (v) n[key] = v; else delete n[key];
    return n;
  }));

  const height = yOf(sim.end + 0.8);
  const stack = (notes, side) => {
    const used = [];
    return notes.map((n, i) => {
      let y = yOf(n.t) + 4;
      while (used.some(u => Math.abs(u - y) < 12)) y += 12;
      used.push(y);
      return (
        <text key={`${side}${i}`} x={side === "S" ? SX - 12 : RX + 12} y={y} textAnchor={side === "S" ? "end" : "start"}
          className={`tl-note tl-${n.kind}`} opacity={n.t <= t + 1e-9 ? 1 : 0.15}>{n.text}</text>
      );
    });
  };

  return (
    <div className="tl">
      <div className="tl-controls">
        <label>Protocol
          <select value={protocol} onChange={e => change(() => setProtocol(e.target.value))}>
            {Object.entries(PROTOCOLS).map(([id, p]) => <option key={id} value={id}>{p.full}</option>)}
          </select>
        </label>
        <label>Lecture scenario
          <select value={scenario} onChange={e => loadScenario(e.target.value)}>
            <option value="">Custom</option>
            {SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Packets <b>{packets}</b>
          <input type="range" min="3" max="12" value={packets} onChange={e => change(() => setPackets(Number(e.target.value)))}/>
        </label>
        {pipelined && (
          <label>Window N <b>{window_}</b>
            <input type="range" min="1" max="8" value={window_} onChange={e => change(() => setWindow(Number(e.target.value)))}/>
          </label>
        )}
        {PROTOCOLS[protocol].timer && (
          <label>Timeout <b>{timeout.toFixed(1)}</b>
            <input type="range" min="1.5" max="8" step="0.1" value={timeout} onChange={e => change(() => setTimeoutV(Number(e.target.value)))}/>
          </label>
        )}
        <button className="tl-btn" onClick={() => change(() => setFaults({}))} disabled={!Object.keys(faults).length}>Clear faults</button>
      </div>
      <p className="tl-hint">
        Click any packet or ACK arrow to make it <b className="tl-lostword">lost</b>, click again for <b className="tl-corruptword">corrupted</b>, a third time to restore it.
        Time runs downwards; one-way delay is 1 time unit and each packet takes 0.25 to transmit (L/R). RTT = 2.
      </p>

      <div className="tl-body">
        <div className="tl-timeline" ref={scrollRef}>
          <svg viewBox={`0 0 ${W} ${height}`} className="tl-svg">
            <text x={SX} y={22} textAnchor="middle" className="tl-head">Sender</text>
            <text x={RX} y={22} textAnchor="middle" className="tl-head">Receiver</text>
            <line x1={SX} y1={TOP - 14} x2={SX} y2={height - 10} className="tl-axis"/>
            <line x1={RX} y1={TOP - 14} x2={RX} y2={height - 10} className="tl-axis"/>
            {Array.from({ length: Math.ceil(sim.end) + 1 }, (_, i) => (
              <g key={i}>
                <line x1={18} x2={W - 18} y1={yOf(i)} y2={yOf(i)} className="tl-grid"/>
                <text x={20} y={yOf(i) - 3} className="tl-tick">t={i}</text>
              </g>
            ))}

            {sim.txs.map(tx => {
              const fromX = tx.from === "S" ? SX : RX, toX = tx.from === "S" ? RX : SX;
              const full = tx.fate === "lost" ? 0.55 : 1;
              const endX = fromX + (toX - fromX) * full;
              const y0 = yOf(tx.t0), y1 = yOf(tx.t1);
              const shown = t >= tx.t0;
              const frac = shown ? Math.min(1, (t - tx.t0) / (tx.t1 - tx.t0)) : 0;
              const cx = fromX + (endX - fromX) * frac, cy = y0 + (y1 - y0) * frac;
              const color = arrowColor(tx);
              const lx = fromX + (toX - fromX) * 0.22, ly = y0 + (yOf(tx.t0 + (tx.t1 - tx.t0) / full) - y0) * 0.22;
              return (
                <g key={tx.id} className="tl-tx" onClick={() => toggle(tx.key)} opacity={shown ? 1 : 0.12}>
                  <title>{`${tx.label}${tx.attempt > 1 ? ` (retransmission #${tx.attempt - 1})` : ""} — click to ${tx.fate === "ok" ? "lose" : tx.fate === "lost" ? "corrupt" : "restore"} it`}</title>
                  <line x1={fromX} y1={y0} x2={endX} y2={y1} stroke="transparent" strokeWidth={12}/>
                  <line x1={fromX} y1={y0} x2={endX} y2={y1} stroke={color} strokeWidth={1.2} opacity={0.35}
                    strokeDasharray={tx.fate === "corrupt" ? "5 3" : undefined}/>
                  {frac > 0 && <line x1={fromX} y1={y0} x2={cx} y2={cy} stroke={color} strokeWidth={2}
                    strokeDasharray={tx.fate === "corrupt" ? "5 3" : undefined}/>}
                  {frac >= 1 && tx.fate !== "lost" && (
                    <polygon points={arrowHead(fromX, y0, endX, y1)} fill={color}/>
                  )}
                  {frac > 0 && frac < 1 && <circle cx={cx} cy={cy} r={4} fill={color}/>}
                  {frac >= 1 && tx.fate === "lost" && <text x={endX} y={y1 + 4} textAnchor="middle" className="tl-x">✕</text>}
                  {frac >= 1 && tx.fate === "corrupt" && <text x={endX + (toX > fromX ? -10 : 10)} y={y1 - 6} textAnchor="middle" className="tl-bolt">⚡</text>}
                  <rect x={lx - 30} y={ly - 9} width={60} height={13} rx={4} className="tl-labelbg"/>
                  <text x={lx} y={ly + 1} textAnchor="middle" className="tl-label" style={{ fill:color }}>{shortLabel(tx.label)}</text>
                </g>
              );
            })}

            {stack(sim.sNotes, "S")}
            {stack(sim.rNotes, "R")}
            <line x1={18} x2={W - 18} y1={yOf(t)} y2={yOf(t)} className="tl-cursor"/>
          </svg>
        </div>

        <aside className="tl-side">
          <div className="tl-card">
            <div className="tl-play">
              <button onClick={() => { if (cursor === null || cursor >= sim.end) setCursor(0); setPlaying(p => !p); }}>
                {playing ? "⏸ Pause" : "▶ Play"}
              </button>
              <input type="range" min="0" max={sim.end} step="0.01" value={t}
                onChange={e => { setPlaying(false); setCursor(Number(e.target.value)); }} aria-label="Time"/>
              <span>t = {t.toFixed(2)}</span>
            </div>
          </div>

          <div className="tl-card">
            <div className="tl-title">Sender window</div>
            <div className="tl-boxes">
              {Array.from({ length: sim.M }, (_, k) => {
                const acked = st.sAcked.includes(k) || k < st.sBase;
                const cls = acked ? "acked" : k < st.sNext ? "sent" : k < st.sBase + sim.N ? "usable" : "idle";
                return <span key={k} className={`tl-box ${cls}${k === st.sBase ? " base" : ""}`}>{k}</span>;
              })}
            </div>
            <p className="tl-small">base = {st.sBase} · nextseqnum = {st.sNext}{pipelined ? ` · N = ${sim.N}` : " · stop-and-wait (N = 1)"}</p>
            <div className="tl-legend">
              <span className="tl-box acked"/>ACKed <span className="tl-box sent"/>sent, not ACKed <span className="tl-box usable"/>usable <span className="tl-box idle"/>not usable
            </div>
            <div className="tl-title" style={{ marginTop:12 }}>Receiver</div>
            <div className="tl-boxes">
              {Array.from({ length: sim.M }, (_, k) => {
                const cls = k < st.rBase ? "acked" : st.rBuf.includes(k) ? "buffered" : protocol === "sr" && k < st.rBase + sim.N ? "usable" : k === st.rBase ? "usable" : "idle";
                return <span key={k} className={`tl-box ${cls}`}>{k}</span>;
              })}
            </div>
            <p className="tl-small">
              {protocol === "sr" ? `rcv_base = ${st.rBase} · buffered: ${st.rBuf.length ? st.rBuf.join(", ") : "none"}` : `expecting message ${st.rBase}`}
            </p>
          </div>

          <div className="tl-card">
            <div className="tl-title">Result</div>
            <p className={`tl-verdict ${sim.done && !sim.stats.dups ? "ok" : "bad"}`}>
              {sim.stuck && !PROTOCOLS[protocol].timer ? "✗ Deadlock — waiting forever"
                : sim.stats.dups ? `✗ ${sim.stats.dups} duplicate${sim.stats.dups > 1 ? "s" : ""} delivered to the app`
                : sim.done ? `✓ All ${sim.M} messages delivered, in order` : "✗ Didn't finish"}
            </p>
            <dl className="tl-stats">
              <dt>Data packets sent</dt><dd>{sim.stats.sent}</dd>
              <dt>Retransmissions</dt><dd>{sim.stats.retrans}</dd>
              <dt>Finished at</dt><dd>{sim.stats.finish !== null ? `t = ${sim.stats.finish.toFixed(2)}` : "—"}</dd>
              <dt>Sender utilisation</dt>
              <dd title="U = N·(L/R) / (RTT + L/R)">{sim.N}×0.25 / (2 + 0.25) = {sim.stats.utilization.toFixed(2)}</dd>
            </dl>
          </div>

          <div className="tl-card">
            <div className="tl-title">{PROTOCOLS[protocol].name} in a nutshell</div>
            <ul className="tl-explain">{EXPLAIN[protocol].map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function shortLabel(s) { return s.replace(/ \(msg \d+\)/, ""); }

function arrowHead(x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 7;
  const p = (ang) => `${x2 - s * Math.cos(ang)},${y2 - s * Math.sin(ang)}`;
  return `${x2},${y2} ${p(a - 0.45)} ${p(a + 0.45)}`;
}
