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

// ── VLANs ─────────────────────────────────────────────────────────────────────
export const NATIVE_VLAN = 1;
export const validVlan = v => Number.isInteger(v) && v >= 1 && v <= 4094;

// Trunk allowed list: "" / "all" → every VLAN; "10,20,30-32" → that set
export function parseAllowed(s) {
  const t = String(s ?? "").trim();
  if (!t || t.toLowerCase() === "all") return { all:true };
  const set = new Set();
  for (const raw of t.split(",")) {
    const part = raw.trim();
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return { error:`"${part}" is not a VLAN or range` };
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (!validVlan(a) || !validVlan(b) || b < a) return { error:`"${part}" is outside 1–4094` };
    for (let v = a; v <= b; v++) set.add(v);
  }
  return { set };
}

// Normalised view of a switch port (older saved topologies have no VLAN fields)
export function switchPort(p) {
  const vlan = Number(p?.vlan);
  return {
    mode: p?.mode === "trunk" ? "trunk" : "access",
    vlan: validVlan(vlan) ? vlan : NATIVE_VLAN,
    allowed: parseAllowed(p?.allowed),
  };
}
const allows = (sp, v) => !sp.allowed.set || sp.allowed.set.has(v);

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
    ports: Array.from({ length: PORT_COUNT[type] }, () =>
      type === "switch" ? { mode:"access", vlan:1, allowed:"" } : type === "router" ? { addr:"", subs:[] } : { addr:"" }),
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

// L3 address configured on a physical port, or null
export function portAddr(d, port) {
  if (!d || d.type === "switch") return null;
  const a = parseAddr(d.ports[port]?.addr);
  return a.error ? null : a;
}

// Every working L3 interface: physical ports (untagged) and router subinterfaces (tagged)
export function interfaces(d) {
  if (!d || d.type === "switch") return [];
  const out = [];
  d.ports.forEach((p, i) => {
    const a = portAddr(d, i);
    if (a) out.push({ port:i, tag:null, a, name:portName(d.type, i) });
    if (d.type !== "router") return;
    (p.subs || []).forEach(s => {
      const v = Number(s.vlan), sa = parseAddr(s.addr);
      if (validVlan(v) && v !== NATIVE_VLAN && !sa.error) out.push({ port:i, tag:v, a:sa, name:`${portName("router", i)}.${v}` });
    });
  });
  return out;
}
export const ifaceAt = (d, port, tag) => interfaces(d).find(f => f.port === port && f.tag === tag) || null;
export const deviceIps = d => interfaces(d).map(f => f.a.ip);

// Port that sends 802.1Q-tagged frames (switch trunk, or router port with subinterfaces)
function portIsTagged(topo, end) {
  const d = deviceById(topo, end.dev);
  if (!d) return false;
  if (d.type === "switch") return switchPort(d.ports[end.port]).mode === "trunk";
  return d.type === "router" && (d.ports[end.port].subs || []).length > 0;
}
export function linkIsTrunk(topo, l) { return portIsTagged(topo, l.a) || portIsTagged(topo, l.b); }

// VLAN a host lands in: the access VLAN of the switch port it plugs into
export function accessVlanOf(topo, devId, port) {
  const l = linkAt(topo, devId, port);
  if (!l) return null;
  const end = otherEnd(l, devId, port);
  const d = deviceById(topo, end.dev);
  if (d?.type !== "switch") return null;
  const sp = switchPort(d.ports[end.port]);
  return sp.mode === "access" ? sp.vlan : null;
}

export function usesVlans(topo) {
  return topo.devices.some(d =>
    d.type === "switch" ? d.ports.some(p => { const sp = switchPort(p); return sp.mode === "trunk" || sp.vlan !== NATIVE_VLAN; })
    : d.type === "router" && d.ports.some(p => (p.subs || []).length));
}

