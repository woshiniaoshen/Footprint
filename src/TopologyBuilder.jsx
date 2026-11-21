import { useState, useRef, useMemo, useEffect } from "react";
import {
  PRESETS, makeDevice, nextNum, connect, removeDevice, deviceById, linkAt, otherEnd,
  portName, portLabel, portAddr, parseAddr, parseIp, macOf, routingTable, problems,
  trace, deviceIps, numToIp, interfaces, switchPort, parseAllowed, validVlan,
  linkIsTrunk, accessVlanOf, usesVlans, NATIVE_VLAN,
  emptyTables, mergeLearned, arpTableOf, macTableOf,
} from "./topoEngine.js";
import "./topology.css";

const STORAGE_KEY = "osi-topology-v1";
const VIEW_W = 1000, VIEW_H = 460;
const TYPE_COLOR = { pc:"#63b3ed", switch:"#42d9b8", router:"#fb923c" };
const KIND_ICON = { route:"🧭", arp:"❓", send:"📤", switch:"🔀", arrive:"📥", deliver:"✅", drop:"⛔" };
const VLAN_PALETTE = ["#63b3ed", "#f2c36b", "#a78bfa", "#f472b6", "#4ade80", "#fb923c"];
const vlanColor = v => (v && v !== NATIVE_VLAN ? VLAN_PALETTE[v % VLAN_PALETTE.length] : null);

function loadSaved() {
  try {
    const t = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (t && Array.isArray(t.devices) && Array.isArray(t.links)) return t;
  } catch { /* storage unavailable */ }
  return null;
}

function DeviceIcon({ d, color }) {
  const { x, y } = d;
  if (d.type === "pc") return <>
    <rect x={x-11} y={y-12} width={22} height={15} rx={2} fill="none" stroke={color} strokeWidth={1.6}/>
    <line x1={x-6} y1={y+7} x2={x+6} y2={y+7} stroke={color} strokeWidth={1.6}/>
  </>;
  if (d.type === "switch") return <>
    <rect x={x-14} y={y-8} width={28} height={16} rx={2} fill="none" stroke={color} strokeWidth={1.6}/>
    <path d={`M${x-8} ${y-2} h12 l-3 -3 M${x+8} ${y+3} h-12 l3 3`} fill="none" stroke={color} strokeWidth={1.3}/>
  </>;
  return <>
    <circle cx={x} cy={y} r={13} fill="none" stroke={color} strokeWidth={1.6}/>
    <path d={`M${x-7} ${y} h14 M${x} ${y-7} v14 M${x+4} ${y-3} l3 3 -3 3 M${x-4} ${y-3} l-3 3 3 3`} fill="none" stroke={color} strokeWidth={1.2}/>
  </>;
}

