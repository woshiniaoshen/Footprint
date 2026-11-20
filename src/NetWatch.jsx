import { useState, useMemo } from "react";
import { generateLogs, detectThreats } from "./netwatch-logs.js";
import "./netwatch.css";

const SEVERITY_COLOR = { critical: "#E63946", high: "#F2C36B", medium: "#63B3ED", low: "#42D9B8" };

const THREAT_INFO = {
  "Port Scan": {
    icon: "🔍",
    what: "An attacker probes many ports on a target machine in rapid succession.",
    why: "Attackers do this to discover which services are running (e.g. SSH on port 22, database on port 3306) before choosing how to break in.",
    detect: "Flagged when one IP hits 10+ different ports within 60 seconds.",
  },
  "Brute Force": {
    icon: "🔑",
    what: "An attacker repeatedly tries different passwords to log into a service.",
    why: "If the password is weak or common (like 'password123'), automated tools can guess it in seconds.",
    detect: "Flagged when one IP sends 15+ connection attempts to SSH (port 22).",
  },
  "Data Exfiltration": {
    icon: "📤",
    what: "A machine inside the network sends an unusually large amount of data outward.",
    why: "This can indicate a breach where stolen files, credentials, or databases are being sent to an attacker's server.",
    detect: "Flagged when an internal IP sends more than 500 KB in total outbound traffic.",
  },
};

const HOW_IT_WORKS = [
  {
    title: "What is this?",
    body: "NetWatch is a network intrusion detection dashboard. It monitors network traffic logs, applies detection rules, and surfaces suspicious activity — the same concept used by real security tools like Splunk and Elastic SIEM.",
  },
  {
    title: "Is this real traffic?",
    body: "No — all 600 events are simulated. The logs are generated fresh each page load and include three realistic attack scenarios (port scan, SSH brute force, data exfiltration) mixed in with normal background traffic.",
  },
  {
    title: "How does detection work?",
    body: "The dashboard scans every log entry and applies three rules: too many ports from one IP = port scan; too many SSH attempts = brute force; too many bytes sent outbound = exfiltration. Rows from flagged IPs turn red in the event table.",
  },
  {
    title: "What do the charts show?",
    body: "Traffic Volume shows how many events occurred in each 5-minute window over the last hour. Protocol Split shows the ratio of TCP vs UDP traffic. Top Source IPs ranks which addresses generated the most activity — attackers tend to dominate this list.",
  },
  {
    title: "What is TCP/UDP/SYN/ACK?",
    body: "TCP and UDP are transport protocols. TCP (used for SSH, HTTP, databases) is reliable and connection-based. UDP (used for DNS) is faster but connectionless. SYN is the first packet in a TCP connection — a flood of SYNs without replies is a classic scan or attack signal. ACK means the connection was established.",
  },
];

function Badge({ severity }) {
  return (
    <span className="nw-badge" style={{ background: SEVERITY_COLOR[severity] + "22", color: SEVERITY_COLOR[severity], border: `1px solid ${SEVERITY_COLOR[severity]}55` }}>
      {severity}
    </span>
  );
}

function InfoPopover({ info }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="nw-info-wrap">
      <button className="nw-info-btn" onClick={() => setOpen(v => !v)} aria-label="What is this attack?">?</button>
      {open && (
        <div className="nw-info-popover">
          <button className="nw-info-close" onClick={() => setOpen(false)}>✕</button>
          <div className="nw-info-row"><span className="nw-info-icon">{info.icon}</span><strong>What is it?</strong></div>
          <p>{info.what}</p>
          <strong>Why do attackers do this?</strong>
          <p>{info.why}</p>
          <strong>How was it detected?</strong>
          <p className="nw-info-detect">{info.detect}</p>
        </div>
      )}
    </span>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  return (
    <div className="nw-how-wrap">
      <button className="nw-how-toggle" onClick={() => setOpen(v => !v)}>
        <span>📖 How this dashboard works</span>
        <span className="nw-how-arrow">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="nw-how-body">
          <div className="nw-how-tabs">
            {HOW_IT_WORKS.map((item, i) => (
              <button key={i} className={`nw-how-tab ${active === i ? "active" : ""}`} onClick={() => setActive(i)}>
                {item.title}
              </button>
            ))}
          </div>
          <div className="nw-how-content">
            <h3>{HOW_IT_WORKS[active].title}</h3>
            <p>{HOW_IT_WORKS[active].body}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="nw-stat">
      <div className="nw-stat-value" style={accent ? { color: accent } : {}}>{value}</div>
      <div className="nw-stat-label">{label}</div>
      {sub && <div className="nw-stat-sub">{sub}</div>}
    </div>
  );
}

