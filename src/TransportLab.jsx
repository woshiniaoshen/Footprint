import { useState, useMemo, useEffect, useRef } from "react";
import {
  PROTOCOLS, DEFAULTS, SCENARIOS, simulate, stateAt, nextFault,
  rttEstimate, congestion, checksum, bin16, flowControl,
} from "./transportEngine.js";
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
  tcp: [
    "Sequence numbers count bytes: each segment's Seq is the number of its first byte.",
    "ACK = the next byte expected — cumulative, so one ACK can confirm several segments.",
    "One timer, for the oldest unACKed segment. On timeout TCP resends only that segment (not the whole window like GBN).",
    "The receiver buffers out-of-order segments and repeats its ACK. Three duplicate ACKs → fast retransmit, without waiting for the timeout.",
  ],
};

function arrowColor(tx) {
  if (tx.fate !== "ok") return "#e63946";
  if (tx.kind === "nak") return "#fb923c";
  if (tx.kind === "ack") return "#42d9b8";
  return tx.attempt > 1 ? "#f2c36b" : "#63b3ed";
}

const SECTIONS = [
  ["timeline", "Reliable transfer"],
  ["rtt", "RTT & timeout"],
  ["flow", "Flow control"],
  ["cwnd", "Congestion control"],
  ["checksum", "Checksum"],
];

export default function TransportLab() {
  const [section, setSection] = useState("timeline");
  return (
    <div className="tl">
      <div className="tl-sections" role="tablist" aria-label="Transport lab sections">
        {SECTIONS.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={section === id} className={section === id ? "on" : ""} onClick={() => setSection(id)}>{name}</button>
        ))}
      </div>
      {section === "timeline" && <TimelineSim/>}
      {section === "rtt" && <RttCalc/>}
      {section === "flow" && <FlowCalc/>}
      {section === "cwnd" && <CwndChart/>}
      {section === "checksum" && <ChecksumCalc/>}
    </div>
  );
}

