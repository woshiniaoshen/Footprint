// Topology model + packet simulation for the OSI topology builder.

// ── Address math ──────────────────────────────────────────────────────────────
export function ipToNum(ip) { return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0; }
export function numToIp(n)  { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."); }
const maskOf = p => (p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0);

export function parseIp(s) {
  const m = String(s ?? "").trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m || m.slice(1).some(o => Number(o) > 255)) return null;
  return ipToNum(m.slice(1).join("."));
}

// "192.168.1.10/24" → host address on a subnet
export function parseAddr(s) {
  const [ipPart, pPart, extra] = String(s ?? "").trim().split("/");
  if (extra !== undefined || pPart === undefined || !/^\d{1,2}$/.test(pPart)) return { error:"Use IP/prefix, e.g. 192.168.1.10/24" };
  const ip = parseIp(ipPart);
  if (ip === null) return { error:"Invalid IP address" };
  const prefix = Number(pPart);
  if (prefix < 1 || prefix > 30) return { error:"Prefix must be /1–/30" };
  const mask = maskOf(prefix);
  const net = (ip & mask) >>> 0;
  const bc = (net | (~mask >>> 0)) >>> 0;
  if (ip === net) return { error:`${numToIp(ip)} is the network address of /${prefix}` };
  if (ip === bc)  return { error:`${numToIp(ip)} is the broadcast address of /${prefix}` };
  return { ip, prefix, net, mask, bc };
}

// "10.0.3.0/24" or "0.0.0.0/0" → network (host bits ignored)
export function parseNet(s) {
  const [ipPart, pPart, extra] = String(s ?? "").trim().split("/");
  if (extra !== undefined || pPart === undefined || !/^\d{1,2}$/.test(pPart)) return null;
  const ip = parseIp(ipPart);
  const prefix = Number(pPart);
  if (ip === null || prefix > 32) return null;
  const mask = maskOf(prefix);
  return { net: (ip & mask) >>> 0, prefix, mask };
}

export const inNet = (ip, n) => ((ip & n.mask) >>> 0) === n.net;
export const netStr = n => `${numToIp(n.net)}/${n.prefix}`;

// ── Devices, ports, links ─────────────────────────────────────────────────────
export const PORT_COUNT = { pc:1, switch:8, router:4 };
const NAME_PREFIX = { pc:"PC", switch:"SW", router:"R" };
const TYPE_BYTE   = { pc:"0A", switch:"0B", router:"0C" };
const hex2 = n => (n & 255).toString(16).toUpperCase().padStart(2, "0");

export function portName(type, i) {
  if (type === "pc") return "eth0";
  if (type === "switch") return `Fa0/${i + 1}`;
  return `Gi0/${i}`;
}

export const macOf = (d, port) => `02:${TYPE_BYTE[d.type]}:00:${hex2(d.num >> 8)}:${hex2(d.num)}:${hex2(port)}`;

export function makeDevice(type, num, x, y) {
  const d = {
    id: `${type}${num}`, type, num, name: `${NAME_PREFIX[type]}${num}`, x, y,
    ports: Array.from({ length: PORT_COUNT[type] }, () => ({ addr:"" })),
  };
  if (type === "pc") d.gw = "";
  if (type === "router") d.routes = [];
  return d;
}

export function nextNum(topo, type) {
  return Math.max(0, ...topo.devices.filter(d => d.type === type).map(d => d.num)) + 1;
}

export const deviceById = (topo, id) => topo.devices.find(d => d.id === id);

export function linkAt(topo, dev, port) {
  return topo.links.find(l => (l.a.dev === dev && l.a.port === port) || (l.b.dev === dev && l.b.port === port));
}
export function otherEnd(link, dev, port) {
  return link.a.dev === dev && link.a.port === port ? link.b : link.a;
}
export function freePort(topo, d) {
  for (let i = 0; i < d.ports.length; i++) if (!linkAt(topo, d.id, i)) return i;
  return -1;
}

export function connect(topo, aId, bId) {
  const a = deviceById(topo, aId), b = deviceById(topo, bId);
  if (!a || !b || aId === bId) return { error:"Pick two different devices" };
  const pa = freePort(topo, a), pb = freePort(topo, b);
  if (pa < 0) return { error:`${a.name} has no free ports` };
  if (pb < 0) return { error:`${b.name} has no free ports` };
  const id = `l${Math.max(0, ...topo.links.map(l => Number(l.id.slice(1)) || 0)) + 1}`;
  topo.links.push({ id, a:{ dev:aId, port:pa }, b:{ dev:bId, port:pb } });
  return { id };
}