function MiniBar({ data, maxVal, color }) {
  return (
    <div className="nw-minibar-track">
      {data.map((d, i) => (
        <div key={i} className="nw-minibar-col" title={`${d.label}: ${d.count}`}>
          <div className="nw-minibar-fill" style={{ height: `${maxVal > 0 ? (d.count / maxVal) * 100 : 0}%`, background: color }} />
        </div>
      ))}
    </div>
  );
}

function TopIps({ logs }) {
  const counts = useMemo(() => {
    const map = new Map();
    for (const log of logs) map.set(log.src_ip, (map.get(log.src_ip) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [logs]);
  const max = counts[0]?.[1] || 1;
  return (
    <div className="nw-topips">
      {counts.map(([ip, count]) => (
        <div key={ip} className="nw-topip-row">
          <span className="nw-topip-label">{ip}</span>
          <div className="nw-topip-bar-track">
            <div className="nw-topip-bar-fill" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="nw-topip-count">{count}</span>
        </div>
      ))}
    </div>
  );
}

function ProtocolPie({ logs }) {
  const counts = useMemo(() => {
    const map = new Map();
    for (const log of logs) map.set(log.protocol, (map.get(log.protocol) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [logs]);
  const total = counts.reduce((s, [, c]) => s + c, 0);
  const COLORS = ["#42D9B8", "#63B3ED", "#F2C36B", "#E63946", "#A78BFA"];
  let cumulative = 0;
  const slices = counts.map(([label, count], i) => {
    const pct = count / total;
    const start = cumulative;
    cumulative += pct;
    return { label, count, pct, start, color: COLORS[i % COLORS.length] };
  });
  return (
    <div className="nw-pie-wrap">
      <svg viewBox="0 0 36 36" className="nw-pie-svg">
        {slices.map((s, i) => {
          const startAngle = s.start * 2 * Math.PI - Math.PI / 2;
          const endAngle = (s.start + s.pct) * 2 * Math.PI - Math.PI / 2;
          const r = 15.9155;
          const x1 = 18 + r * Math.cos(startAngle);
          const y1 = 18 + r * Math.sin(startAngle);
          const x2 = 18 + r * Math.cos(endAngle);
          const y2 = 18 + r * Math.sin(endAngle);
          const largeArc = s.pct > 0.5 ? 1 : 0;
          return (
            <path key={i}
              d={`M18 18 L${x1} ${y1} A${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
              fill={s.color} opacity="0.85"
            />
          );
        })}
        <circle cx="18" cy="18" r="10" fill="#111827" />
      </svg>
      <div className="nw-pie-legend">
        {slices.map((s, i) => (
          <div key={i} className="nw-pie-legend-row">
            <span className="nw-pie-dot" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span className="nw-pie-pct">{(s.pct * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NetWatch() {
  const [logs] = useState(() => generateLogs(600));
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const threats = useMemo(() => detectThreats(logs), [logs]);

  const hourBuckets = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, i) => ({ label: `${i * 5}m`, count: 0 }));
    const now = Date.now();
    for (const log of logs) {
      const ageMin = (now - new Date(log.timestamp).getTime()) / 60000;
      const idx = Math.min(11, Math.floor(ageMin / 5));
      buckets[11 - idx].count++;
    }
    return buckets;
  }, [logs]);

  const maxBucket = Math.max(...hourBuckets.map(b => b.count), 1);

  const filtered = useMemo(() => {
    const src = filter === "all" ? logs : logs.filter(l => l.service === filter || l.protocol === filter);
    return [...src].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [logs, filter]);

  const services = useMemo(() => {
    const s = new Set(logs.map(l => l.service));
    return ["all", ...s];
  }, [logs]);

  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const criticalCount = threats.filter(t => t.severity === "critical").length;
  const highCount = threats.filter(t => t.severity === "high").length;
  const uniqueIps = new Set(logs.map(l => l.src_ip)).size;
  const totalBytes = logs.reduce((s, l) => s + (l.bytes || 0), 0);

  return (
    <div className="nw-shell">
      <header className="nw-header">
        <div className="nw-header-brand">
          <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="14" fill="#111827" />
            <circle cx="32" cy="32" r="18" stroke="#42D9B8" strokeWidth="3" fill="none" />
            <circle cx="32" cy="32" r="10" stroke="#63B3ED" strokeWidth="2" fill="none" />
            <circle cx="32" cy="32" r="3" fill="#E63946" />
            <line x1="32" y1="6" x2="32" y2="14" stroke="#42D9B8" strokeWidth="2" strokeLinecap="round" />
            <line x1="32" y1="50" x2="32" y2="58" stroke="#42D9B8" strokeWidth="2" strokeLinecap="round" />
            <line x1="6" y1="32" x2="14" y2="32" stroke="#42D9B8" strokeWidth="2" strokeLinecap="round" />
            <line x1="50" y1="32" x2="58" y2="32" stroke="#42D9B8" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <div>
            <h1>NetWatch</h1>
            <p>Network Intrusion Dashboard</p>
          </div>
        </div>
        <div className="nw-header-meta">
          <span className={`nw-pulse ${criticalCount > 0 ? "nw-pulse-red" : "nw-pulse-green"}`} />
          <span>{criticalCount > 0 ? `${criticalCount} critical threat${criticalCount > 1 ? "s" : ""} detected` : "No critical threats"}</span>
          <a href="/" className="nw-back">← Portfolio</a>
        </div>
      </header>

      <main className="nw-main">
        {/* Intro banner */}
        <div className="nw-intro">
          <div className="nw-intro-text">
            <strong>What you're looking at:</strong> a live-updating network security dashboard that simulates 60 minutes of network traffic, automatically detects attacks, and flags suspicious IPs — the same concept used in real SIEM tools.
            <span className="nw-sim-tag">Simulated data</span>
          </div>
        </div>

        <HowItWorks />

        {/* Stats row */}
        <div className="nw-stats-row">
          <StatCard label="Total Events" value={logs.length.toLocaleString()} sub="last 60 min" />
          <StatCard label="Unique Source IPs" value={uniqueIps} />
          <StatCard label="Threats Detected" value={threats.length} accent={threats.length > 0 ? "#E63946" : "#42D9B8"} sub={`${criticalCount} critical · ${highCount} high`} />
          <StatCard label="Data Transferred" value={`${(totalBytes / 1024 / 1024).toFixed(1)} MB`} />
        </div>

        {/* Alerts */}
        {threats.length > 0 && (
          <section className="nw-section">
            <h2 className="nw-section-title">Active Threats</h2>
            <div className="nw-alerts">
              {threats.map((t, i) => (
                <div key={i} className="nw-alert" style={{ borderColor: SEVERITY_COLOR[t.severity] + "55" }}>
                  <div className="nw-alert-top">
                    <span className="nw-alert-type">{t.type}</span>
                    <Badge severity={t.severity} />
                    {THREAT_INFO[t.type] && <InfoPopover info={THREAT_INFO[t.type]} />}
                    <span className="nw-alert-ip">{t.src_ip}</span>
                  </div>
                  <div className="nw-alert-detail">{t.detail}</div>
                  <div className="nw-alert-time">{new Date(t.timestamp).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Charts row */}
        <div className="nw-charts-row">
          <section className="nw-section nw-section-flex">
            <h2 className="nw-section-title">Traffic Volume <span className="nw-section-hint">— events per 5-min window</span></h2>
            <MiniBar data={hourBuckets} maxVal={maxBucket} color="#42D9B8" />
            <div className="nw-chart-axis">
              <span>60 min ago</span>
              <span>now</span>
            </div>
          </section>
          <section className="nw-section">
            <h2 className="nw-section-title">Protocol Split</h2>
            <ProtocolPie logs={logs} />
          </section>
          <section className="nw-section">
            <h2 className="nw-section-title">Top Source IPs</h2>
            <TopIps logs={logs} />
          </section>
        </div>

        {/* Event log */}
        <section className="nw-section">
          <div className="nw-log-header">
            <div>
              <h2 className="nw-section-title" style={{ margin: 0 }}>Event Log</h2>
              <p className="nw-log-hint">Every network connection in the last hour. <span className="nw-hint-red">Red rows</span> = source IP flagged as a threat.</p>
            </div>
            <div className="nw-filters">
              {services.map(s => (
                <button key={s} onClick={() => { setFilter(s); setPage(0); }} className={`nw-filter-btn ${filter === s ? "active" : ""}`}>
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>
          </div>
          <div className="nw-table-wrap">
            <table className="nw-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source IP</th>
                  <th>Destination IP</th>
                  <th>Port</th>
                  <th>Protocol</th>
                  <th>Service</th>
                  <th>Bytes</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice.map(log => {
                  const isSuspect = threats.some(t => t.src_ip === log.src_ip);
                  return (
                    <tr key={log.id} className={isSuspect ? "nw-row-suspect" : ""}>
                      <td className="nw-mono">{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td className="nw-mono">{log.src_ip}</td>
                      <td className="nw-mono">{log.dst_ip}</td>
                      <td className="nw-mono">{log.port}</td>
                      <td>{log.protocol}</td>
                      <td>{log.service}</td>
                      <td className="nw-mono">{log.bytes?.toLocaleString()}</td>
                      <td><span className="nw-flag">{log.flag}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="nw-pagination">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="nw-page-btn">← Prev</button>
            <span>Page {page + 1} of {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="nw-page-btn">Next →</button>
          </div>
        </section>
      </main>

      <footer className="nw-footer">
        <span>NetWatch · Simulated traffic data · Built by Nelson Tan</span>
        <a href="https://github.com/woshiniaoshen" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}