// ── Layer 2 segment discovery (VLAN-aware) ────────────────────────────────────
// Where a frame sent out (dev, port) with 802.1Q tag `tag` (null = untagged) can reach.
export function segment(topo, devId, port, tag = null) {
  const start = linkAt(topo, devId, port);
  if (!start) return { endpoints:[], drops:[], entered:[], loop:false, unplugged:true };
  const endpoints = [], drops = [], entered = [];
  const seen = new Set();
  let loop = false;
  const queue = [{ end: otherEnd(start, devId, port), tag, links:[start.id], hops:[] }];
  while (queue.length) {
    const { end, tag: inTag, links, hops } = queue.shift();
    const d = deviceById(topo, end.dev);
    if (!d) continue;
    if (d.type !== "switch") {
      if (!(d.id === devId && end.port === port)) endpoints.push({ dev:d.id, port:end.port, tag:inTag, links, hops });
      continue;
    }
    const ip = switchPort(d.ports[end.port]);
    const pn = portName("switch", end.port);
    let vlan;
    if (ip.mode === "access") {
      if (inTag !== null) { drops.push({ sw:d.id, links, why:`${d.name} ${pn} is an access port, so it drops frames tagged VLAN ${inTag}` }); continue; }
      vlan = ip.vlan;
    } else {
      vlan = inTag ?? NATIVE_VLAN;
      if (!allows(ip, vlan)) { drops.push({ sw:d.id, links, why:`${d.name} ${pn} is a trunk that doesn't allow VLAN ${vlan}` }); continue; }
    }
    const key = `${d.id}:${vlan}`;
    if (seen.has(key)) { loop = true; continue; }
    seen.add(key);
    entered.push({ sw:d.id, port:end.port, vlan });
    for (let p = 0; p < d.ports.length; p++) {
      if (p === end.port) continue;
      const l = linkAt(topo, d.id, p);
      if (!l || links.includes(l.id)) continue;
      const op = switchPort(d.ports[p]);
      let outTag;
      if (op.mode === "access") { if (op.vlan !== vlan) continue; outTag = null; }
      else {
        if (!allows(op, vlan)) {
          drops.push({ sw:d.id, links:[...links, l.id], why:`${d.name} ${portName("switch", p)} is a trunk that doesn't allow VLAN ${vlan}` });
          continue;
        }
        outTag = vlan === NATIVE_VLAN ? null : vlan;
      }
      queue.push({ end: otherEnd(l, d.id, p), tag:outTag, links:[...links, l.id],
        hops:[...hops, { sw:d.id, inPort:end.port, outPort:p, vlan, tagIn:inTag, tagOut:outTag, inMode:ip.mode, outMode:op.mode }] });
    }
  }
  return { endpoints, drops, entered, loop, unplugged:false };
}

// ── Routing ───────────────────────────────────────────────────────────────────
export function routingTable(topo, r) {
  const rows = [];
  interfaces(r).forEach(f => {
    if (linkAt(topo, r.id, f.port)) rows.push({ net:f.a.net, prefix:f.a.prefix, mask:f.a.mask, port:f.port, tag:f.tag, iface:f.name, via:null, type:"C" });
  });
  (r.routes || []).forEach(rt => {
    const n = parseNet(rt.dest);
    const via = parseIp(rt.via);
    if (!n || via === null) return;
    const conn = rows.find(x => x.type === "C" && inNet(via, x));
    rows.push({ ...n, port: conn ? conn.port : null, tag: conn ? conn.tag : null, iface: conn ? conn.iface : null, via, type:"S" });
  });
  return rows;
}

function lookup(table, dst) {
  return table
    .filter(r => r.port !== null && inNet(dst, r))
    .sort((a, b) => b.prefix - a.prefix)[0] || null;
}

const tagText = t => (t === null ? "untagged" : `802.1Q tag ${t}`);