export function removeDevice(topo, id) {
  topo.devices = topo.devices.filter(d => d.id !== id);
  topo.links = topo.links.filter(l => l.a.dev !== id && l.b.dev !== id);
}

export function portLabel(topo, end) {
  const d = deviceById(topo, end.dev);
  return d ? `${d.name} ${portName(d.type, end.port)}` : "?";
}

// L3 address configured on a device port (PC or router), or null
export function portAddr(d, port) {
  if (!d || d.type === "switch") return null;
  const a = parseAddr(d.ports[port]?.addr);
  return a.error ? null : a;
}

export function deviceIps(d) {
  return d.ports.map((_, i) => portAddr(d, i)).filter(Boolean).map(a => a.ip);
}

// ── Layer 2 segment discovery ─────────────────────────────────────────────────
// Everything reachable from (dev, port) through cables and switches.
export function segment(topo, devId, port) {
  const start = linkAt(topo, devId, port);
  if (!start) return { endpoints:[], loop:false, unplugged:true };
  const endpoints = [];
  const seen = new Set();
  let loop = false;
  const queue = [{ end: otherEnd(start, devId, port), links:[start.id], hops:[] }];
  while (queue.length) {
    const { end, links, hops } = queue.shift();
    const d = deviceById(topo, end.dev);
    if (!d) continue;
    if (d.type !== "switch") {
      if (!(d.id === devId && end.port === port)) endpoints.push({ dev:d.id, port:end.port, links, hops });
      continue;
    }
    if (seen.has(d.id)) { loop = true; continue; }
    seen.add(d.id);
    for (let p = 0; p < d.ports.length; p++) {
      if (p === end.port) continue;
      const l = linkAt(topo, d.id, p);
      if (!l || links.includes(l.id)) continue;
      queue.push({ end: otherEnd(l, d.id, p), links:[...links, l.id], hops:[...hops, { sw:d.id, inPort:end.port, outPort:p }] });
    }
  }
  return { endpoints, loop, unplugged:false };
}

// ── Routing ───────────────────────────────────────────────────────────────────
export function routingTable(topo, r) {
  const rows = [];
  r.ports.forEach((_, i) => {
    const a = portAddr(r, i);
    if (a && linkAt(topo, r.id, i)) rows.push({ net:a.net, prefix:a.prefix, mask:a.mask, port:i, via:null, type:"C" });
  });
  (r.routes || []).forEach(rt => {
    const n = parseNet(rt.dest);
    const via = parseIp(rt.via);
    if (!n || via === null) return;
    const conn = rows.find(x => x.type === "C" && inNet(via, x));
    rows.push({ ...n, port: conn ? conn.port : null, via, type:"S" });
  });
  return rows;
}

function lookup(table, dst) {
  return table
    .filter(r => r.port !== null && inNet(dst, r))
    .sort((a, b) => b.prefix - a.prefix)[0] || null;
}