export default function TopologyBuilder() {
  const [topo, setTopo]       = useState(() => loadSaved() || PRESETS[0].build());
  const [tool, setTool]       = useState("select");
  const [sel, setSel]         = useState(null);
  const [pending, setPending] = useState(null);
  const [msg, setMsg]         = useState("");
  const [src, setSrc]         = useState("");
  const [dst, setDst]         = useState("");
  const [result, setResult]   = useState(null);
  const [view, setView]       = useState("fwd");
  const [si, setSi]           = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pings, setPings]     = useState([]);
  const [tables, setTables]   = useState(emptyTables);
  const [panel, setPanel]     = useState("log");
  const svgRef  = useRef(null);
  const drag    = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current, li = list?.querySelector("li.on");
    if (li) list.scrollTop = li.offsetTop - list.offsetTop - list.clientHeight / 2 + li.clientHeight / 2;
  }, [si, result, view]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(topo)); } catch { /* storage unavailable */ }
  }, [topo]);

  const issues = useMemo(() => problems(topo), [topo]);
  const pcs = topo.devices.filter(d => d.type === "pc");
  const targets = topo.devices.flatMap(d => interfaces(d).map(f => ({ d, f })))
    .map(({ d, f }) => ({ ip: numToIp(f.a.ip), label: `${d.name}${d.type === "router" ? ` ${f.name}` : ""} · ${numToIp(f.a.ip)}` }));
  const vlanMode = usesVlans(topo);
  const srcId = pcs.some(p => p.id === src) ? src : pcs[0]?.id || "";
  const dstIp = targets.some(t => t.ip === dst) ? dst : targets.filter(t => !deviceIps(deviceById(topo, srcId) || { ports:[] }).map(numToIp).includes(t.ip)).at(-1)?.ip || "";

  const run    = result ? result[view] : null;
  const step   = run?.steps[Math.min(si, run.steps.length - 1)];
  const stepCount = run?.steps.length || 0;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setSi(i => {
        if (i >= stepCount - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 1100);
    return () => clearInterval(t);
  }, [playing, stepCount]);

  function edit(fn) {
    setTopo(t => { const c = structuredClone(t); fn(c); return c; });
    setResult(null);
    setPlaying(false);
    setTables(emptyTables());
  }

  function addDevice(type) {
    const n = topo.devices.length;
    const x = 120 + ((n * 137) % 760), y = 90 + ((n * 89) % 280);
    const d = makeDevice(type, nextNum(topo, type), x, y);
    edit(t => { t.devices.push(structuredClone(d)); });
    setSel({ kind:"dev", id:d.id });
    setMsg(`Added ${type}. Drag it into place, then use Connect to cable it.`);
  }

  function deleteSelected() {
    if (!sel) return;
    if (sel.kind === "dev") edit(t => removeDevice(t, sel.id));
    else edit(t => { t.links = t.links.filter(l => l.id !== sel.id); });
    setSel(null);
  }

  useEffect(() => {
    const fn = e => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); deleteSelected(); }
      if (e.key === "Escape") { setPending(null); setTool("select"); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  });

  function svgPoint(e) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function onDeviceDown(e, d) {
    e.stopPropagation();
    if (tool === "connect") {
      if (!pending) { setPending(d.id); setMsg(`Now click the device to cable ${d.name} to.`); return; }
      if (pending === d.id) { setPending(null); setMsg(""); return; }
      const next = structuredClone(topo);
      const res = connect(next, pending, d.id);
      if (!res.error) { setTopo(next); setResult(null); setPlaying(false); setTables(emptyTables()); }
      const a = deviceById(topo, pending);
      setMsg(res.error ? res.error : `Cabled ${a?.name} ↔ ${d.name}. Click another pair, or press Esc.`);
      setPending(null);
      return;
    }
    setSel({ kind:"dev", id:d.id });
    const p = svgPoint(e);
    drag.current = { id:d.id, dx:p.x - d.x, dy:p.y - d.y };
    svgRef.current.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!drag.current) return;
    const p = svgPoint(e);
    const { id, dx, dy } = drag.current;
    const x = Math.max(30, Math.min(VIEW_W - 30, p.x - dx));
    const y = Math.max(30, Math.min(VIEW_H - 60, p.y - dy));
    setTopo(t => ({ ...t, devices: t.devices.map(d => d.id === id ? { ...d, x, y } : d) }));
  }

  function runTrace(fromId = srcId, toIp = dstIp) {
    const srcDev = deviceById(topo, fromId);
    if (!srcDev || !toIp) return;
    const fwd = trace(topo, fromId, toIp);
    const owner = topo.devices.find(d => deviceIps(d).map(numToIp).includes(toIp));
    const srcAddr = portAddr(srcDev, 0);
    const rev = fwd.ok && owner?.type === "pc" && owner.id !== fromId && srcAddr
      ? trace(topo, owner.id, numToIp(srcAddr.ip)) : null;
    const n = (pings[0]?.n || 0) + 1;
    setTables(t => mergeLearned(mergeLearned(t, fwd.learned, n), rev?.learned, n));
    setPings(p => [{
      n, time: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" }),
      srcId: fromId, dstIp: toIp,
      from: `${srcDev.name} (${srcAddr ? numToIp(srcAddr.ip) : "no IP"})`,
      to: targets.find(t => t.ip === toIp)?.label || toIp,
      fwdOk: fwd.ok, revOk: rev ? rev.ok : null,
      routers: fwd.steps.filter(s => s.kind === "route" && deviceById(topo, s.at)?.type === "router").length,
      ttl: fwd.ttl ?? null,
      reason: !fwd.ok ? fwd.reason : rev && !rev.ok ? `Reply: ${rev.reason}` : "",
    }, ...p].slice(0, 50));
    setSrc(fromId); setDst(toIp);
    setResult({ fwd, rev });
    setView("fwd"); setSi(0); setPlaying(true);
  }

  function loadPreset(id) {
    if (!id) return;
    if (topo.devices.length && !window.confirm("Replace the current topology with this preset?")) return;
    const p = PRESETS.find(x => x.id === id);
    setTopo(p.build());
    setSel(null); setResult(null); setPending(null); setPlaying(false); setSrc(""); setDst("");
    setPings([]); setTables(emptyTables());
    setMsg(p.hint);
  }

  const hotDevs  = new Set(step ? [step.at] : []);
  const hotLinks = new Set(step?.links || []);
  const dotDev   = step ? deviceById(topo, step.at) : null;
  const selDev   = sel?.kind === "dev" ? deviceById(topo, sel.id) : null;
  const selLink  = sel?.kind === "link" ? topo.links.find(l => l.id === sel.id) : null;
  const visited  = new Set(run ? run.steps.slice(0, si + 1).map(s => s.at) : []);

  return (
    <div className="tb">
      <div className="tb-toolbar">
        <div className="tb-group">
          <button className="tb-btn" onClick={() => addDevice("pc")}>+ PC</button>
          <button className="tb-btn" onClick={() => addDevice("switch")}>+ Switch</button>
          <button className="tb-btn" onClick={() => addDevice("router")}>+ Router</button>
        </div>
        <div className="tb-group">
          <button className={`tb-btn${tool === "select" ? " tb-on" : ""}`} onClick={() => { setTool("select"); setPending(null); setMsg(""); }}>↖ Move</button>
          <button className={`tb-btn${tool === "connect" ? " tb-on" : ""}`} onClick={() => { setTool("connect"); setPending(null); setMsg("Click two devices to run a cable between them."); }}>🔌 Connect</button>
          <button className="tb-btn tb-danger" disabled={!sel} onClick={deleteSelected}>🗑 Delete</button>
        </div>
        <select className="tb-select" value="" onChange={e => loadPreset(e.target.value)}>
          <option value="">Load preset…</option>
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {msg && <div className="tb-msg">{msg}</div>}

      <div className="tb-body">
        <div className="tb-left">
        <div className="tb-canvas-wrap">
          <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className={`tb-canvas tb-tool-${tool}`}
            onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
            onPointerDown={() => { setSel(null); if (tool === "connect") setPending(null); }}>
            <defs>
              <pattern id="tb-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.05)"/>
              </pattern>
            </defs>
            <rect width={VIEW_W} height={VIEW_H} fill="url(#tb-grid)"/>

            {topo.links.map(l => {
              const a = deviceById(topo, l.a.dev), b = deviceById(topo, l.b.dev);
              if (!a || !b) return null;
              const hot = hotLinks.has(l.id), picked = sel?.kind === "link" && sel.id === l.id;
              const trunk = vlanMode && linkIsTrunk(topo, l);
              const accessVlan = [l.a, l.b].map(end => {
                const d = deviceById(topo, end.dev);
                if (d?.type !== "switch") return null;
                const sp = switchPort(d.ports[end.port]);
                return sp.mode === "access" ? sp.vlan : null;
              }).find(v => v !== null);
              const idle = !vlanMode ? "rgba(255,255,255,0.22)" : trunk ? "rgba(241,245,249,0.45)" : vlanColor(accessVlan) ? `${vlanColor(accessVlan)}aa` : "rgba(255,255,255,0.22)";
              const stroke = picked ? "#f2c36b" : hot ? "#42d9b8" : idle;
              const lbl = (from, to, port) => {
                const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
                const k = Math.min(0.42, 40 / len);
                return <text x={from.x + (to.x - from.x) * k} y={from.y + (to.y - from.y) * k - 6}
                  className="tb-portlbl" textAnchor="middle">{portName(from.type, port)}</text>;
              };
              return (
                <g key={l.id} onPointerDown={e => { e.stopPropagation(); setSel({ kind:"link", id:l.id }); }} style={{ cursor:"pointer" }}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14}/>
                  {trunk ? <>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={hot || picked ? 6 : 5}/>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#111827" strokeWidth={hot || picked ? 2.5 : 2}/>
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 7} className="tb-trunklbl" textAnchor="middle">802.1Q</text>
                  </> : (
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={hot || picked ? 3 : 1.8}/>
                  )}
                  {lbl(a, b, l.a.port)}
                  {lbl(b, a, l.b.port)}
                </g>
              );
            })}

            {topo.devices.map(d => {
              const color = TYPE_COLOR[d.type];
              const hot = hotDevs.has(d.id), picked = sel?.kind === "dev" && sel.id === d.id;
              const isPending = pending === d.id;
              const hasIssue = issues.some(p => p.dev === d.id && p.level === "error");
              const ring = picked || isPending ? "#f2c36b" : hot ? (step?.kind === "drop" ? "#e63946" : "#42d9b8") : visited.has(d.id) ? `${color}aa` : "rgba(255,255,255,0.25)";
              const ifs = d.type === "router" ? interfaces(d) : [];
              const pcVlan = vlanMode && d.type === "pc" ? accessVlanOf(topo, d.id, 0) : null;
              return (
                <g key={d.id} onPointerDown={e => onDeviceDown(e, d)} className="tb-dev">
                  <circle cx={d.x} cy={d.y} r={25} fill={hot ? "rgba(66,217,184,0.12)" : "#0d1520"} stroke={ring} strokeWidth={hot || picked || isPending ? 2.5 : 1.2}
                    strokeDasharray={isPending ? "4 3" : undefined}/>
                  <DeviceIcon d={d} color={color}/>
                  {hasIssue && <circle cx={d.x + 19} cy={d.y - 19} r={5} fill="#e63946"/>}
                  <text x={d.x} y={d.y + 38} textAnchor="middle" className="tb-devname">{d.name}</text>
                  {d.type === "pc" && <text x={d.x} y={d.y + 50} textAnchor="middle" className="tb-devip">{d.ports[0].addr || "no IP"}</text>}
                  {d.type === "router" && ifs.map((f, k) => (
                    <text key={f.name} x={d.x} y={d.y + 50 + k * 11} textAnchor="middle" className="tb-devip"
                      style={vlanColor(f.tag) ? { fill:vlanColor(f.tag) } : undefined}>
                      {f.name} {numToIp(f.a.ip)}/{f.a.prefix}
                    </text>
                  ))}
                  {pcVlan !== null && (
                    <g>
                      <rect x={d.x - 46} y={d.y - 31} width={30} height={13} rx={6.5} fill="#0d1520"
                        stroke={vlanColor(pcVlan) || "rgba(255,255,255,0.35)"}/>
                      <text x={d.x - 31} y={d.y - 21.5} textAnchor="middle" className="tb-vlanpill"
                        style={{ fill: vlanColor(pcVlan) || "rgba(241,245,249,0.6)" }}>V{pcVlan}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {dotDev && (
              <g className="tb-dot" style={{ transform:`translate(${dotDev.x}px, ${dotDev.y}px)` }}>
                <circle r={11} fill={step.kind === "drop" ? "rgba(230,57,70,0.25)" : "rgba(66,217,184,0.2)"}/>
                <circle r={5} fill={step.kind === "drop" ? "#e63946" : "#42d9b8"}/>
              </g>
            )}
            {!topo.devices.length && (
              <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" className="tb-empty">
                Add a PC, switch or router above, or load a preset
              </text>
            )}
          </svg>
          <p className="tb-hint">Drag to move · Connect mode to cable devices · Click a device or cable to edit · Delete key removes the selection</p>
        </div>

        <div className="tb-card tb-panel">
          <div className="tb-tabs" role="tablist">
            <button role="tab" aria-selected={panel === "log"} className={panel === "log" ? "on" : ""} onClick={() => setPanel("log")}>
              Ping log{pings.length ? ` (${pings.length})` : ""}
            </button>
            <button role="tab" aria-selected={panel === "hops"} className={panel === "hops" ? "on" : ""} onClick={() => setPanel("hops")}>
              Hop-by-hop
            </button>
            <button role="tab" aria-selected={panel === "tables"} className={panel === "tables" ? "on" : ""} onClick={() => setPanel("tables")}>
              Device tables
            </button>
          </div>
          {panel === "log" && <PingLog pings={pings} onReplay={p => runTrace(p.srcId, p.dstIp)} onClear={() => setPings([])}/>}
          {panel === "hops" && <HopTable topo={topo} run={run} view={view} si={si}
            onPick={i => { setPlaying(false); setSi(i); }}/>}
          {panel === "tables" && <DeviceTables topo={topo} tables={tables}
            onPick={id => setSel({ kind:"dev", id })} onClear={() => setTables(emptyTables())}/>}
        </div>
        </div>

        <aside className="tb-side">
          {issues.length > 0 && (
            <details className="tb-card tb-issues" open={issues.some(i => i.level === "error")}>
              <summary>⚠ {issues.length} configuration {issues.length === 1 ? "issue" : "issues"}</summary>
              <ul>
                {issues.map((p, i) => (
                  <li key={i} className={`tb-issue-${p.level}`} onClick={() => p.dev && setSel({ kind:"dev", id:p.dev })}>{p.text}</li>
                ))}
              </ul>
            </details>
          )}

          {selDev && <Inspector d={selDev} topo={topo} edit={edit}/>}
          {selLink && <LinkInspector l={selLink} topo={topo} onDelete={deleteSelected}/>}

          <div className="tb-card">
            <div className="tb-card-title">📦 Send a packet</div>
            <label className="tb-field">From
              <select value={srcId} onChange={e => { setSrc(e.target.value); setResult(null); }}>
                {pcs.length === 0 && <option value="">Add a PC first</option>}
                {pcs.map(p => <option key={p.id} value={p.id}>{p.name} · {p.ports[0].addr || "no IP"}</option>)}
              </select>
            </label>
            <label className="tb-field">To
              <select value={dstIp} onChange={e => { setDst(e.target.value); setResult(null); }}>
                {targets.length === 0 && <option value="">No addressed devices</option>}
                {targets.map(t => <option key={t.label} value={t.ip}>{t.label}</option>)}
              </select>
            </label>
            <button className="tb-run" disabled={!srcId || !dstIp} onClick={() => runTrace()}>▶ Send ping</button>

            {result && (
              <>
                <div className="tb-verdicts">
                  <button className={`tb-verdict ${result.fwd.ok ? "ok" : "bad"}${view === "fwd" ? " on" : ""}`}
                    onClick={() => { setView("fwd"); setSi(0); setPlaying(false); }}>
                    {result.fwd.ok ? "✓" : "✗"} Request
                  </button>
                  {result.rev && (
                    <button className={`tb-verdict ${result.rev.ok ? "ok" : "bad"}${view === "rev" ? " on" : ""}`}
                      onClick={() => { setView("rev"); setSi(0); setPlaying(false); }}>
                      {result.rev.ok ? "✓" : "✗"} Reply
                    </button>
                  )}
                </div>
                {result.rev && !result.rev.ok && view === "fwd" && (
                  <p className="tb-note">The request arrives, but the reply is dropped — open “Reply” to see where.</p>
                )}
                <div className="tb-stepnav">
                  <button onClick={() => { setPlaying(false); setSi(i => Math.max(0, i - 1)); }} disabled={si === 0}>◀</button>
                  <button onClick={() => { if (si >= stepCount - 1) setSi(0); setPlaying(p => !p); }}>{playing ? "⏸" : "▶"}</button>
                  <button onClick={() => { setPlaying(false); setSi(i => Math.min(stepCount - 1, i + 1)); }} disabled={si >= stepCount - 1}>▶|</button>
                  <span>Step {Math.min(si, stepCount - 1) + 1} / {stepCount}</span>
                </div>
                {step && (
                  <div className={`tb-step tb-step-${step.kind}`}>
                    <div className="tb-step-title">{KIND_ICON[step.kind]} {step.title}</div>
                    {step.detail && <p>{step.detail}</p>}
                    {step.frame && (
                      <table className="tb-frame">
                        <tbody>
                          <tr><th>L2 src MAC</th><td>{step.frame.srcMac}</td></tr>
                          <tr><th>L2 dst MAC</th><td>{step.frame.dstMac}</td></tr>
                          <tr><th>L3 src IP</th><td>{step.frame.srcIp}</td></tr>
                          <tr><th>L3 dst IP</th><td>{step.frame.dstIp}</td></tr>
                          <tr><th>TTL</th><td>{step.frame.ttl}</td></tr>
                          {vlanMode && (
                            <tr><th>802.1Q</th><td style={vlanColor(step.frame.tag ?? step.frame.vlan) ? { color:vlanColor(step.frame.tag ?? step.frame.vlan) } : undefined}>
                              {step.frame.tag !== null && step.frame.tag !== undefined
                                ? `tag ${step.frame.tag}`
                                : step.frame.vlan ? `untagged (VLAN ${step.frame.vlan})` : "untagged"}
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
                <ol className="tb-steplist" ref={listRef}>
                  {run.steps.map((s, i) => (
                    <li key={i} className={`${i === si ? "on" : ""} ${i > si ? "future" : ""} k-${s.kind}`}
                      onClick={() => { setPlaying(false); setSi(i); }}>
                      <span>{KIND_ICON[s.kind]}</span>{s.title}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, check, placeholder }) {
  const bad = value && check && check.error;
  return (
    <label className="tb-field">{label}
      <input className={bad ? "tb-bad" : ""} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}/>
      {bad && <span className="tb-err">{check.error}</span>}
    </label>
  );
}

function peerText(topo, d, i) {
  const l = linkAt(topo, d.id, i);
  return l ? `→ ${portLabel(topo, otherEnd(l, d.id, i))}` : "no cable";
}

function Inspector({ d, topo, edit }) {
  const set = fn => edit(t => fn(deviceById(t, d.id)));
  const color = TYPE_COLOR[d.type];
  return (
    <div className="tb-card">
      <div className="tb-card-title" style={{ color }}>
        {d.type === "pc" ? "🖥 PC" : d.type === "switch" ? "🔀 Switch" : "🧭 Router"} · {d.name}
      </div>
      <Field label="Name" value={d.name} onChange={v => set(x => { x.name = v; })}/>

      {d.type === "pc" && <>
        <Field label="IP address / prefix" value={d.ports[0].addr} placeholder="192.168.1.10/24"
          onChange={v => set(x => { x.ports[0].addr = v; })} check={d.ports[0].addr ? parseAddr(d.ports[0].addr) : null}/>
        <Field label="Default gateway" value={d.gw} placeholder="192.168.1.1"
          onChange={v => set(x => { x.gw = v; })} check={d.gw && parseIp(d.gw) === null ? { error:"Not a valid IP" } : null}/>
        <dl className="tb-facts">
          <dt>MAC</dt><dd>{macOf(d, 0)}</dd>
          <dt>eth0</dt><dd>{peerText(topo, d, 0)}</dd>
        </dl>
      </>}

      {d.type === "switch" && <>
        <p className="tb-note">Layer 2 only — no IP needed. An access port belongs to one VLAN and carries untagged frames; a trunk carries many VLANs using 802.1Q tags.</p>
        <table className="tb-ports">
          <thead><tr><th>Port</th><th>Mode</th><th>VLAN / allowed</th></tr></thead>
          <tbody>
            {d.ports.map((p, i) => {
              const sp = switchPort(p);
              const wired = !!linkAt(topo, d.id, i);
              const c = sp.mode === "access" ? vlanColor(sp.vlan) : null;
              const badVlan = p.vlan !== undefined && !validVlan(Number(p.vlan));
              return (
                <tr key={i} className={wired ? "" : "tb-unwired"}>
                  <td><b>{portName("switch", i)}</b><span>{wired ? peerText(topo, d, i) : "unused"}</span></td>
                  <td>
                    <select value={sp.mode} onChange={e => set(x => { x.ports[i].mode = e.target.value; })}>
                      <option value="access">Access</option>
                      <option value="trunk">Trunk</option>
                    </select>
                  </td>
                  <td>
                    {sp.mode === "access"
                      ? <input className={badVlan ? "tb-bad" : ""} value={p.vlan ?? NATIVE_VLAN} inputMode="numeric"
                          style={c ? { color:c, borderColor:`${c}88` } : undefined}
                          onChange={e => set(x => { x.ports[i].vlan = e.target.value; })}/>
                      : <input className={parseAllowed(p.allowed).error ? "tb-bad" : ""} value={p.allowed ?? ""} placeholder="all"
                          onChange={e => set(x => { x.ports[i].allowed = e.target.value; })}/>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="tb-note">Trunk allowed list: blank means every VLAN, or list them like <code>10,20,30-35</code>. VLAN 1 is the native VLAN and travels untagged.</p>
      </>}

      {d.type === "router" && <>
        <div className="tb-subtitle">Interfaces</div>
        {d.ports.map((p, i) => (
          <div key={i} className="tb-iface">
            <div className="tb-iface-head"><b>{portName("router", i)}</b><span>{peerText(topo, d, i)}</span></div>
            <Field label={(p.subs || []).length ? "Untagged address (optional)" : ""} value={p.addr}
              placeholder={(p.subs || []).length ? "none" : linkAt(topo, d.id, i) ? "10.0.0.1/24" : "unused"}
              onChange={v => set(x => { x.ports[i].addr = v; })} check={p.addr ? parseAddr(p.addr) : null}/>
            {(p.subs || []).map((s, k) => {
              const v = Number(s.vlan);
              const c = vlanColor(validVlan(v) ? v : null);
              const sa = s.addr ? parseAddr(s.addr) : null;
              return (
                <div key={k} className="tb-sub">
                  <span>{portName("router", i)}.</span>
                  <input className={`tb-sub-vlan${s.vlan && (!validVlan(v) || v === NATIVE_VLAN) ? " tb-bad" : ""}`} value={s.vlan} placeholder="10"
                    inputMode="numeric" style={c ? { color:c, borderColor:`${c}88` } : undefined}
                    onChange={e => set(x => { x.ports[i].subs[k].vlan = e.target.value; })}/>
                  <input className={sa?.error ? "tb-bad" : ""} value={s.addr} placeholder="192.168.10.1/24"
                    onChange={e => set(x => { x.ports[i].subs[k].addr = e.target.value; })}/>
                  <button onClick={() => set(x => { x.ports[i].subs.splice(k, 1); })} title="Remove subinterface">✕</button>
                </div>
              );
            })}
            <button className="tb-add tb-add-sm" onClick={() => set(x => { x.ports[i].subs = [...(x.ports[i].subs || []), { vlan:"", addr:"" }]; })}>
              + VLAN subinterface
            </button>
          </div>
        ))}
        <div className="tb-subtitle">Static routes</div>
        {(d.routes || []).map((r, i) => (
          <div key={i} className="tb-route">
            <input value={r.dest} placeholder="10.0.3.0/24" onChange={e => set(x => { x.routes[i].dest = e.target.value; })}/>
            <span>via</span>
            <input value={r.via} placeholder="10.0.12.2" onChange={e => set(x => { x.routes[i].via = e.target.value; })}/>
            <button onClick={() => set(x => { x.routes.splice(i, 1); })} title="Remove route">✕</button>
          </div>
        ))}
        <button className="tb-add" onClick={() => set(x => { x.routes.push({ dest:"", via:"" }); })}>+ Add route</button>
        <p className="tb-note">Tip: 0.0.0.0/0 is a default route — it matches anything not matched more specifically.</p>
        <div className="tb-subtitle">Routing table</div>
        <table className="tb-rt">
          <thead><tr><th></th><th>Network</th><th>Via</th><th>Port</th></tr></thead>
          <tbody>
            {routingTable(topo, d).map((r, i) => (
              <tr key={i} className={r.port === null ? "tb-dead" : ""}>
                <td>{r.type}</td><td>{numToIp(r.net)}/{r.prefix}</td>
                <td>{r.via === null ? "direct" : numToIp(r.via)}</td>
                <td>{r.port === null ? "unreachable" : r.iface}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>}
    </div>
  );
}

const tagLabel = f => (f.tag !== null && f.tag !== undefined ? `tag ${f.tag}` : f.vlan ? `untagged (VLAN ${f.vlan})` : "untagged");

function PingLog({ pings, onReplay, onClear }) {
  if (!pings.length) return <p className="tb-note">No pings yet. Pick a source and destination and press “Send ping” — every ping is recorded here.</p>;
  return (
    <>
      <div className="tb-tablewrap">
        <table className="tb-grid">
          <thead>
            <tr><th>#</th><th>Time</th><th>From</th><th>To</th><th>Request</th><th>Reply</th><th>Routers</th><th>TTL</th><th>What happened</th></tr>
          </thead>
          <tbody>
            {pings.map(p => (
              <tr key={p.n} className="tb-click" onClick={() => onReplay(p)} title="Click to send this ping again">
                <td>{p.n}</td>
                <td className="mono">{p.time}</td>
                <td>{p.from}</td>
                <td>{p.to}</td>
                <td className={p.fwdOk ? "ok" : "bad"}>{p.fwdOk ? "✓ arrived" : "✗ dropped"}</td>
                <td className={p.revOk === null ? "" : p.revOk ? "ok" : "bad"}>{p.revOk === null ? "—" : p.revOk ? "✓ arrived" : "✗ dropped"}</td>
                <td>{p.fwdOk ? p.routers : "—"}</td>
                <td>{p.ttl ?? "—"}</td>
                <td className={p.reason ? "bad" : ""}>{p.reason || (p.revOk ? "Delivered both ways" : "Delivered")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tb-panelbar">
        <span>Click a row to send that ping again.</span>
        <button onClick={onClear}>Clear log</button>
      </div>
    </>
  );
}

function HopTable({ topo, run, view, si, onPick }) {
  if (!run) return <p className="tb-note">Send a ping to see every step it takes: which device handled it and the MAC, IP, VLAN and TTL values at that point.</p>;
  const prevFrames = run.steps.map((_, i) => run.steps.slice(0, i).findLast(s => s.frame)?.frame ?? null);
  return (
    <>
      <p className="tb-note">
        {view === "fwd" ? "Request" : "Reply"} · {run.ok ? "delivered" : "dropped"} · {run.steps.length} steps.
        Highlighted cells changed since the previous frame — MAC addresses change at every router, IP addresses never do.
      </p>
      <div className="tb-tablewrap">
        <table className="tb-grid">
          <thead>
            <tr><th>#</th><th>Device</th><th>What happened</th><th>Src MAC</th><th>Dst MAC</th><th>Src IP</th><th>Dst IP</th><th>802.1Q</th><th>TTL</th></tr>
          </thead>
          <tbody>
            {run.steps.map((s, i) => {
              const f = s.frame, prev = prevFrames[i];
              const chg = k => (f && prev && (k === "tag" ? tagLabel(prev) !== tagLabel(f) : prev[k] !== f[k]) ? " chg" : "");
              return (
                <tr key={i} className={`tb-click${i === si ? " cur" : ""} k-${s.kind}`} onClick={() => onPick(i)}>
                  <td>{i + 1}</td>
                  <td>{deviceById(topo, s.at)?.name ?? "—"}</td>
                  <td className="what">{KIND_ICON[s.kind]} {s.title}</td>
                  <td className={`mono${chg("srcMac")}`}>{f?.srcMac ?? ""}</td>
                  <td className={`mono${chg("dstMac")}`}>{f?.dstMac ?? ""}</td>
                  <td className={`mono${chg("srcIp")}`}>{f?.srcIp ?? ""}</td>
                  <td className={`mono${chg("dstIp")}`}>{f?.dstIp ?? ""}</td>
                  <td className={chg("tag").trim()}>{f ? tagLabel(f) : ""}</td>
                  <td className={chg("ttl").trim()}>{f?.ttl ?? s.ttl ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MiniTable({ cols, rows, empty }) {
  if (!rows.length) return <p className="tb-mini-empty">{empty}</p>;
  return (
    <table className="tb-mini">
      <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className={r.cls || ""}>{r.c.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

const TYPE_ORDER = { router:0, switch:1, pc:2 };

function DeviceTables({ topo, tables, onPick, onClear }) {
  const [filter, setFilter] = useState("infra");
  const valid = filter === "infra" || filter === "all" || topo.devices.some(d => d.id === filter);
  const f = valid ? filter : "infra";
  const devs = topo.devices
    .filter(d => f === "infra" ? d.type !== "pc" : f === "all" || d.id === f)
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name));
  const all = [...Object.values(tables.arp), ...Object.values(tables.mac)];
  const latest = Math.max(0, ...all.map(e => e.ping));
  const fresh = e => (e.ping === latest ? "new" : "");
  const EMPTY = "Empty — send a ping to fill it";

  return (
    <>
      <div className="tb-panelbar">
        <select value={f} onChange={e => setFilter(e.target.value)}>
          <option value="infra">All routers &amp; switches</option>
          <option value="all">Every device (incl. PCs)</option>
          {topo.devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span>{all.length
          ? `${all.length} learned ${all.length === 1 ? "entry" : "entries"} · rows learned by the last ping are highlighted`
          : "MAC and ARP tables start empty — devices learn them from the traffic they see."}</span>
        <button onClick={onClear} disabled={!all.length}>Clear learned</button>
      </div>
      {!devs.length && <p className="tb-note">No devices to show.</p>}
      <div className="tb-devgrid">
        {devs.map(d => (
          <div key={d.id} className="tb-devcard">
            <button className="tb-devcard-title" style={{ color:TYPE_COLOR[d.type] }} onClick={() => onPick(d.id)}>
              {d.type === "pc" ? "🖥" : d.type === "switch" ? "🔀" : "🧭"} {d.name}
            </button>

            {d.type === "router" && <>
              <div className="tb-subtitle">Routing table</div>
              <MiniTable cols={["", "Network", "Next hop", "Interface"]} empty="No routes — configure interfaces and cable them"
                rows={routingTable(topo, d).map(r => ({
                  c:[r.type, `${numToIp(r.net)}/${r.prefix}`, r.via === null ? "direct" : numToIp(r.via), r.iface ?? "unreachable"],
                  cls: r.port === null ? "dead" : "",
                }))}/>
              <div className="tb-subtitle">ARP table</div>
              <MiniTable cols={["IP", "MAC", "Interface", "Ping"]} empty={EMPTY}
                rows={arpTableOf(tables, d.id).map(e => ({ c:[e.ip, e.mac, e.iface, `#${e.ping}`], cls:fresh(e) }))}/>
            </>}

            {d.type === "switch" && <>
              <div className="tb-subtitle">MAC address table</div>
              <MiniTable cols={["VLAN", "MAC", "Port", "Belongs to", "Ping"]} empty={EMPTY}
                rows={macTableOf(tables, d.id).map(e => ({ c:[e.vlan, e.mac, portName("switch", e.port), e.host, `#${e.ping}`], cls:fresh(e) }))}/>
              <div className="tb-subtitle">Ports in use</div>
              <MiniTable cols={["Port", "Mode", "VLAN", "Connected to"]} empty="Nothing cabled"
                rows={d.ports.map((p, i) => ({ p:switchPort(p), i })).filter(x => linkAt(topo, d.id, x.i)).map(({ p, i }) => ({
                  c:[portName("switch", i), p.mode === "trunk" ? "trunk" : "access",
                    p.mode === "trunk" ? (p.allowed.set ? [...p.allowed.set].join(",") : "all") : p.vlan,
                    portLabel(topo, otherEnd(linkAt(topo, d.id, i), d.id, i))],
                }))}/>
            </>}

            {d.type === "pc" && <>
              <dl className="tb-facts">
                <dt>IP</dt><dd>{d.ports[0].addr || "none"}</dd>
                <dt>Gateway</dt><dd>{d.gw || "none"}</dd>
                <dt>MAC</dt><dd>{macOf(d, 0)}</dd>
              </dl>
              <div className="tb-subtitle">ARP cache</div>
              <MiniTable cols={["IP", "MAC", "Ping"]} empty={EMPTY}
                rows={arpTableOf(tables, d.id).map(e => ({ c:[e.ip, e.mac, `#${e.ping}`], cls:fresh(e) }))}/>
            </>}
          </div>
        ))}
      </div>
    </>
  );
}

function LinkInspector({ l, topo, onDelete }) {
  return (
    <div className="tb-card">
      <div className="tb-card-title">🔌 Cable</div>
      <p className="tb-note">{portLabel(topo, l.a)} ↔ {portLabel(topo, l.b)}</p>
      <button className="tb-btn tb-danger" onClick={onDelete}>Remove cable</button>
    </div>
  );
}