function TimelineSim() {
  const [protocol, setProtocol] = useState("gbn");
  const [packets, setPackets]   = useState(8);
  const [window_, setWindow]    = useState(4);
  const [timeout, setTimeoutV]  = useState(DEFAULTS.timeout);
  const [faults, setFaults]     = useState({ "d2#1":"lost" });
  const [scenario, setScenario] = useState("gbn-loss");
  const [sizes, setSizes]       = useState(null);
  const [mss, setMss]           = useState(DEFAULTS.mss);
  const [isn, setIsn]           = useState(DEFAULTS.isn);
  const [fastRtx, setFastRtx]   = useState(true);
  const [cursor, setCursor]     = useState(null);
  const [playing, setPlaying]   = useState(false);
  const scrollRef = useRef(null);
  const cursorRef = useRef(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const sim = useMemo(() => simulate({ protocol, packets, window:window_, timeout, faults, sizes, mss, isn, fastRetransmit:fastRtx }),
    [protocol, packets, window_, timeout, faults, sizes, mss, isn, fastRtx]);
  const isTcp = protocol === "tcp";
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
    setSizes(s.sizes ?? null);
    setIsn(s.isn ?? DEFAULTS.isn);
    setFastRtx(true);
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
    <>
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
        <label>{isTcp ? "Segments" : "Packets"} <b>{isTcp && sizes ? sizes.length : packets}</b>
          <input type="range" min="1" max="12" value={isTcp && sizes ? sizes.length : packets}
            onChange={e => change(() => { setPackets(Number(e.target.value)); setSizes(null); })}/>
        </label>
        {isTcp && (sizes
          ? <label>Segment sizes <b>{sizes.join(", ")} B</b>
              <button className="tl-btn" onClick={() => change(() => setSizes(null))}>Use equal sizes</button>
            </label>
          : <label>Segment size <b>{mss} B</b>
              <input type="range" min="10" max="1000" step="10" value={mss} onChange={e => change(() => setMss(Number(e.target.value)))}/>
            </label>)}
        {isTcp && (
          <label>Initial Seq
            <input type="number" className="tl-num" value={isn} min="0" max="99999" onChange={e => change(() => setIsn(Math.max(0, Number(e.target.value) || 0)))}/>
          </label>
        )}
        {isTcp && (
          <label className="tl-checkrow">
            <span><input type="checkbox" checked={fastRtx} onChange={e => change(() => setFastRtx(e.target.checked))}/> Fast retransmit</span>
          </label>
        )}
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
                  <rect x={lx - shortLabel(tx.label).length * 3.2 - 5} y={ly - 9} width={shortLabel(tx.label).length * 6.4 + 10} height={13} rx={4} className="tl-labelbg"/>
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
                return <span key={k} className={`tl-box ${cls}${k === st.sBase ? " base" : ""}${isTcp ? " wide" : ""}`}>{boxLabel(k)}</span>;
              })}
            </div>
            <p className="tl-small">
              {isTcp
                ? `SendBase = ${byteAt(st.sBase)} · NextSeqNum = ${byteAt(st.sNext)} · window ${sim.N} segments`
                : `base = ${st.sBase} · nextseqnum = ${st.sNext}${pipelined ? ` · N = ${sim.N}` : " · stop-and-wait (N = 1)"}`}
            </p>
            <div className="tl-legend">
              <span className="tl-box acked"/>ACKed <span className="tl-box sent"/>sent, not ACKed <span className="tl-box usable"/>usable <span className="tl-box idle"/>not usable
            </div>
            <div className="tl-title" style={{ marginTop:12 }}>Receiver</div>
            <div className="tl-boxes">
              {Array.from({ length: sim.M }, (_, k) => {
                const cls = k < st.rBase ? "acked" : st.rBuf.includes(k) ? "buffered" : protocol === "sr" && k < st.rBase + sim.N ? "usable" : k === st.rBase ? "usable" : "idle";
                return <span key={k} className={`tl-box ${cls}${isTcp ? " wide" : ""}`}>{boxLabel(k)}</span>;
              })}
            </div>
            <p className="tl-small">
              {isTcp ? `next byte expected (ACK number) = ${byteAt(st.rBase)}${st.rBuf.length ? ` · buffered: ${st.rBuf.map(boxLabel).join(", ")}` : ""}`
                : protocol === "sr" ? `rcv_base = ${st.rBase} · buffered: ${st.rBuf.length ? st.rBuf.join(", ") : "none"}` : `expecting message ${st.rBase}`}
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
    </>
  );

  function boxLabel(k) { return sim.boxLabels ? sim.boxLabels[k] : k; }
  function byteAt(k) { return k < sim.M ? sim.boxLabels[k] : sim.boxLabels[sim.M - 1] + sim.sizes[sim.M - 1]; }
}