// ── Packet trace ──────────────────────────────────────────────────────────────
// Walks an IPv4 packet from srcId to dstIp one event at a time.
export function trace(topo, srcId, dstIpStr) {
  const steps = [];
  const fail = (at, title, detail) => {
    steps.push({ kind:"drop", at, title, detail, links:[] });
    return { ok:false, steps, reason:title };
  };
  const src = deviceById(topo, srcId);
  const dst = parseIp(dstIpStr);
  if (!src) return fail(null, "Pick a source device");
  if (dst === null) return fail(srcId, "Destination is not a valid IP");
  const srcAddr = portAddr(src, 0);
  if (src.type !== "pc" || !srcAddr) return fail(srcId, `${src.name} has no valid IP address`, "Give the PC an address such as 192.168.1.10/24.");
  if (deviceIps(src).includes(dst)) {
    steps.push({ kind:"deliver", at:srcId, title:"Destination is this PC itself", detail:"Loopback — the packet never leaves the NIC.", links:[] });
    return { ok:true, steps };
  }

  let cur = src;
  let ttl = 64;
  for (let guard = 0; guard < 80; guard++) {
    // 1. Decide the next hop and egress port
    let egress, nh;
    if (cur.type === "pc") {
      egress = 0;
      if (inNet(dst, srcAddr)) {
        nh = dst;
        steps.push({ kind:"route", at:cur.id, links:[], title:`${cur.name}: ${numToIp(dst)} is on my subnet`,
          detail:`${numToIp(dst)} is inside ${netStr(srcAddr)}, so ${cur.name} delivers directly — no router needed.` });
      } else {
        const gw = parseIp(cur.gw);
        if (gw === null) return fail(cur.id, `${cur.name} has no default gateway`, `${numToIp(dst)} is outside ${netStr(srcAddr)} and there is no gateway to send it to.`);
        if (!inNet(gw, srcAddr)) return fail(cur.id, `${cur.name}'s gateway ${numToIp(gw)} is not on its subnet`, `A gateway must be reachable directly, i.e. inside ${netStr(srcAddr)}.`);
        nh = gw;
        steps.push({ kind:"route", at:cur.id, links:[], title:`${cur.name}: ${numToIp(dst)} is remote → send to gateway ${numToIp(gw)}`,
          detail:`${numToIp(dst)} is outside ${netStr(srcAddr)}, so the packet goes to the default gateway.` });
      }
    } else {
      ttl -= 1;
      if (ttl <= 0) return fail(cur.id, `${cur.name}: TTL expired — packet dropped`, "The TTL reached 0, which usually means a routing loop. A real router would send back ICMP Time Exceeded.");
      const route = lookup(routingTable(topo, cur), dst);
      if (!route) return fail(cur.id, `${cur.name}: no route to ${numToIp(dst)}`, `Nothing in ${cur.name}'s routing table matches ${numToIp(dst)}. Add a static route (or a default route 0.0.0.0/0).`);
      egress = route.port;
      nh = route.via ?? dst;
      steps.push({ kind:"route", at:cur.id, links:[], ttl,
        title:`${cur.name}: route ${numToIp(route.net)}/${route.prefix} → out ${portName("router", egress)}`,
        detail: route.type === "C"
          ? `Longest match is the directly connected network on ${portName("router", egress)}. TTL ${ttl + 1} → ${ttl}.`
          : `Longest match is a static route via ${numToIp(route.via)} on ${portName("router", egress)}. TTL ${ttl + 1} → ${ttl}.` });
    }

    // 2. ARP for the next hop on the egress segment
    const seg = segment(topo, cur.id, egress);
    if (seg.unplugged) return fail(cur.id, `${cur.name} ${portName(cur.type, egress)} has no cable`, "The egress port is not connected to anything.");
    const target = seg.endpoints.find(e => portAddr(deviceById(topo, e.dev), e.port)?.ip === nh);
    if (!target) return fail(cur.id, `ARP for ${numToIp(nh)} got no reply`,
      `${cur.name} broadcast "who has ${numToIp(nh)}?" on ${portName(cur.type, egress)}, but nothing on that cable segment has that IP.`);
    const tdev = deviceById(topo, target.dev);
    const srcMac = macOf(cur, egress), dstMac = macOf(tdev, target.port);
    steps.push({ kind:"arp", at:cur.id, links:target.links, title:`ARP: ${numToIp(nh)} is at ${dstMac}`,
      detail:`${cur.name} broadcasts "who has ${numToIp(nh)}?"; ${tdev.name} ${portName(tdev.type, target.port)} replies with its MAC.` });

    // 3. Frame crosses the segment, switch by switch
    const frame = { srcMac, dstMac, srcIp:numToIp(srcAddr.ip), dstIp:numToIp(dst), ttl };
    steps.push({ kind:"send", at:cur.id, links:[], frame, title:`${cur.name} sends frame out ${portName(cur.type, egress)}`,
      detail:`New Ethernet header: ${srcMac} → ${dstMac}. IP addresses stay ${frame.srcIp} → ${frame.dstIp}.` });
    target.hops.forEach((h, i) => {
      const sw = deviceById(topo, h.sw);
      steps.push({ kind:"switch", at:h.sw, links:target.links.slice(0, i + 1), frame,
        title:`${sw.name}: in ${portName("switch", h.inPort)} → out ${portName("switch", h.outPort)}`,
        detail:`Looks up ${dstMac} in its MAC table and forwards. Switches never read the IP header.` });
    });
    steps.push({ kind:"arrive", at:tdev.id, links:target.links, frame,
      title:`${tdev.name} receives frame on ${portName(tdev.type, target.port)}`,
      detail:`Destination MAC matches ${tdev.name}, so it strips the Ethernet header and reads the IP packet.` });

    // 4. Delivered, or forward again
    if (deviceIps(tdev).includes(dst)) {
      steps.push({ kind:"deliver", at:tdev.id, links:[], title:`Delivered to ${tdev.name}`,
        detail:`${numToIp(dst)} belongs to ${tdev.name}. The packet crossed ${steps.filter(s => s.kind === "route" && deviceById(topo, s.at)?.type === "router").length} router(s); final TTL ${ttl}.` });
      return { ok:true, steps };
    }
    if (tdev.type !== "router") return fail(tdev.id, `${tdev.name} is not a router — packet dropped`, "End hosts don't forward packets for others.");
    cur = tdev;
  }
  return fail(cur.id, "Gave up after too many hops", "This looks like a routing loop.");
}

