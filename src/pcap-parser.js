// ─── Binary parser for .pcap and .pcapng files ───
// Runs entirely in the browser using FileReader + DataView, no libraries needed.

const PROTO_NAMES = { 1: "ICMP", 6: "TCP", 17: "UDP", 2: "IGMP", 58: "ICMPv6" };
const PORT_SERVICES = {
  20: "FTP-data", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP",
  53: "DNS", 67: "DHCP", 68: "DHCP", 80: "HTTP", 110: "POP3",
  143: "IMAP", 443: "HTTPS", 445: "SMB", 3306: "MySQL",
  3389: "RDP", 5432: "PostgreSQL", 8080: "HTTP-Alt", 8443: "HTTPS-Alt",
};

function ipFromBytes(dv, offset) {
  return `${dv.getUint8(offset)}.${dv.getUint8(offset+1)}.${dv.getUint8(offset+2)}.${dv.getUint8(offset+3)}`;
}

function guessService(port) {
  return PORT_SERVICES[port] || null;
}

// Parse raw Ethernet frame → extract IP/TCP/UDP fields
function parseEthernetFrame(dv, offset, length) {
  if (length < 14) return null;
  const ethertype = dv.getUint16(offset + 12, false); // big-endian

  // Handle 802.1Q VLAN tag
  const ipOffset = ethertype === 0x8100 ? offset + 18 : offset + 14;
  const effectiveEthertype = ethertype === 0x8100 ? dv.getUint16(offset + 16, false) : ethertype;

  if (effectiveEthertype !== 0x0800) return null; // only IPv4

  if (ipOffset + 20 > offset + length) return null;
  const ihl = (dv.getUint8(ipOffset) & 0x0f) * 4;
  const proto = dv.getUint8(ipOffset + 9);
  const srcIp = ipFromBytes(dv, ipOffset + 12);
  const dstIp = ipFromBytes(dv, ipOffset + 16);
  const totalLen = dv.getUint16(ipOffset + 2, false);

  const transportOffset = ipOffset + ihl;
  let srcPort = null, dstPort = null, flags = null;

  if (proto === 6 && transportOffset + 14 <= offset + length) {
    // TCP
    srcPort = dv.getUint16(transportOffset, false);
    dstPort = dv.getUint16(transportOffset + 2, false);
    const flagByte = dv.getUint8(transportOffset + 13);
    const f = [];
    if (flagByte & 0x02) f.push("SYN");
    if (flagByte & 0x10) f.push("ACK");
    if (flagByte & 0x01) f.push("FIN");
    if (flagByte & 0x04) f.push("RST");
    if (flagByte & 0x08) f.push("PSH");
    flags = f.join("+") || "—";
  } else if (proto === 17 && transportOffset + 8 <= offset + length) {
    // UDP
    srcPort = dv.getUint16(transportOffset, false);
    dstPort = dv.getUint16(transportOffset + 2, false);
    flags = "—";
  }

  const service = guessService(dstPort) || guessService(srcPort) || PROTO_NAMES[proto] || "Other";

  return {
    src_ip: srcIp,
    dst_ip: dstIp,
    protocol: PROTO_NAMES[proto] || `Proto ${proto}`,
    src_port: srcPort,
    dst_port: dstPort,
    port: dstPort || srcPort,
    service,
    flags,
    bytes: totalLen,
  };
}