// ── RTT estimation ────────────────────────────────────────────────────────────
function RttCalc() {
  const [est, setEst] = useState("250");
  const [dev, setDev] = useState("20");
  const [alpha, setAlpha] = useState("0.125");
  const [beta, setBeta] = useState("0.25");
  const [samples, setSamples] = useState("380");
  const nums = samples.split(/[,\s]+/).filter(Boolean).map(Number);
  const valid = [est, dev, alpha, beta].every(v => v !== "" && Number.isFinite(Number(v))) && nums.length && nums.every(Number.isFinite);
  const rows = valid ? rttEstimate(Number(est), Number(dev), nums, Number(alpha), Number(beta)) : [];
  const a = Number(alpha), b = Number(beta);
  const f = n => +n.toFixed(4);
  return (
    <div className="tl-calc">
      <div className="tl-card">
        <div className="tl-title">TCP round-trip time estimation</div>
        <p className="tl-explainp">
          TCP measures SampleRTT for segments that weren't retransmitted, then smooths it. The timeout is the estimate plus a safety margin of four deviations.
        </p>
        <div className="tl-formulas">
          <code>EstimatedRTT = (1 − α)·EstimatedRTT + α·SampleRTT</code>
          <code>DevRTT = (1 − β)·DevRTT + β·|SampleRTT − EstimatedRTT|</code>
          <code>TimeoutInterval = EstimatedRTT + 4·DevRTT</code>
        </div>
        <p className="tl-small">DevRTT uses the EstimatedRTT from before this sample, as in the lecture's worked answer.</p>
        <div className="tl-form">
          <label>EstimatedRTT (ms)<input value={est} onChange={e => setEst(e.target.value)} inputMode="decimal"/></label>
          <label>DevRTT (ms)<input value={dev} onChange={e => setDev(e.target.value)} inputMode="decimal"/></label>
          <label>α<input value={alpha} onChange={e => setAlpha(e.target.value)} inputMode="decimal"/></label>
          <label>β<input value={beta} onChange={e => setBeta(e.target.value)} inputMode="decimal"/></label>
          <label className="tl-wide">SampleRTTs (ms, comma-separated)<input value={samples} onChange={e => setSamples(e.target.value)}/></label>
        </div>
        {!valid && <p className="tl-err">Enter numbers in every field.</p>}
      </div>
      {valid && (
        <div className="tl-card">
          <div className="tl-title">Working</div>
          {rows.map((r, i) => (
            <div key={i} className="tl-work">
              <div className="tl-worktitle">Sample {i + 1}: SampleRTT = {r.sample} ms</div>
              <code>EstimatedRTT = {f(1 - a)}×{f(r.prevEst)} + {f(a)}×{r.sample} = <b>{f(r.est)} ms</b></code>
              <code>DevRTT = {f(1 - b)}×{f(r.prevDev)} + {f(b)}×|{r.sample} − {f(r.prevEst)}| = <b>{f(r.dev)} ms</b></code>
              <code>Timeout = {f(r.est)} + 4×{f(r.dev)} = <b>{f(r.timeout)} ms</b></code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Flow control ──────────────────────────────────────────────────────────────
function FlowCalc() {
  const [file, setFile] = useState(4096);
  const [buffer, setBuffer] = useState(3072);
  const [read, setRead] = useState(2048);
  const [readAt, setReadAt] = useState(3);
  const rows = flowControl({ file, buffer, reads:{ [readAt]:read }, rounds:12 });
  const num = (v, set) => e => set(Math.max(0, Math.round(Number(e.target.value) || 0)));
  return (
    <div className="tl-calc">
      <div className="tl-card">
        <div className="tl-title">TCP flow control</div>
        <p className="tl-explainp">
          The receiver advertises how much free buffer space it has (rwnd) in every ACK, and the sender never has more unACKed bytes in flight than that.
          When rwnd reaches 0 the sender keeps sending 1-byte probes so it finds out when space frees up. Default values are the lecture example.
        </p>
        <div className="tl-form">
          <label>File size (bytes)<input type="number" value={file} onChange={num(file, setFile)}/></label>
          <label>Receive buffer (bytes)<input type="number" value={buffer} onChange={num(buffer, setBuffer)}/></label>
          <label>App reads (bytes)<input type="number" value={read} onChange={num(read, setRead)}/></label>
          <label>…at round<input type="number" value={readAt} min="1" max="12" onChange={num(readAt, setReadAt)}/></label>
        </div>
      </div>
      <div className="tl-card">
        <div className="tl-title">Round by round</div>
        <div className="tl-tablewrap">
          <table className="tl-table">
            <thead><tr><th>Round</th><th>Sender knows rwnd</th><th>App reads</th><th>Sender sends</th><th>Accepted</th><th>Buffer</th><th>New rwnd</th><th>Left to send</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.round} className={r.probe ? "probe" : ""}>
                  <td>{r.round}</td>
                  <td>{r.rwndKnown}</td>
                  <td>{r.read || "—"}</td>
                  <td>{r.sent ? `${r.sent}${r.probe ? " (probe)" : ""}` : "—"}</td>
                  <td className={r.rejected ? "bad" : ""}>{r.sent ? (r.rejected ? `${r.accepted} (${r.rejected} dropped)` : r.accepted) : "—"}</td>
                  <td>
                    <div className="tl-bar"><span style={{ width:`${(r.buffered / Math.max(1, buffer)) * 100}%` }}/></div>
                    <small>{r.buffered}/{buffer}</small>
                  </td>
                  <td className={r.rwnd === 0 ? "bad" : "ok"}>{r.rwnd}</td>
                  <td>{r.remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Congestion control ────────────────────────────────────────────────────────
const LOSS_CYCLE = { undefined:"dup", dup:"timeout", timeout:undefined };

function CwndChart() {
  const [rounds, setRounds] = useState(16);
  const [ssthresh, setSsthresh] = useState(8);
  const [variant, setVariant] = useState("both");
  const [events, setEvents] = useState({ 8:"dup" });
  const reno = congestion({ rounds, ssthresh, variant:"reno", events });
  const tahoe = congestion({ rounds, ssthresh, variant:"tahoe", events });
  const main = variant === "tahoe" ? tahoe : reno;
  const maxY = Math.max(ssthresh, ...reno.map(r => r.cwnd), ...tahoe.map(r => r.cwnd)) + 2;
  const CW = 760, CH = 300, PL = 44, PB = 30, PT = 12;
  const x = r => PL + ((r - 1) / Math.max(1, rounds - 1)) * (CW - PL - 16);
  const y = v => PT + (1 - v / maxY) * (CH - PT - PB);
  const path = rows => rows.map((r, i) => `${i ? "L" : "M"}${x(r.round)},${y(r.cwnd)}`).join(" ");
  const toggle = r => setEvents(e => { const n = { ...e }; const v = LOSS_CYCLE[e[r]]; if (v) n[r] = v; else delete n[r]; return n; });
  return (
    <div className="tl-calc">
      <div className="tl-card">
        <div className="tl-title">TCP congestion window (cwnd), one point per RTT</div>
        <p className="tl-explainp">
          Slow start doubles cwnd every RTT until it reaches ssthresh, then congestion avoidance adds 1 MSS per RTT (AIMD).
          On a loss, ssthresh becomes half of cwnd. A timeout restarts slow start from 1. Three duplicate ACKs: Reno (the course default) goes to fast recovery at ssthresh + 3; Tahoe restarts from 1.
          <b> Click a round on the chart</b> to add a loss there: 3 duplicate ACKs → timeout → none.
        </p>
        <div className="tl-form">
          <label>Rounds<input type="number" value={rounds} min="4" max="40" onChange={e => setRounds(Math.min(40, Math.max(4, Number(e.target.value) || 4)))}/></label>
          <label>Initial ssthresh (MSS)<input type="number" value={ssthresh} min="2" max="64" onChange={e => setSsthresh(Math.min(64, Math.max(2, Number(e.target.value) || 2)))}/></label>
          <label>Show
            <select value={variant} onChange={e => setVariant(e.target.value)}>
              <option value="both">Reno and Tahoe</option>
              <option value="reno">Reno only</option>
              <option value="tahoe">Tahoe only</option>
            </select>
          </label>
          <button className="tl-btn" onClick={() => { setRounds(16); setSsthresh(8); setEvents({ 8:"dup" }); }}>Lecture figure: loss at round 8</button>
          <button className="tl-btn" onClick={() => setEvents({})}>No losses</button>
        </div>
        <svg viewBox={`0 0 ${CW} ${CH}`} className="tl-chart" role="img" aria-label="Congestion window over transmission rounds">
          {Array.from({ length: Math.floor(maxY / 2) + 1 }, (_, i) => i * 2).map(v => (
            <g key={v}>
              <line x1={PL} x2={CW - 10} y1={y(v)} y2={y(v)} className="tl-grid"/>
              <text x={PL - 6} y={y(v) + 3} textAnchor="end" className="tl-tick">{v}</text>
            </g>
          ))}
          {main.map(r => (
            <g key={r.round} className="tl-roundhit" onClick={() => toggle(r.round)}>
              <rect x={x(r.round) - 10} y={PT} width={20} height={CH - PT - PB} fill="transparent"/>
              <text x={x(r.round)} y={CH - 10} textAnchor="middle" className="tl-tick">{r.round}</text>
              {events[r.round] && <text x={x(r.round)} y={PT + 10} textAnchor="middle" className={`tl-lossmark ${events[r.round]}`}>
                {events[r.round] === "dup" ? "3 dup" : "timeout"}</text>}
            </g>
          ))}
          <path d={main.map((r, i) => `${i ? "L" : "M"}${x(r.round)},${y(r.ssthresh)}`).join(" ")} className="tl-ssthresh"/>
          {(variant === "both" || variant === "tahoe") && <path d={path(tahoe)} className="tl-line tahoe"/>}
          {(variant === "both" || variant === "reno") && <path d={path(reno)} className="tl-line reno"/>}
          {(variant === "tahoe" ? tahoe : reno).map(r => (
            <circle key={r.round} cx={x(r.round)} cy={y(r.cwnd)} r={3.5} className={`tl-pt ${r.phase.replace(/ /g, "-")}`}/>
          ))}
          <text x={CW / 2} y={CH - 0} textAnchor="middle" className="tl-tick">transmission round</text>
        </svg>
        <div className="tl-legend">
          {variant !== "tahoe" && <><span className="tl-key reno"/>Reno</>}
          {variant !== "reno" && <><span className="tl-key tahoe"/>Tahoe</>}
          <span className="tl-key ss"/>ssthresh
          <span className="tl-dot slow-start"/>slow start <span className="tl-dot congestion-avoidance"/>congestion avoidance <span className="tl-dot fast-recovery"/>fast recovery
        </div>
      </div>
      <div className="tl-card">
        <div className="tl-title">{variant === "tahoe" ? "Tahoe" : "Reno"} round by round</div>
        <div className="tl-tablewrap">
          <table className="tl-table">
            <thead><tr><th>Round</th><th>cwnd (MSS)</th><th>ssthresh</th><th>Phase</th><th>Loss at end of round</th></tr></thead>
            <tbody>
              {main.map(r => (
                <tr key={r.round} className={r.event ? "probe" : ""}>
                  <td>{r.round}</td><td>{r.cwnd}</td><td>{r.ssthresh}</td><td>{r.phase}</td>
                  <td>{r.event === "dup" ? "3 duplicate ACKs" : r.event === "timeout" ? "timeout" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Internet checksum ─────────────────────────────────────────────────────────
function ChecksumCalc() {
  const [text, setText] = useState("1111 0101 1101 0011\n1011 0011 0100 0100");
  const words = text.split("\n").map(s => s.trim()).filter(Boolean);
  const res = checksum(words);
  return (
    <div className="tl-calc">
      <div className="tl-card">
        <div className="tl-title">Internet checksum (UDP, TCP, IP)</div>
        <p className="tl-explainp">
          Treat the data as 16-bit words and add them. Whenever the sum carries out of the 16th bit, wrap that carry around and add it to the lowest bit.
          The checksum is the one's complement (all bits flipped) of the final sum. The receiver adds every word plus the checksum: all 1s means no error detected.
        </p>
        <div className="tl-form">
          <label className="tl-wide">16-bit words, one per line (binary or 0x hex)
            <textarea rows={4} value={text} onChange={e => setText(e.target.value)} spellCheck={false}/>
          </label>
          <button className="tl-btn" onClick={() => setText("1111 0101 1101 0011\n1011 0011 0100 0100")}>Slide exercise</button>
          <button className="tl-btn" onClick={() => setText("1110 0110 0110 0110\n1101 0101 0101 0101")}>Slide example</button>
        </div>
      </div>
      <div className="tl-card">
        <div className="tl-title">Working</div>
        {res.error ? <p className="tl-err">{res.error}</p> : (
          <div className="tl-sum">
            {res.steps.length === 0 && <div><span>sum</span><code>{bin16(res.sum)}</code></div>}
            {res.steps.map((s, i) => (
              <div key={i} className="tl-sumstep">
                <div><span>{i === 0 ? "" : "sum so far"}</span><code>{"  "}{bin16(s.a)}</code></div>
                <div><span>+</span><code>{"  "}{bin16(s.b)}</code></div>
                <div className="tl-rule"><span>=</span><code className={s.carry ? "carry" : ""}>{s.carry ? "1 " : "  "}{bin16(s.raw & 0xffff)}</code></div>
                {s.carry && <div><span>wraparound</span><code>{"  "}{bin16(s.wrapped)}</code></div>}
              </div>
            ))}
            <div className="tl-rule"><span>flip bits</span><code className="result">{"  "}{bin16(res.checksum)}</code></div>
            <p className="tl-small">
              Checksum = {bin16(res.checksum)} (0x{res.checksum.toString(16).toUpperCase().padStart(4, "0")}).
              Receiver check: sum + checksum = {bin16((res.sum + res.checksum) & 0xffff)} {res.verify ? "✓ all 1s" : "✗"}.
            </p>
          </div>
        )}
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
