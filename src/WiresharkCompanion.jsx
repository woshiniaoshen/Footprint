import { useState, useMemo, useRef, useCallback } from "react";
import { parseFile, summariseCapture } from "./pcap-parser.js";
import { detectThreats } from "./netwatch-logs.js";
import NetworkGraph from "./NetworkGraph.jsx";
import "./wireshark.css";

const PROTO_COLORS = {
  TCP: "#63B3ED", UDP: "#42D9B8", ICMP: "#F2C36B",
  DNS: "#A78BFA", HTTP: "#F45F43", HTTPS: "#F45F43",
  Unknown: "rgba(255,255,255,0.3)",
};

function protoColor(p) { return PROTO_COLORS[p] || "#63B3ED"; }

function StatCard({ label, value, sub }) {
  return (
    <div className="ws-stat">
      <div className="ws-stat-value">{value}</div>
      <div className="ws-stat-label">{label}</div>
      {sub && <div className="ws-stat-sub">{sub}</div>}
    </div>
  );
}

function ProtocolBar({ packets }) {
  const counts = useMemo(() => {
    const map = new Map();
    for (const p of packets) map.set(p.protocol, (map.get(p.protocol) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [packets]);
  const total = packets.length || 1;
  return (
    <div className="ws-proto-bar-wrap">
      <div className="ws-proto-bar">
        {counts.map(([proto, count]) => (
          <div key={proto} className="ws-proto-segment" style={{ width: `${(count / total) * 100}%`, background: protoColor(proto) }} title={`${proto}: ${count} packets`} />
        ))}
      </div>
      <div className="ws-proto-legend">
        {counts.map(([proto, count]) => (
          <div key={proto} className="ws-proto-legend-row">
            <span className="ws-proto-dot" style={{ background: protoColor(proto) }} />
            <span>{proto}</span>
            <span className="ws-proto-pct">{((count / total) * 100).toFixed(1)}%</span>
            <span className="ws-proto-count">{count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopIps({ packets }) {
  const counts = useMemo(() => {
    const map = new Map();
    for (const p of packets) {
      if (p.src_ip !== "—") map.set(p.src_ip, (map.get(p.src_ip) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [packets]);
  const max = counts[0]?.[1] || 1;
  return (
    <div className="ws-topips">
      {counts.map(([ip, count]) => (
        <div key={ip} className="ws-topip-row">
          <span className="ws-topip-label">{ip}</span>
          <div className="ws-topip-track">
            <div className="ws-topip-fill" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="ws-topip-count">{count}</span>
        </div>
      ))}
    </div>
  );
}

function Timeline({ packets }) {
  const buckets = useMemo(() => {
    if (!packets.length) return [];
    const times = packets.map(p => new Date(p.timestamp).getTime()).filter(Number.isFinite);
    if (!times.length) return [];
    const min = Math.min(...times);
    const max = Math.max(...times);
    const range = max - min || 1;
    const NUM = 24;
    const counts = Array(NUM).fill(0);
    for (const t of times) {
      const idx = Math.min(NUM - 1, Math.floor(((t - min) / range) * NUM));
      counts[idx]++;
    }
    const dur = Math.round(range / 1000);
    return counts.map((count, i) => ({
      count,
      label: dur < 60
        ? `${Math.round((i / NUM) * dur)}s`
        : `${Math.round((i / NUM) * dur / 60)}m`,
    }));
  }, [packets]);
  const maxVal = Math.max(...buckets.map(b => b.count), 1);
  return (
    <div className="ws-timeline">
      {buckets.map((b, i) => (
        <div key={i} className="ws-tl-col" title={`${b.label}: ${b.count} packets`}>
          <div className="ws-tl-fill" style={{ height: `${(b.count / maxVal) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function PacketTable({ packets, threats }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE = 25;

  const suspectIps = useMemo(() => new Set(threats.map(t => t.src_ip)), [threats]);

  const protocols = useMemo(() => {
    const s = new Set(packets.map(p => p.protocol).filter(Boolean));
    return ["all", ...s];
  }, [packets]);

  const filtered = useMemo(() => {
    return filter === "all" ? packets : packets.filter(p => p.protocol === filter);
  }, [packets, filter]);

  const slice = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const totalPages = Math.ceil(filtered.length / PAGE);

  return (
    <div>
      <div className="ws-table-header">
        <div>
          <h2 className="ws-section-title" style={{ margin: 0 }}>Packet Log</h2>
          <p className="ws-table-hint">
            {filtered.length.toLocaleString()} packets
            {suspectIps.size > 0 && <> · <span className="ws-hint-red">Red rows</span> = flagged source IP</>}
          </p>
        </div>
        <div className="ws-filters">
          {protocols.map(p => (
            <button key={p} onClick={() => { setFilter(p); setPage(0); }} className={`ws-filter-btn ${filter === p ? "active" : ""}`}>
              {p === "all" ? "All" : p}
            </button>
          ))}
        </div>
      </div>
      <div className="ws-table-wrap">
        <table className="ws-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Source IP</th>
              <th>Destination IP</th>
              <th>Protocol</th>
              <th>Service</th>
              <th>Src Port</th>
              <th>Dst Port</th>
              <th>Flags</th>
              <th>Bytes</th>
            </tr>
          </thead>
          <tbody>
            {slice.map(p => (
              <tr key={p.id} className={suspectIps.has(p.src_ip) ? "ws-row-suspect" : ""}>
                <td className="ws-mono ws-muted">{p.id + 1}</td>
                <td className="ws-mono">{new Date(p.timestamp).toISOString().slice(11, 23)}</td>
                <td className="ws-mono">{p.src_ip}</td>
                <td className="ws-mono">{p.dst_ip}</td>
                <td><span className="ws-proto-tag" style={{ color: protoColor(p.protocol), borderColor: protoColor(p.protocol) + "55" }}>{p.protocol}</span></td>
                <td>{p.service || "—"}</td>
                <td className="ws-mono ws-muted">{p.src_port ?? "—"}</td>
                <td className="ws-mono ws-muted">{p.dst_port ?? "—"}</td>
                <td className="ws-mono">{p.flags || "—"}</td>
                <td className="ws-mono ws-muted">{p.bytes?.toLocaleString() ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ws-pagination">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="ws-page-btn">← Prev</button>
        <span>Page {page + 1} of {totalPages || 1}</span>
        <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="ws-page-btn">Next →</button>
      </div>
    </div>
  );
}

function DropZone({ onFile }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div
      className={`ws-drop ${dragging ? "ws-drop-active" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
    >
      <input ref={inputRef} type="file" accept=".pcap,.pcapng,.ntar" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
      <div className="ws-drop-icon">📡</div>
      <p className="ws-drop-title">Drop a capture file here</p>
      <p className="ws-drop-sub">Supports <strong>.pcap</strong> and <strong>.pcapng</strong> · Parsed locally, nothing is uploaded</p>
      <div className="ws-drop-samples">
        <span>Try your lab files:</span>
        <code>dns-wireshark-trace1-1.pcapng</code>
        <code>tcp-wireshark-trace1-1.pcapng</code>
        <code>http-wireshark-trace1-1.pcapng</code>
      </div>
    </div>
  );
}

export default function WiresharkCompanion() {
  const [packets, setPackets] = useState(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("dashboard");

  const threats = useMemo(() => packets ? detectThreats(packets) : [], [packets]);
  const summary = useMemo(() => packets ? summariseCapture(packets) : "", [packets]);

  const totalBytes = useMemo(() => packets ? packets.reduce((s, p) => s + (p.bytes || 0), 0) : 0, [packets]);
  const uniqueIps = useMemo(() => packets ? new Set([...packets.map(p => p.src_ip), ...packets.map(p => p.dst_ip)].filter(ip => ip !== "—")).size : 0, [packets]);
  const duration = useMemo(() => {
    if (!packets?.length) return "—";
    const times = packets.map(p => new Date(p.timestamp).getTime()).filter(Number.isFinite);
    if (times.length < 2) return "—";
    const secs = Math.round((Math.max(...times) - Math.min(...times)) / 1000);
    return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }, [packets]);

  const handleFile = async (file) => {
    setError("");
    setLoading(true);
    setPackets(null);
    setFileName(file.name);
    try {
      const result = await parseFile(file);
      setPackets(result);
    } catch (err) {
      setError(err.message || "Failed to parse file");
    }
    setLoading(false);
  };

  return (
    <div className="ws-shell">
      <header className="ws-header">
        <div className="ws-header-brand">
          <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="14" fill="#111827" />
            <rect x="10" y="20" width="44" height="6" rx="3" fill="#42D9B8" opacity="0.9" />
            <rect x="10" y="30" width="30" height="6" rx="3" fill="#63B3ED" opacity="0.8" />
            <rect x="10" y="40" width="38" height="6" rx="3" fill="#F2C36B" opacity="0.8" />
            <circle cx="50" cy="23" r="4" fill="#42D9B8" />
            <circle cx="36" cy="33" r="4" fill="#63B3ED" />
            <circle cx="44" cy="43" r="4" fill="#F2C36B" />
          </svg>
          <div>
            <h1>Wireshark Companion</h1>
            <p>Packet Capture Analyser</p>
          </div>
        </div>
        <div className="ws-header-right">
          {packets && (
            <button className="ws-reset-btn" onClick={() => { setPackets(null); setFileName(""); }}>
              ← New file
            </button>
          )}
          <a href="/" className="ws-back">← Portfolio</a>
        </div>
      </header>

      <main className="ws-main">
        {!packets && !loading && (
          <>
            <div className="ws-intro">
              <strong>What is this?</strong> Upload any <code>.pcap</code> or <code>.pcapng</code> file and this tool parses the binary data directly in your browser — no server, no upload. It shows every packet, the protocols used, top IP addresses, a traffic timeline, and flags suspicious patterns like port scans or brute-force attempts.
            </div>
            <DropZone onFile={handleFile} />
            {error && <div className="ws-error">{error}</div>}
          </>
        )}

        {loading && (
          <div className="ws-loading">
            <div className="ws-spinner" />
            <p>Parsing {fileName}…</p>
          </div>
        )}

        {packets && (
          <>
            <div className="ws-file-banner">
              <span className="ws-file-icon">📁</span>
              <div>
                <strong>{fileName}</strong>
                <p className="ws-summary-text">{summary}</p>
              </div>
            </div>

            <div className="ws-tabs">
              <button className={`ws-tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
                📊 Dashboard
              </button>
              <button className={`ws-tab ${tab === "network" ? "active" : ""}`} onClick={() => setTab("network")}>
                🕸 Network Map
              </button>
            </div>

            {tab === "dashboard" && (
              <>
                <div className="ws-stats-row">
                  <StatCard label="Total Packets" value={packets.length.toLocaleString()} />
                  <StatCard label="Unique IPs" value={uniqueIps} />
                  <StatCard label="Duration" value={duration} />
                  <StatCard label="Data Captured" value={totalBytes > 1048576 ? `${(totalBytes / 1048576).toFixed(1)} MB` : `${(totalBytes / 1024).toFixed(0)} KB`} />
                  <StatCard label="Threats Found" value={threats.length} sub={threats.length > 0 ? threats.map(t => t.type).join(", ") : "none"} />
                </div>

                {threats.length > 0 && (
                  <section className="ws-section">
                    <h2 className="ws-section-title">Threats Detected</h2>
                    <div className="ws-alerts">
                      {threats.map((t, i) => (
                        <div key={i} className="ws-alert">
                          <div className="ws-alert-top">
                            <span className="ws-alert-type">{t.type}</span>
                            <span className="ws-alert-sev" data-sev={t.severity}>{t.severity}</span>
                            <span className="ws-alert-ip">{t.src_ip}</span>
                          </div>
                          <p className="ws-alert-detail">{t.detail}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <div className="ws-charts-row">
                  <section className="ws-section ws-section-flex">
                    <h2 className="ws-section-title">Traffic Timeline <span className="ws-section-hint">— packets over time</span></h2>
                    <Timeline packets={packets} />
                    <div className="ws-tl-axis"><span>start</span><span>end</span></div>
                  </section>
                  <section className="ws-section">
                    <h2 className="ws-section-title">Protocol Breakdown</h2>
                    <ProtocolBar packets={packets} />
                  </section>
                </div>

                <div className="ws-charts-row ws-charts-row-single">
                  <section className="ws-section">
                    <h2 className="ws-section-title">Top Source IPs</h2>
                    <TopIps packets={packets} />
                  </section>
                </div>

                <section className="ws-section">
                  <PacketTable packets={packets} threats={threats} />
                </section>
              </>
            )}

            {tab === "network" && (
              <section className="ws-section ws-section-graph">
                <h2 className="ws-section-title">Network Flow Map <span className="ws-section-hint">— nodes = IPs · dots = live packet flow · arrows = direction</span></h2>
                <NetworkGraph packets={packets} />
              </section>
            )}
          </>
        )}
      </main>

      <footer className="ws-footer">
        <span>Wireshark Companion · Parsed locally in your browser · Built by Nelson Tan</span>
        <a href="https://github.com/woshiniaoshen" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}