// ─── .pcap parser ───
function parsePcap(buffer) {
  const dv = new DataView(buffer);
  const magic = dv.getUint32(0, true);

  // 0xa1b2c3d4 = little-endian, 0xd4c3b2a1 = big-endian
  if (magic !== 0xa1b2c3d4 && magic !== 0xd4c3b2a1) {
    throw new Error("Not a valid .pcap file (bad magic number)");
  }
  const le = magic === 0xa1b2c3d4;
  const linkType = dv.getUint32(20, le);

  const packets = [];
  let offset = 24; // skip global header

  while (offset + 16 <= buffer.byteLength) {
    const tsSec = dv.getUint32(offset, le);
    const tsUsec = dv.getUint32(offset + 4, le);
    const inclLen = dv.getUint32(offset + 8, le);
    const origLen = dv.getUint32(offset + 12, le);
    offset += 16;

    if (offset + inclLen > buffer.byteLength) break;

    const timestamp = new Date((tsSec * 1000) + Math.floor(tsUsec / 1000)).toISOString();
    let parsed = null;

    if (linkType === 1) {
      // Ethernet
      parsed = parseEthernetFrame(dv, offset, inclLen);
    } else if (linkType === 101) {
      // Raw IP (no ethernet header)
      parsed = parseRawIp(dv, offset, inclLen);
    }

    if (parsed) {
      packets.push({ id: packets.length, timestamp, bytes: origLen, ...parsed });
    } else {
      packets.push({ id: packets.length, timestamp, bytes: origLen, src_ip: "—", dst_ip: "—", protocol: "Unknown", service: "Unknown", flags: "—", port: null });
    }

    offset += inclLen;
  }

  return packets;
}

function parseRawIp(dv, offset, length) {
  if (length < 20) return null;
  const ihl = (dv.getUint8(offset) & 0x0f) * 4;
  const proto = dv.getUint8(offset + 9);
  const srcIp = ipFromBytes(dv, offset + 12);
  const dstIp = ipFromBytes(dv, offset + 16);
  const totalLen = dv.getUint16(offset + 2, false);
  const transportOffset = offset + ihl;
  let srcPort = null, dstPort = null, flags = null;

  if (proto === 6 && transportOffset + 14 <= offset + length) {
    srcPort = dv.getUint16(transportOffset, false);
    dstPort = dv.getUint16(transportOffset + 2, false);
    const flagByte = dv.getUint8(transportOffset + 13);
    const f = [];
    if (flagByte & 0x02) f.push("SYN");
    if (flagByte & 0x10) f.push("ACK");
    if (flagByte & 0x01) f.push("FIN");
    if (flagByte & 0x04) f.push("RST");
    flags = f.join("+") || "—";
  } else if (proto === 17 && transportOffset + 8 <= offset + length) {
    srcPort = dv.getUint16(transportOffset, false);
    dstPort = dv.getUint16(transportOffset + 2, false);
    flags = "—";
  }

  const service = guessService(dstPort) || guessService(srcPort) || PROTO_NAMES[proto] || "Other";
  return { src_ip: srcIp, dst_ip: dstIp, protocol: PROTO_NAMES[proto] || `Proto ${proto}`, src_port: srcPort, dst_port: dstPort, port: dstPort || srcPort, service, flags, bytes: totalLen };
}