// ── Packet trace ──────────────────────────────────────────────────────────────
// Walks an IPv4 packet from srcId to dstIp one event at a time.
export function trace(topo, srcId, dstIpStr) {
  const steps = [];
  // What devices learn along the way: ARP entries, and switch MAC table entries
  const learned = { arp:[], mac:[] };
  const fail = (at, title, detail, links = []) => {
    steps.push({ kind:"drop", at, title, detail, links });
    return { ok:false, steps, reason:title, learned };
  };
  const src = deviceById(topo, srcId);
  const dst = parseIp(dstIpStr);
  if (!src) return fail(null, "Pick a source device");
  if (dst === null) return fail(srcId, "Destination is not a valid IP");
  const srcAddr = portAddr(src, 0);
  if (src.type !== "pc" || !srcAddr) return fail(srcId, `${src.name} has no valid IP address`, "Give the PC an address such as 192.168.1.10/24.");
  if (deviceIps(src).includes(dst)) {
    steps.push({ kind:"deliver", at:srcId, title:"Destination is this PC itself", detail:"Loopback — the packet never leaves the NIC.", links:[] });
    return { ok:true, steps, learned };
  }

  let cur = src;
  let ttl = 64;
  for (let guard = 0; guard < 80; guard++) {
    // 1. Decide the next hop and egress interface
    let egress, nh;
    if (cur.type === "pc") {
      egress = { port:0, tag:null, name:"eth0" };
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
      egress = { port:route.port, tag:route.tag, name:route.iface };
      nh = route.via ?? dst;
      const sub = route.tag !== null ? ` Frames on this subinterface carry 802.1Q tag ${route.tag}.` : "";
      steps.push({ kind:"route", at:cur.id, links:[], ttl,
        title:`${cur.name}: route ${numToIp(route.net)}/${route.prefix} → out ${route.iface}`,
        detail: (route.type === "C"
          ? `Longest match is the directly connected network on ${route.iface}. TTL ${ttl + 1} → ${ttl}.`
          : `Longest match is a static route via ${numToIp(route.via)} on ${route.iface}. TTL ${ttl + 1} → ${ttl}.`) + sub });
    }

    // 2. ARP for the next hop on the egress segment (only within the egress VLAN)
    const seg = segment(topo, cur.id, egress.port, egress.tag);
    if (seg.unplugged) return fail(cur.id, `${cur.name} ${portName(cur.type, egress.port)} has no cable`, "The egress port is not connected to anything.");
    const target = seg.endpoints.find(e => ifaceAt(deviceById(topo, e.dev), e.port, e.tag)?.a.ip === nh);
    const srcMac = macOf(cur, egress.port);
    // The ARP request floods the whole VLAN, so every switch it enters learns the sender's MAC
    for (const e of seg.entered) learned.mac.push({ sw:e.sw, vlan:e.vlan, mac:srcMac, port:e.port, host:`${cur.name} ${egress.name}` });
    if (!target) {
      let why = `${cur.name} broadcast "who has ${numToIp(nh)}?" out ${egress.name}, but nothing it reached has that IP.`;
      if (seg.drops.length) why += ` On the way: ${seg.drops.map(x => x.why).join("; ")}.`;
      const owner = topo.devices.flatMap(d => interfaces(d).map(f => ({ d, f }))).find(x => x.f.a.ip === nh);
      if (owner && !seg.drops.length) {
        const vlanOf = (d, f) => f.tag ?? accessVlanOf(topo, d.id, f.port);
        const theirs = vlanOf(owner.d, owner.f), ours = vlanOf(cur, egress);
        why += theirs && ours && theirs !== ours
          ? ` ${numToIp(nh)} is ${owner.d.name} ${owner.f.name} in VLAN ${theirs}, but this frame is in VLAN ${ours}. VLANs are separate broadcast domains — traffic between them must go through a router.`
          : ` ${numToIp(nh)} belongs to ${owner.d.name} ${owner.f.name}, but there is no layer 2 path to it from here.`;
      }
      return fail(cur.id, `ARP for ${numToIp(nh)} got no reply`, why, seg.drops.flatMap(x => x.links));
    }
    const tdev = deviceById(topo, target.dev);
    const tIface = ifaceAt(tdev, target.port, target.tag);
    const dstMac = macOf(tdev, target.port);
    const egressIp = cur.type === "pc" ? srcAddr.ip : interfaces(cur).find(f => f.port === egress.port && f.tag === egress.tag)?.a.ip;
    learned.arp.push({ dev:cur.id, ip:numToIp(nh), mac:dstMac, iface:egress.name, host:`${tdev.name} ${tIface.name}` });
    if (egressIp !== undefined) learned.arp.push({ dev:tdev.id, ip:numToIp(egressIp), mac:srcMac, iface:tIface.name, host:`${cur.name} ${egress.name}` });
    // The unicast ARP reply teaches the switches on the path where the target lives
    for (const h of target.hops) learned.mac.push({ sw:h.sw, vlan:h.vlan, mac:dstMac, port:h.outPort, host:`${tdev.name} ${tIface.name}` });
    steps.push({ kind:"arp", at:cur.id, links:target.links, title:`ARP: ${numToIp(nh)} is at ${dstMac}`,
      detail:`${cur.name} broadcasts "who has ${numToIp(nh)}?"${target.hops.length ? ` in VLAN ${target.hops[0].vlan}` : ""}; ${tdev.name} ${tIface.name} replies with its MAC.` });

    // 3. Frame crosses the segment, switch by switch
    const base = { srcMac, dstMac, srcIp:numToIp(srcAddr.ip), dstIp:numToIp(dst), ttl };
    steps.push({ kind:"send", at:cur.id, links:[], frame:{ ...base, tag:egress.tag }, title:`${cur.name} sends frame out ${egress.name}`,
      detail:`New Ethernet header: ${srcMac} → ${dstMac}, ${tagText(egress.tag)}. IP addresses stay ${base.srcIp} → ${base.dstIp}.` });
    target.hops.forEach((h, i) => {
      const sw = deviceById(topo, h.sw);
      const inDesc  = h.inMode === "access" ? `access port, VLAN ${h.vlan}` : `trunk, ${tagText(h.tagIn)}`;
      const outDesc = h.outMode === "access" ? `access port → tag removed` : `trunk → ${tagText(h.tagOut)}`;
      steps.push({ kind:"switch", at:h.sw, links:target.links.slice(0, i + 1), frame:{ ...base, tag:h.tagOut, vlan:h.vlan },
        title:`${sw.name}: in ${portName("switch", h.inPort)} → out ${portName("switch", h.outPort)} (VLAN ${h.vlan})`,
        detail:`In on ${portName("switch", h.inPort)} (${inDesc}); looks up ${dstMac} in VLAN ${h.vlan}'s MAC table; out ${portName("switch", h.outPort)} (${outDesc}). Switches never read the IP header.` });
    });
    steps.push({ kind:"arrive", at:tdev.id, links:target.links, frame:{ ...base, tag:target.tag },
      title:`${tdev.name} receives frame on ${tIface.name}`,
      detail:`Destination MAC matches ${tdev.name}${target.tag !== null ? `, and tag ${target.tag} steers it to subinterface ${tIface.name}` : ""}, so it strips the Ethernet header and reads the IP packet.` });

    // 4. Delivered, or forward again
    if (deviceIps(tdev).includes(dst)) {
      steps.push({ kind:"deliver", at:tdev.id, links:[], title:`Delivered to ${tdev.name}`,
        detail:`${numToIp(dst)} belongs to ${tdev.name}. The packet crossed ${steps.filter(s => s.kind === "route" && deviceById(topo, s.at)?.type === "router").length} router(s); final TTL ${ttl}.` });
      return { ok:true, steps, learned, ttl };
    }
    if (tdev.type !== "router") return fail(tdev.id, `${tdev.name} is not a router — packet dropped`, "End hosts don't forward packets for others.");
    cur = tdev;
  }
  return fail(cur.id, "Gave up after too many hops", "This looks like a routing loop.");
}

