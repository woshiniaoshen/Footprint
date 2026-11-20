const INTERNAL = ["192.168.1.", "10.0.0.", "172.16.0."];
const EXTERNAL = ["45.33.32.", "185.220.101.", "198.51.100.", "203.0.113.", "91.108.4.", "77.88.55."];
const SERVICES = [
  { port: 22, name: "SSH", protocol: "TCP" },
  { port: 80, name: "HTTP", protocol: "TCP" },
  { port: 443, name: "HTTPS", protocol: "TCP" },
  { port: 3306, name: "MySQL", protocol: "TCP" },
  { port: 5432, name: "PostgreSQL", protocol: "TCP" },
  { port: 21, name: "FTP", protocol: "TCP" },
  { port: 53, name: "DNS", protocol: "UDP" },
  { port: 8080, name: "HTTP-Alt", protocol: "TCP" },
  { port: 445, name: "SMB", protocol: "TCP" },
  { port: 3389, name: "RDP", protocol: "TCP" },
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randIp(prefix) {
  return prefix + randInt(1, 254);
}

export function generateLogs(count = 600) {
  const logs = [];
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour window

  // --- attack scenario 1: port scan from one attacker ---
  const portScanIp = randIp(randItem(EXTERNAL));
  const targetIp = randIp(INTERNAL[0]);
  const scanStart = now - randInt(10, 50) * 60 * 1000;
  const scannedPorts = Array.from({ length: randInt(28, 45) }, (_, i) => 20 + i * randInt(1, 3));
  for (const port of scannedPorts) {
    logs.push({
      id: logs.length,
      timestamp: new Date(scanStart + logs.length * 800).toISOString(),
      src_ip: portScanIp,
      dst_ip: targetIp,
      port,
      protocol: "TCP",
      bytes: randInt(40, 80),
      flag: "SYN",
      service: "SCAN",
    });
  }

  // --- attack scenario 2: SSH brute force from another attacker ---
  const bruteIp = randIp(randItem(EXTERNAL));
  const sshTarget = randIp(INTERNAL[1]);
  const bruteStart = now - randInt(20, 55) * 60 * 1000;
  for (let i = 0; i < randInt(35, 60); i++) {
    logs.push({
      id: logs.length,
      timestamp: new Date(bruteStart + i * 2200).toISOString(),
      src_ip: bruteIp,
      dst_ip: sshTarget,
      port: 22,
      protocol: "TCP",
      bytes: randInt(80, 200),
      flag: "SYN",
      service: "SSH",
    });
  }

  // --- attack scenario 3: data exfiltration (large outbound) ---
  const exfilIp = randIp(INTERNAL[2]);
  const exfilDst = randIp(randItem(EXTERNAL));
  const exfilStart = now - randInt(5, 25) * 60 * 1000;
  for (let i = 0; i < randInt(8, 14); i++) {
    logs.push({
      id: logs.length,
      timestamp: new Date(exfilStart + i * 3000).toISOString(),
      src_ip: exfilIp,
      dst_ip: exfilDst,
      port: 443,
      protocol: "TCP",
      bytes: randInt(80000, 240000),
      flag: "ACK",
      service: "HTTPS",
    });
  }

  // --- fill remaining with normal traffic ---
  while (logs.length < count) {
    const svc = randItem(SERVICES);
    const inbound = Math.random() > 0.4;
    logs.push({
      id: logs.length,
      timestamp: new Date(now - randInt(0, windowMs)).toISOString(),
      src_ip: inbound ? randIp(randItem(EXTERNAL)) : randIp(randItem(INTERNAL)),
      dst_ip: inbound ? randIp(randItem(INTERNAL)) : randIp(randItem(EXTERNAL)),
      port: svc.port,
      protocol: svc.protocol,
      bytes: randInt(64, 8192),
      flag: randItem(["SYN", "ACK", "FIN", "PSH"]),
      service: svc.name,
    });
  }

  return logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function detectThreats(logs) {
  const threats = [];

  // port scan: same src hits 10+ distinct ports within 60s
  const byIp = new Map();
  for (const log of logs) {
    if (!byIp.has(log.src_ip)) byIp.set(log.src_ip, []);
    byIp.get(log.src_ip).push(log);
  }
  for (const [ip, entries] of byIp) {
    for (let i = 0; i < entries.length; i++) {
      const window = entries.filter(e =>
        Math.abs(new Date(e.timestamp) - new Date(entries[i].timestamp)) <= 60000
      );
      const ports = new Set(window.map(e => e.port));
      if (ports.size >= 10) {
        threats.push({
          type: "Port Scan",
          severity: "high",
          src_ip: ip,
          detail: `${ports.size} ports probed within 60 seconds`,
          timestamp: entries[i].timestamp,
          count: window.length,
        });
        break;
      }
    }
  }

  // brute force: 15+ connections to port 22 from same ip
  for (const [ip, entries] of byIp) {
    const ssh = entries.filter(e => e.port === 22 && e.flag === "SYN");
    if (ssh.length >= 15) {
      threats.push({
        type: "Brute Force",
        severity: "critical",
        src_ip: ip,
        detail: `${ssh.length} SSH SYN packets — credential stuffing likely`,
        timestamp: ssh[0].timestamp,
        count: ssh.length,
      });
    }
  }

  // data exfiltration: single src sends >500 KB total outbound
  for (const [ip, entries] of byIp) {
    const isInternal = ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.16.");
    if (!isInternal) continue;
    const totalBytes = entries.reduce((sum, e) => sum + (e.bytes || 0), 0);
    if (totalBytes > 500000) {
      threats.push({
        type: "Data Exfiltration",
        severity: "critical",
        src_ip: ip,
        detail: `${(totalBytes / 1024 / 1024).toFixed(1)} MB sent outbound`,
        timestamp: entries[0].timestamp,
        count: entries.length,
      });
    }
  }

  return threats.sort((a, b) => b.count - a.count);
}