// ─── .pcapng parser ───
function parsePcapng(buffer) {
  const dv = new DataView(buffer);

  // First block must be Section Header Block
  const firstType = dv.getUint32(0, true);
  if (firstType !== 0x0a0d0d0a) throw new Error("Not a valid .pcapng file");

  // Detect byte order from byte-order magic inside SHB
  const boMagic = dv.getUint32(8, true);
  const le = boMagic === 0x1a2b3c4d;

  const packets = [];
  let offset = 0;
  // Track interface link types (IDB blocks set these)
  const ifLinkTypes = [];

  while (offset + 12 <= buffer.byteLength) {
    const blockType = dv.getUint32(offset, le);
    const blockLen = dv.getUint32(offset + 4, le);
    if (blockLen < 12 || offset + blockLen > buffer.byteLength) break;

    // Interface Description Block
    if (blockType === 0x00000001) {
      const linkType = dv.getUint16(offset + 8, le);
      ifLinkTypes.push(linkType);
    }

    // Enhanced Packet Block
    if (blockType === 0x00000006) {
      const ifId = dv.getUint32(offset + 8, le);
      const tsHigh = dv.getUint32(offset + 12, le);
      const tsLow = dv.getUint32(offset + 16, le);
      const capturedLen = dv.getUint32(offset + 20, le);
      const origLen = dv.getUint32(offset + 24, le);
      const dataOffset = offset + 28;

      // Reconstruct 64-bit timestamp in microseconds
      const tsUs = tsHigh * 4294967296 + tsLow;
      const timestamp = new Date(Math.floor(tsUs / 1000)).toISOString();

      const linkType = ifLinkTypes[ifId] ?? ifLinkTypes[0] ?? 1;
      let parsed = null;

      if (linkType === 1 && dataOffset + capturedLen <= buffer.byteLength) {
        parsed = parseEthernetFrame(dv, dataOffset, capturedLen);
      } else if (linkType === 101 && dataOffset + capturedLen <= buffer.byteLength) {
        parsed = parseRawIp(dv, dataOffset, capturedLen);
      }

      if (parsed) {
        packets.push({ id: packets.length, timestamp, bytes: origLen, ...parsed });
      } else {
        packets.push({ id: packets.length, timestamp, bytes: origLen, src_ip: "—", dst_ip: "—", protocol: "Unknown", service: "Unknown", flags: "—", port: null });
      }
    }

    // Simple Packet Block (older format)
    if (blockType === 0x00000003) {
      const origLen = dv.getUint32(offset + 8, le);
      const capturedLen = Math.min(origLen, blockLen - 16);
      const dataOffset = offset + 12;
      const linkType = ifLinkTypes[0] ?? 1;
      let parsed = null;

      if (linkType === 1) parsed = parseEthernetFrame(dv, dataOffset, capturedLen);
      packets.push({ id: packets.length, timestamp: new Date().toISOString(), bytes: origLen, ...(parsed || { src_ip: "—", dst_ip: "—", protocol: "Unknown", service: "Unknown", flags: "—", port: null }) });
    }

    offset += blockLen;
  }

  return packets;
}

// ─── Main export ───
export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const name = file.name.toLowerCase();
        let packets;
        if (name.endsWith(".pcapng") || name.endsWith(".ntar")) {
          packets = parsePcapng(buffer);
        } else {
          packets = parsePcap(buffer);
        }
        resolve(packets);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Summarise what a capture is about ───
export function summariseCapture(packets) {
  if (!packets.length) return "Empty capture — no packets found.";

  const protos = new Map();
  for (const p of packets) protos.set(p.protocol, (protos.get(p.protocol) || 0) + 1);

  const topProto = [...protos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const services = new Set(packets.map(p => p.service).filter(s => s && s !== "Unknown" && s !== "Other"));
  const hasHTTP = services.has("HTTP") || services.has("HTTPS");
  const hasDNS = services.has("DNS");
  const hasSSH = services.has("SSH");
  const hasDHCP = services.has("DHCP");
  const hasTCP = topProto === "TCP";

  const parts = [];
  const duration = (() => {
    const times = packets.map(p => new Date(p.timestamp).getTime()).filter(Number.isFinite);
    if (times.length < 2) return null;
    const secs = Math.round((Math.max(...times) - Math.min(...times)) / 1000);
    return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m ${secs % 60}s`;
  })();

  if (hasDNS && hasHTTP) parts.push("a browser session — DNS lookups followed by HTTP/HTTPS connections");
  else if (hasDNS) parts.push("DNS traffic — domain name lookups");
  else if (hasHTTP) parts.push("web traffic (HTTP/HTTPS)");
  else if (hasSSH) parts.push("SSH remote access session");
  else if (hasDHCP) parts.push("DHCP address assignment — a device joining a network");
  else if (hasTCP) parts.push("TCP connections");
  else parts.push(`${topProto || "network"} traffic`);

  let summary = `This capture shows ${parts[0]}`;
  if (duration) summary += ` over ${duration}`;
  summary += `. It contains ${packets.length.toLocaleString()} packets`;
  const uniqueIps = new Set([...packets.map(p => p.src_ip), ...packets.map(p => p.dst_ip)].filter(ip => ip !== "—")).size;
  summary += ` across ${uniqueIps} unique IP addresses.`;

  return summary;
}