// ── Configuration checks ──────────────────────────────────────────────────────
export function problems(topo) {
  const out = [];
  const add = (level, dev, text) => out.push({ level, dev, text });
  const seenIps = new Map();

  for (const d of topo.devices) {
    if (d.type === "switch") continue;
    d.ports.forEach((p, i) => {
      const wired = !!linkAt(topo, d.id, i);
      const pn = portName(d.type, i);
      if (!p.addr) {
        if (d.type === "pc") add("error", d.id, `${d.name} has no IP address`);
        else if (wired) add("warn", d.id, `${d.name} ${pn} is cabled but has no IP`);
        return;
      }
      const a = parseAddr(p.addr);
      if (a.error) { add("error", d.id, `${d.name} ${pn}: ${a.error}`); return; }
      if (!wired) add("warn", d.id, `${d.name} ${pn} has an IP but no cable`);
      const key = numToIp(a.ip);
      if (seenIps.has(key)) add("error", d.id, `${key} is used by both ${seenIps.get(key)} and ${d.name}`);
      else seenIps.set(key, d.name);
    });
    if (d.type === "pc") {
      const a = portAddr(d, 0);
      if (d.gw) {
        const gw = parseIp(d.gw);
        if (gw === null) add("error", d.id, `${d.name}: gateway is not a valid IP`);
        else if (a && !inNet(gw, a)) add("error", d.id, `${d.name}: gateway ${d.gw} is outside ${netStr(a)}`);
      }
    }
    if (d.type === "router") {
      const nets = d.ports.map((_, i) => portAddr(d, i));
      nets.forEach((a, i) => nets.forEach((b, j) => {
        if (a && b && i < j && (inNet(a.net, b) || inNet(b.net, a)))
          add("error", d.id, `${d.name}: ${portName("router", i)} and ${portName("router", j)} are on overlapping subnets`);
      }));
      const table = routingTable(topo, d);
      (d.routes || []).forEach(rt => {
        const n = parseNet(rt.dest), via = parseIp(rt.via);
        if (!n) add("error", d.id, `${d.name}: route destination "${rt.dest}" is not a network`);
        else if (via === null) add("error", d.id, `${d.name}: next hop "${rt.via}" is not an IP`);
        else if (!table.some(r => r.type === "C" && inNet(via, r))) add("error", d.id, `${d.name}: next hop ${rt.via} is not on a connected network`);
      });
    }
  }

  // Cable segments: mixed subnets and switch loops
  const visited = new Set();
  for (const d of topo.devices) {
    if (d.type === "switch") continue;
    d.ports.forEach((_, i) => {
      const key = `${d.id}:${i}`;
      if (visited.has(key) || !linkAt(topo, d.id, i)) return;
      const seg = segment(topo, d.id, i);
      const members = [{ dev:d.id, port:i }, ...seg.endpoints];
      members.forEach(m => visited.add(`${m.dev}:${m.port}`));
      if (seg.loop) add("warn", d.id, "Switches form a loop — a real network needs Spanning Tree to block one link");
      const addrs = members.map(m => ({ m, a: portAddr(deviceById(topo, m.dev), m.port) })).filter(x => x.a);
      const first = addrs[0];
      const odd = addrs.find(x => x.a.net !== first.a.net || x.a.prefix !== first.a.prefix);
      if (odd) add("warn", odd.m.dev,
        `${portLabel(topo, first.m)} (${netStr(first.a)}) and ${portLabel(topo, odd.m)} (${netStr(odd.a)}) share a segment but are on different subnets`);
    });
  }
  return out.filter((p, i) => out.findIndex(q => q.text === p.text) === i);
}