// ── Learned state (ARP caches, switch MAC tables) ─────────────────────────────
export const emptyTables = () => ({ arp:{}, mac:{} });

export function mergeLearned(tables, learned, ping) {
  const next = { arp:{ ...tables.arp }, mac:{ ...tables.mac } };
  (learned?.arp || []).forEach(e => { next.arp[`${e.dev}|${e.ip}`] = { ...e, ping }; });
  (learned?.mac || []).forEach(e => { next.mac[`${e.sw}|${e.vlan}|${e.mac}`] = { ...e, ping }; });
  return next;
}

export const arpTableOf = (tables, devId) =>
  Object.values(tables.arp).filter(e => e.dev === devId).sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip));

export const macTableOf = (tables, swId) =>
  Object.values(tables.mac).filter(e => e.sw === swId).sort((a, b) => a.vlan - b.vlan || a.port - b.port || a.mac.localeCompare(b.mac));

// ── Configuration checks ──────────────────────────────────────────────────────
export function problems(topo) {
  const out = [];
  const add = (level, dev, text) => out.push({ level, dev, text });
  const seenIps = new Map();
  const claimIp = (d, label, a) => {
    const key = numToIp(a.ip);
    if (seenIps.has(key)) add("error", d.id, `${key} is used by both ${seenIps.get(key)} and ${label}`);
    else seenIps.set(key, label);
  };

  for (const d of topo.devices) {
    if (d.type === "switch") {
      d.ports.forEach((p, i) => {
        const pn = portName("switch", i);
        if (p.mode !== "trunk" && p.vlan !== undefined && !validVlan(Number(p.vlan))) add("error", d.id, `${d.name} ${pn}: VLAN must be 1–4094`);
        if (p.mode === "trunk" && parseAllowed(p.allowed).error) add("error", d.id, `${d.name} ${pn}: ${parseAllowed(p.allowed).error}`);
      });
      continue;
    }
    d.ports.forEach((p, i) => {
      const wired = !!linkAt(topo, d.id, i);
      const pn = portName(d.type, i);
      const subs = d.type === "router" ? (p.subs || []) : [];
      if (!p.addr) {
        if (d.type === "pc") add("error", d.id, `${d.name} has no IP address`);
        else if (wired && !subs.length) add("warn", d.id, `${d.name} ${pn} is cabled but has no IP`);
      } else {
        const a = parseAddr(p.addr);
        if (a.error) add("error", d.id, `${d.name} ${pn}: ${a.error}`);
        else {
          if (!wired) add("warn", d.id, `${d.name} ${pn} has an IP but no cable`);
          claimIp(d, `${d.name}${d.type === "router" ? ` ${pn}` : ""}`, a);
        }
      }
      const vlansHere = new Set();
      subs.forEach(s => {
        const v = Number(s.vlan);
        const label = `${d.name} ${pn}.${s.vlan || "?"}`;
        if (!validVlan(v)) add("error", d.id, `${label}: VLAN must be 1–4094`);
        else if (v === NATIVE_VLAN) add("error", d.id, `${label}: VLAN 1 is the untagged native VLAN — put that address on ${pn} itself`);
        else if (vlansHere.has(v)) add("error", d.id, `${d.name} ${pn} has two subinterfaces for VLAN ${v}`);
        else vlansHere.add(v);
        const sa = parseAddr(s.addr);
        if (!s.addr) add("error", d.id, `${label} has no IP address`);
        else if (sa.error) add("error", d.id, `${label}: ${sa.error}`);
        else claimIp(d, label, sa);
      });
      if (subs.length && !wired) add("warn", d.id, `${d.name} ${pn} has subinterfaces but no cable`);
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
      const ifs = interfaces(d);
      ifs.forEach((a, i) => ifs.forEach((b, j) => {
        if (i < j && (inNet(a.a.net, b.a) || inNet(b.a.net, a.a)))
          add("error", d.id, `${d.name}: ${a.name} and ${b.name} are on overlapping subnets`);
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

  // Trunk on one end, access port or PC on the other
  for (const l of topo.links) {
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) {
      const dy = deviceById(topo, y.dev);
      if (!dy || !portIsTagged(topo, x)) continue;
      const yAccess = dy.type === "pc" || (dy.type === "switch" && switchPort(dy.ports[y.port]).mode === "access");
      if (yAccess) add("warn", x.dev, `${portLabel(topo, x)} sends tagged frames but ${portLabel(topo, y)} is ${dy.type === "pc" ? "a PC" : "an access port"} — make both ends trunks`);
    }
  }

  // Broadcast domains: mixed subnets and switch loops
  const visited = new Set();
  for (const d of topo.devices) {
    for (const f of interfaces(d)) {
      const key = `${d.id}:${f.port}:${f.tag}`;
      if (visited.has(key) || !linkAt(topo, d.id, f.port)) continue;
      const seg = segment(topo, d.id, f.port, f.tag);
      const members = [{ dev:d.id, port:f.port, tag:f.tag, f },
        ...seg.endpoints.map(e => ({ ...e, f: ifaceAt(deviceById(topo, e.dev), e.port, e.tag) }))].filter(m => m.f);
      members.forEach(m => visited.add(`${m.dev}:${m.port}:${m.tag}`));
      if (seg.loop) add("warn", d.id, "Switches form a loop — a real network needs Spanning Tree to block one link");
      const label = m => `${deviceById(topo, m.dev).name} ${m.f.name}`;
      const first = members[0];
      const odd = members.find(m => m.f.a.net !== first.f.a.net || m.f.a.prefix !== first.f.a.prefix);
      if (odd) add("warn", odd.dev,
        `${label(first)} (${netStr(first.f.a)}) and ${label(odd)} (${netStr(odd.f.a)}) share a broadcast domain but are on different subnets`);
    }
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
    Object.entries(cfg.subs || {}).forEach(([i, subs]) => { d.ports[i].subs = subs.map(([vlan, addr]) => ({ vlan:String(vlan), addr })); });
    Object.entries(cfg.sw || {}).forEach(([i, p]) => { Object.assign(d.ports[i], p); });
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

const VLAN_CAMPUS = uplinkAllowed => ({
  devices: [
    ["router", 1, 500, 70, { subs:{ 0:[[10, "192.168.10.1/24"], [20, "192.168.20.1/24"]] } }],
    ["switch", 1, 300, 240, { sw:{ 0:{ vlan:10 }, 1:{ vlan:20 }, 6:{ mode:"trunk" }, 7:{ mode:"trunk" } } }],
    ["switch", 2, 700, 240, { sw:{ 0:{ vlan:10 }, 1:{ vlan:20 }, 7:{ mode:"trunk", allowed:uplinkAllowed } } }],
    ["pc", 1, 110, 150, { addrs:["192.168.10.11/24"], gw:"192.168.10.1" }],
    ["pc", 2, 110, 340, { addrs:["192.168.20.11/24"], gw:"192.168.20.1" }],
    ["pc", 3, 890, 150, { addrs:["192.168.10.12/24"], gw:"192.168.10.1" }],
    ["pc", 4, 890, 340, { addrs:["192.168.20.12/24"], gw:"192.168.20.1" }],
  ],
  links: [
    ["pc1", 0, "switch1", 0], ["pc2", 0, "switch1", 1], ["switch1", 7, "router1", 0],
    ["switch1", 6, "switch2", 7], ["switch2", 0, "pc3", 0], ["switch2", 1, "pc4", 0],
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
  { id:"vlans", name:"VLANs: router-on-a-stick", hint:"VLAN 10 and 20 span two switches over a trunk. Same-VLAN traffic stays on the switches; inter-VLAN traffic goes up to R1 and back.",
    build: () => build(VLAN_CAMPUS("")) },
  { id:"puzzle", name:"Puzzle: the reply gets lost", hint:"PC1 → PC3 arrives, but the reply doesn't. Find the missing route.",
    build: () => build(THREE_ROUTERS(false)) },
  { id:"vlanpuzzle", name:"Puzzle: PC4 is cut off", hint:"PC3 works fine, but PC4 can't reach anything beyond SW2. Find the misconfigured port.",
    build: () => build(VLAN_CAMPUS("10")) },
  { id:"empty", name:"Empty canvas", hint:"Start from scratch", build: () => ({ devices:[], links:[] }) },
];