// ── Presets ───────────────────────────────────────────────────────────────────
function build(spec) {
  const topo = { devices:[], links:[] };
  for (const [type, num, x, y, cfg = {}] of spec.devices) {
    const d = makeDevice(type, num, x, y);
    if (cfg.name) d.name = cfg.name;
    (cfg.addrs || []).forEach((a, i) => { d.ports[i].addr = a; });
    if (cfg.gw) d.gw = cfg.gw;
    if (cfg.routes) d.routes = cfg.routes.map(([dest, via]) => ({ dest, via }));
    topo.devices.push(d);
  }
  spec.links.forEach(([a, pa, b, pb], i) => topo.links.push({ id:`l${i + 1}`, a:{ dev:a, port:pa }, b:{ dev:b, port:pb } }));
  return topo;
}

const THREE_ROUTERS = withReturnRoute => ({
  devices: [
    ["pc", 1, 70, 120, { addrs:["192.168.1.10/24"], gw:"192.168.1.1" }],
    ["pc", 2, 70, 330, { addrs:["192.168.1.11/24"], gw:"192.168.1.1" }],
    ["switch", 1, 200, 225],
    ["router", 1, 340, 225, { addrs:["192.168.1.1/24", "10.0.12.1/30"], routes:[["0.0.0.0/0", "10.0.12.2"]] }],
    ["router", 2, 500, 225, { addrs:["10.0.12.2/30", "10.0.23.1/30"],
      routes: withReturnRoute ? [["192.168.1.0/24", "10.0.12.1"], ["192.168.3.0/24", "10.0.23.2"]] : [["192.168.3.0/24", "10.0.23.2"]] }],
    ["router", 3, 660, 225, { addrs:["10.0.23.2/30", "192.168.3.1/24"], routes:[["0.0.0.0/0", "10.0.23.1"]] }],
    ["switch", 2, 800, 225],
    ["pc", 3, 930, 120, { addrs:["192.168.3.10/24"], gw:"192.168.3.1" }],
    ["pc", 4, 930, 330, { addrs:["192.168.3.11/24"], gw:"192.168.3.1" }],
  ],
  links: [
    ["pc1", 0, "switch1", 0], ["pc2", 0, "switch1", 1], ["switch1", 7, "router1", 0],
    ["router1", 1, "router2", 0], ["router2", 1, "router3", 0],
    ["router3", 1, "switch2", 7], ["switch2", 0, "pc3", 0], ["switch2", 1, "pc4", 0],
  ],
});

export const PRESETS = [
  { id:"classic", name:"Two LANs, one router", hint:"The guided walkthrough's network",
    build: () => build({
      devices: [
        ["pc", 1, 90, 250, { name:"PC-A", addrs:["192.168.1.10/24"], gw:"192.168.1.1" }],
        ["switch", 1, 280, 250],
        ["router", 1, 500, 250, { addrs:["192.168.1.1/24", "192.168.2.1/24"] }],
        ["switch", 2, 720, 250],
        ["pc", 2, 910, 250, { name:"PC-B", addrs:["192.168.2.20/24"], gw:"192.168.2.1" }],
      ],
      links: [["pc1", 0, "switch1", 0], ["switch1", 7, "router1", 0], ["router1", 1, "switch2", 7], ["switch2", 0, "pc2", 0]],
    }) },
  { id:"three", name:"Three routers in a chain", hint:"Static routes across two /30 transit links",
    build: () => build(THREE_ROUTERS(true)) },
  { id:"puzzle", name:"Puzzle: the reply gets lost", hint:"PC1 → PC3 arrives, but the reply doesn't. Find the missing route.",
    build: () => build(THREE_ROUTERS(false)) },
  { id:"empty", name:"Empty canvas", hint:"Start from scratch", build: () => ({ devices:[], links:[] }) },
];
