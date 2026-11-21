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
export const PORT_COUNT = { pc:1, switch:8, router:6 };
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

// ── DHCP ──────────────────────────────────────────────────────────────────────
export const BROADCAST_MAC = "FF:FF:FF:FF:FF:FF";

// Raw pool config attached to a router interface (physical port or subinterface)
export function poolConfig(d, f) {
  if (d?.type !== "router" || !f) return null;
  if (f.tag === null) return d.ports[f.port].dhcp || null;
  return (d.ports[f.port].subs || []).find(s => Number(s.vlan) === f.tag)?.dhcp || null;
}

export function parsePool(pool, f) {
  if (!pool) return null;
  const start = parseIp(pool.start), end = parseIp(pool.end);
  if (start === null || end === null) return { error:"Pool start and end must be IP addresses" };
  if (!inNet(start, f.a) || !inNet(end, f.a)) return { error:`Pool must be inside ${netStr(f.a)}` };
  if (start > end) return { error:"Pool start is after pool end" };
  if (start === f.a.net || end === f.a.bc) return { error:"Pool can't include the network or broadcast address" };
  return { start, end, size: end - start + 1 };
}

export function defaultPool(f) {
  const first = Math.min(f.a.net + 100, f.a.bc - 1);
  const last  = Math.min(f.a.net + 199, f.a.bc - 1);
  const start = first <= f.a.ip && f.a.ip <= last ? f.a.ip + 1 : first;
  return { start:numToIp(Math.min(start, last)), end:numToIp(last) };
}

const apipaFor = pc => ({ ip: ipToNum(`169.254.${1 + Math.floor(pc.num / 250) % 254}.${(pc.num % 250) + 1}`), prefix:16 });

// Hand out leases. DHCP clients never see each other's leases as "static", so order is by PC number.
export function dhcpLeases(topo) {
  const base = structuredClone(topo);
  for (const d of base.devices) if (d.type === "pc" && d.dhcp) { d.ports[0].addr = ""; d.gw = ""; d.dns = ""; }
  const used = new Set(base.devices.flatMap(d => deviceIps(d)));
  const leases = {};
  const clients = base.devices.filter(d => d.type === "pc" && d.dhcp).sort((a, b) => a.num - b.num);
  for (const pc of clients) {
    const fallback = why => { leases[pc.id] = { apipa:true, ...apipaFor(pc), error:why }; };
    const seg = segment(base, pc.id, 0, null);
    if (seg.unplugged) { fallback("No cable — the DHCP Discover can't go anywhere"); continue; }
    const offers = seg.endpoints
      .map(e => { const dev = deviceById(base, e.dev); const f = ifaceAt(dev, e.port, e.tag); return { e, dev, f, cfg: poolConfig(dev, f) }; })
      .filter(x => x.f && x.cfg);
    if (!offers.length) {
      const blocked = seg.drops.length ? ` On the way: ${seg.drops.map(x => x.why).join("; ")}.` : "";
      fallback(`No DHCP server in this broadcast domain answered.${blocked}`);
      continue;
    }
    const { e, dev, f, cfg } = offers[0];
    const pool = parsePool(cfg, f);
    if (pool.error) { fallback(`${dev.name} ${f.name}'s pool is misconfigured: ${pool.error}`); continue; }
    let ip = null;
    for (let n = pool.start; n <= pool.end; n++) if (n !== f.a.ip && !used.has(n)) { ip = n; break; }
    if (ip === null) { fallback(`${dev.name} ${f.name}'s pool is full — ${pool.size === 1 ? "its only address is" : `all ${pool.size} addresses are`} in use`); continue; }
    used.add(ip);
    leases[pc.id] = { ip, prefix:f.a.prefix, gw:f.a.ip, server:dev.id, serverName:`${dev.name} ${f.name}`,
      iface:f.name, endpoint:e, pool, offers:offers.length,
      dns: parseIp(cfg.dns) !== null ? String(cfg.dns).trim() : "" };
  }
  return leases;
}

// The topology as the network sees it: DHCP clients carry their leased (or APIPA) address
export function applyDhcp(topo) {
  const leases = dhcpLeases(topo);
  const live = structuredClone(topo);
  for (const d of live.devices) {
    const l = leases[d.id];
    if (!l) continue;
    d.ports[0].addr = `${numToIp(l.ip)}/${l.prefix}`;
    d.gw = l.apipa ? "" : numToIp(l.gw);
    d.dns = l.apipa ? "" : l.dns;
    d.lease = l;
  }
  return { topo:live, leases };
}

const revHop = h => ({ sw:h.sw, inPort:h.outPort, outPort:h.inPort, vlan:h.vlan, tagIn:h.tagOut, tagOut:h.tagIn, inMode:h.outMode, outMode:h.inMode });

// Replays the DHCP exchange (Discover, Offer, Request, Ack) for one client on the base topology
export function dhcpTrace(topo, leases, pcId) {
  const steps = [];
  const learned = { arp:[], mac:[] };
  const pc = deviceById(topo, pcId);
  if (!pc?.dhcp) return { ok:false, steps:[{ kind:"drop", at:pcId, title:"This PC uses a static address", links:[] }], learned, reason:"Static address" };
  const lease = leases[pcId];
  const mac = macOf(pc, 0);
  const base = structuredClone(topo);
  base.devices.forEach(d => { if (d.type === "pc" && d.dhcp) { d.ports[0].addr = ""; d.gw = ""; } });
  const seg = segment(base, pcId, 0, null);
  for (const e of seg.entered) learned.mac.push({ sw:e.sw, vlan:e.vlan, mac, port:e.port, host:`${pc.name} eth0` });

  const discover = { srcMac:mac, dstMac:BROADCAST_MAC, srcIp:"0.0.0.0", dstIp:"255.255.255.255", ttl:64 };
  steps.push({ kind:"send", at:pcId, links:[], frame:{ ...discover, tag:null, app:"DHCP DISCOVER" },
    title:`${pc.name} broadcasts DHCP DISCOVER`,
    detail:`${pc.name} has no IP yet, so it sends from 0.0.0.0 to 255.255.255.255 with destination MAC ${BROADCAST_MAC}. Switches flood it to every port in the same VLAN.` });

  if (lease.apipa) {
    seg.entered.forEach(e => steps.push({ kind:"switch", at:e.sw, links:[], frame:{ ...discover, tag:null, vlan:e.vlan, app:"DHCP DISCOVER" },
      title:`${deviceById(topo, e.sw).name} floods the broadcast in VLAN ${e.vlan}`, detail:"A broadcast goes out every port in its VLAN except the one it came in on." }));
    steps.push({ kind:"drop", at:pcId, links:seg.drops.flatMap(x => x.links), title:"No DHCP OFFER came back",
      detail:`${lease.error} After a few retries ${pc.name} gives itself an APIPA address, ${numToIp(lease.ip)}/16 — it can only talk to other APIPA hosts on the same segment, and has no gateway.` });
    return { ok:false, steps, learned, reason:"No DHCP server — fell back to APIPA" };
  }

  const srv = deviceById(topo, lease.server);
  const srvIface = lease.iface;
  const srvMac = macOf(srv, lease.endpoint.port);
  const { links, hops } = lease.endpoint;
  const rLinks = [...links].reverse(), rHops = [...hops].reverse().map(revHop);
  const offered = numToIp(lease.ip), gw = numToIp(lease.gw);
  const toServer = (frame, label) => {
    hops.forEach((h, i) => steps.push({ kind:"switch", at:h.sw, links:links.slice(0, i + 1), frame:{ ...frame, tag:h.tagOut, vlan:h.vlan, app:label },
      title:`${deviceById(topo, h.sw).name}: floods ${label.replace("DHCP ", "")} in VLAN ${h.vlan}`,
      detail:`Broadcast in on ${portName("switch", h.inPort)}, copied out every other VLAN ${h.vlan} port including ${portName("switch", h.outPort)}.` }));
    steps.push({ kind:"arrive", at:srv.id, links, frame:{ ...frame, tag:lease.endpoint.tag, app:label },
      title:`${srv.name} ${srvIface} receives ${label}`, detail:"" });
  };
  const toClient = (frame, label) => {
    steps.push({ kind:"send", at:srv.id, links:[], frame:{ ...frame, tag:lease.endpoint.tag, app:label },
      title:`${srv.name} ${srvIface} sends ${label}`, detail:"" });
    rHops.forEach((h, i) => steps.push({ kind:"switch", at:h.sw, links:rLinks.slice(0, i + 1), frame:{ ...frame, tag:h.tagOut, vlan:h.vlan, app:label },
      title:`${deviceById(topo, h.sw).name}: in ${portName("switch", h.inPort)} → out ${portName("switch", h.outPort)} (VLAN ${h.vlan})`,
      detail:`${pc.name}'s MAC was learned from the DISCOVER, so this is forwarded only toward ${pc.name}.` }));
    steps.push({ kind:"arrive", at:pcId, links:rLinks, frame:{ ...frame, tag:null, app:label }, title:`${pc.name} receives ${label}`, detail:"" });
  };

  toServer(discover, "DHCP DISCOVER");
  steps.at(-1).detail = `${srvIface} has a DHCP pool (${numToIp(lease.pool.start)}–${numToIp(lease.pool.end)}). The lowest free address is ${offered}.`
    + (lease.offers > 1 ? ` (${lease.offers} servers could answer — the client takes the first offer.)` : "");
  const offer = { srcMac:srvMac, dstMac:mac, srcIp:gw, dstIp:"255.255.255.255", ttl:64 };
  const offerAt = steps.length;
  toClient(offer, "DHCP OFFER");
  steps[offerAt].detail = `Offers ${offered}/${lease.prefix} with gateway ${gw}${lease.dns ? `, DNS server ${lease.dns}` : " (no DNS server set in this pool)"} and a 24-hour lease.`;
  steps.at(-1).detail = `${pc.name} sees the offer of ${offered}. It still has no IP — it must formally request it.`;
  const request = { ...discover };
  steps.push({ kind:"send", at:pcId, links:[], frame:{ ...request, tag:null, app:"DHCP REQUEST" }, title:`${pc.name} broadcasts DHCP REQUEST for ${offered}`,
    detail:"Still broadcast, so any other DHCP servers that made an offer learn that theirs was declined." });
  toServer(request, "DHCP REQUEST");
  steps.at(-1).detail = `${srv.name} records the binding ${offered} ↔ ${mac}.`;
  for (const h of rHops) learned.mac.push({ sw:h.sw, vlan:h.vlan, mac:srvMac, port:h.inPort, host:`${srv.name} ${srvIface}` });
  const ackAt = steps.length;
  toClient({ ...offer }, "DHCP ACK");
  steps[ackAt].detail = `Confirms ${offered}/${lease.prefix}, gateway ${gw}, lease time 24 hours.`;
  steps.at(-1).detail = `${pc.name} applies the lease.`;
  steps.push({ kind:"deliver", at:pcId, links:[], title:`${pc.name} is configured: ${offered}/${lease.prefix}, gateway ${gw}${lease.dns ? `, DNS ${lease.dns}` : ""}`,
    detail:`Lease from ${srv.name} ${srvIface}, valid 24 hours. ${pc.name} can now ARP for its gateway and send traffic.` });
  return { ok:true, steps, learned };
}

// ── Routing algorithms (link state and distance vector) ───────────────────────
export function linkCost(l) {
  const c = Number(l?.cost);
  return Number.isInteger(c) && c >= 1 && c <= 9999 ? c : 1;
}

// Routers and the router-to-router cables between them. An edge is "usable" for
// forwarding when both ends have IPs on the same subnet (needed for a next hop).
export function routerGraph(topo) {
  const routers = topo.devices.filter(d => d.type === "router").sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric:true }));
  const edges = topo.links.map(l => {
    const a = deviceById(topo, l.a.dev), b = deviceById(topo, l.b.dev);
    if (a?.type !== "router" || b?.type !== "router") return null;
    const aA = portAddr(a, l.a.port), bA = portAddr(b, l.b.port);
    return { id:l.id, a:a.id, b:b.id, aPort:l.a.port, bPort:l.b.port, cost:linkCost(l),
      aIp:aA?.ip ?? null, bIp:bA?.ip ?? null, usable: !!(aA && bA && aA.net === bA.net && aA.prefix === bA.prefix) };
  }).filter(Boolean);
  return { nodes: routers.map(r => r.id), names: Object.fromEntries(routers.map(r => [r.id, r.name])), edges };
}

// Cheapest edge between two routers (parallel cables are allowed)
function bestEdge(g, x, y, usableOnly) {
  return g.edges
    .filter(e => ((e.a === x && e.b === y) || (e.a === y && e.b === x)) && (!usableOnly || e.usable))
    .sort((p, q) => p.cost - q.cost)[0] || null;
}
const neighborsOf = (g, x, usableOnly) =>
  [...new Set(g.edges.filter(e => (e.a === x || e.b === x) && (!usableOnly || e.usable)).map(e => (e.a === x ? e.b : e.a)))]
    .map(v => ({ v, cost: bestEdge(g, x, v, usableOnly).cost }));

// Dijkstra as in Kurose & Ross §5.2.1: one table row per step. Ties go to the node reached
// through the most recently added router (then by name), which reproduces the lecture's table.
export function dijkstra(g, src, usableOnly = false) {
  const D = {}, P = {};
  g.nodes.forEach(n => { D[n] = Infinity; P[n] = null; });
  if (!g.nodes.includes(src)) return { steps:[], D, P, src, firstHop:() => null, treeEdges:[] };
  D[src] = 0;
  neighborsOf(g, src, usableOnly).forEach(({ v, cost }) => { D[v] = cost; P[v] = src; });
  const N = [src];
  const steps = [{ added:src, N:[...N], D:{ ...D }, P:{ ...P } }];
  while (N.length < g.nodes.length) {
    const w = g.nodes.filter(n => !N.includes(n) && D[n] < Infinity)
      .sort((a, b) => D[a] - D[b] || N.indexOf(P[b]) - N.indexOf(P[a])
        || g.names[a].localeCompare(g.names[b], undefined, { numeric:true }))[0];
    if (!w) break;
    N.push(w);
    neighborsOf(g, w, usableOnly).forEach(({ v, cost }) => {
      if (!N.includes(v) && D[w] + cost < D[v]) { D[v] = D[w] + cost; P[v] = w; }
    });
    steps.push({ added:w, N:[...N], D:{ ...D }, P:{ ...P } });
  }
  const firstHop = dest => {
    if (dest === src || P[dest] === null) return null;
    let v = dest;
    while (P[v] !== src) v = P[v];
    return v;
  };
  const treeEdges = g.nodes.filter(v => v !== src && P[v] !== null).map(v => bestEdge(g, P[v], v, usableOnly)).filter(Boolean);
  return { steps, D, P, src, firstHop, treeEdges };
}

// Synchronous Bellman-Ford distance vector: every router updates from its
// neighbours' previous vectors each iteration, until nothing changes.
export function distanceVector(g, usableOnly = false) {
  const nodes = g.nodes;
  const c = (x, y) => (x === y ? 0 : bestEdge(g, x, y, usableOnly)?.cost ?? Infinity);
  let V = {}, NH = {};
  nodes.forEach(x => {
    V[x] = {}; NH[x] = {};
    nodes.forEach(y => { V[x][y] = c(x, y); NH[x][y] = x === y ? x : V[x][y] < Infinity ? y : null; });
  });
  const iterations = [{ V:structuredClone(V), NH:structuredClone(NH), changed:[] }];
  for (let k = 1; k <= nodes.length + 1; k++) {
    const nV = {}, nNH = {}, changed = [];
    nodes.forEach(x => {
      nV[x] = {}; nNH[x] = {};
      const nbs = neighborsOf(g, x, usableOnly);
      nodes.forEach(y => {
        if (x === y) { nV[x][y] = 0; nNH[x][y] = x; return; }
        let best = Infinity, via = null;
        for (const { v, cost } of nbs) {
          const viaCost = cost + V[v][y];
          if (viaCost < best || (viaCost === best && via !== null && g.names[v].localeCompare(g.names[via], undefined, { numeric:true }) < 0)) { best = viaCost; via = v; }
        }
        nV[x][y] = best; nNH[x][y] = best < Infinity ? via : null;
        if (best !== V[x][y]) changed.push({ x, y });
      });
    });
    V = nV; NH = nNH;
    iterations.push({ V:structuredClone(V), NH:structuredClone(NH), changed });
    if (!changed.length) break;
  }
  return { iterations, converged: !iterations.at(-1).changed.length };
}

// Routes a router learns from link-state routing ("O" like OSPF), cheapest path wins
function linkStateRoutes(topo, r) {
  const g = routerGraph(topo);
  const dj = dijkstra(g, r.id, true);
  const own = interfaces(r).filter(f => linkAt(topo, r.id, f.port));
  const best = new Map();
  for (const t of g.nodes) {
    if (t === r.id || dj.D[t] === Infinity) continue;
    const hop = dj.firstHop(t);
    const e = bestEdge(g, r.id, hop, true);
    if (!e) continue;
    const myPort = e.a === r.id ? e.aPort : e.bPort;
    const via = e.a === r.id ? e.bIp : e.aIp;
    const target = deviceById(topo, t);
    for (const f of interfaces(target)) {
      if (!linkAt(topo, t, f.port)) continue;
      if (own.some(o => o.a.net === f.a.net && o.a.prefix === f.a.prefix)) continue;
      const key = `${f.a.net}/${f.a.prefix}`;
      if (best.has(key) && best.get(key).metric <= dj.D[t]) continue;
      best.set(key, { net:f.a.net, prefix:f.a.prefix, mask:f.a.mask, port:myPort, tag:null,
        iface:portName("router", myPort), via, type:"O", metric:dj.D[t] });
    }
  }
  return [...best.values()].sort((a, b) => a.net - b.net);
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
  // Static routes are listed first so they win ties, like their lower administrative distance
  if (topo.dynamic) rows.push(...linkStateRoutes(topo, r));
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
// opts: { l4, app, label } annotate the frames; arpCache (Set of "dev|ip") skips ARP for known next hops
export function trace(topo, srcId, dstIpStr, opts = {}) {
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
          : route.type === "O"
            ? `Longest match is a link-state route (cost ${route.metric}) computed by Dijkstra; next hop ${numToIp(route.via)} on ${route.iface}. TTL ${ttl + 1} → ${ttl}.`
            : `Longest match is a static route via ${numToIp(route.via)} on ${route.iface}. TTL ${ttl + 1} → ${ttl}.`) + sub });
    }

    // 2. ARP for the next hop on the egress segment (only within the egress VLAN)
    const seg = segment(topo, cur.id, egress.port, egress.tag);
    if (seg.unplugged) return fail(cur.id, `${cur.name} ${portName(cur.type, egress.port)} has no cable`, "The egress port is not connected to anything.");
    const target = seg.endpoints.find(e => ifaceAt(deviceById(topo, e.dev), e.port, e.tag)?.a.ip === nh);
    const srcMac = macOf(cur, egress.port);
    const cached = !!target && !!opts.arpCache?.has(`${cur.id}|${numToIp(nh)}`);
    if (cached) {
      // No broadcast needed: only the switches on the path see (and learn from) the unicast frame
      for (const h of target.hops) learned.mac.push({ sw:h.sw, vlan:h.vlan, mac:srcMac, port:h.inPort, host:`${cur.name} ${egress.name}` });
    } else {
      // The ARP request floods the whole VLAN, so every switch it enters learns the sender's MAC
      for (const e of seg.entered) learned.mac.push({ sw:e.sw, vlan:e.vlan, mac:srcMac, port:e.port, host:`${cur.name} ${egress.name}` });
    }
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
    if (!cached) {
      steps.push({ kind:"arp", at:cur.id, links:target.links, title:`ARP: ${numToIp(nh)} is at ${dstMac}`,
        detail:`${cur.name} broadcasts "who has ${numToIp(nh)}?"${target.hops.length ? ` in VLAN ${target.hops[0].vlan}` : ""}; ${tdev.name} ${tIface.name} replies with its MAC.` });
    }

    // 3. Frame crosses the segment, switch by switch
    const base = { srcMac, dstMac, srcIp:numToIp(srcAddr.ip), dstIp:numToIp(dst), ttl,
      ...(opts.l4 ? { l4:opts.l4 } : {}), ...(opts.app ? { app:opts.app } : {}) };
    steps.push({ kind:"send", at:cur.id, links:[], frame:{ ...base, tag:egress.tag },
      title:`${cur.name} sends ${opts.label ? `${opts.label} ` : "frame "}out ${egress.name}`,
      detail:`${cached ? `${numToIp(nh)}'s MAC is already in ${cur.name}'s ARP cache, so no ARP needed. ` : ""}New Ethernet header: ${srcMac} → ${dstMac}, ${tagText(egress.tag)}. IP addresses stay ${base.srcIp} → ${base.dstIp}.` });
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
      steps.push({ kind:"deliver", at:tdev.id, links:[], title:opts.label ? `${opts.label} reaches ${tdev.name}` : `Delivered to ${tdev.name}`,
        detail:`${numToIp(dst)} belongs to ${tdev.name}. The packet crossed ${steps.filter(s => s.kind === "route" && deviceById(topo, s.at)?.type === "router").length} router(s); final TTL ${ttl}.` });
      return { ok:true, steps, learned, ttl };
    }
    if (tdev.type !== "router") return fail(tdev.id, `${tdev.name} is not a router — packet dropped`, "End hosts don't forward packets for others.");
    cur = tdev;
  }
  return fail(cur.id, "Gave up after too many hops", "This looks like a routing loop.");
}

// ── Servers and "a day in the life of a web request" ──────────────────────────
export const isServer = d => d?.type === "pc" && !!(d.services?.dns || d.services?.web);
const normName = s => String(s ?? "").trim().toLowerCase().replace(/\.$/, "");

export function dnsLookup(server, name) {
  const rec = (server?.services?.dns?.records || []).find(r => normName(r.name) === normName(name));
  return rec ? parseIp(rec.ip) : null;
}

export function parseUrl(s) {
  const t = String(s ?? "").trim().replace(/^https?:\/\//i, "");
  const slash = t.indexOf("/");
  const host = (slash < 0 ? t : t.slice(0, slash)).replace(/:\d+$/, "").toLowerCase();
  if (!host || /\s/.test(host)) return null;
  return { host, path: slash < 0 ? "/" : t.slice(slash) };
}

// Opens a URL from a PC: DHCP → (ARP) → DNS → TCP handshake → HTTP, as in Kurose & Ross §6.7.
// `base` is the configured topology (for DHCP); `live` has leases applied.
export function webRequest(base, live, leases, pcId, urlStr) {
  const steps = [], stages = [];
  const learned = { arp:[], mac:[] };
  const arpCache = new Set();
  const absorb = (run, stage) => {
    run.steps.forEach(s => steps.push({ ...s, stage }));
    learned.arp.push(...run.learned.arp);
    learned.mac.push(...run.learned.mac);
    run.learned.arp.forEach(e => arpCache.add(`${e.dev}|${e.ip}`));
    return run.ok;
  };
  const note = (stage, at, title, detail = "", kind = "route") => steps.push({ kind, at, links:[], title, detail, stage });
  const finish = (ok, reason, failed) => {
    if (failed) stages.push({ name:failed, ok:false });
    return { ok, steps, learned, stages, reason };
  };

  const pc = deviceById(live, pcId);
  const url = parseUrl(urlStr);
  if (!pc || pc.type !== "pc") return finish(false, "Pick a source PC");
  if (!url) { note("DNS", pcId, "Enter a web address such as www.cs204.edu", "", "drop"); return finish(false, "Invalid URL", "DNS"); }

  // 1. DHCP
  if (pc.dhcp) {
    if (!absorb(dhcpTrace(base, leases, pcId), "DHCP")) return finish(false, "No DHCP lease", "DHCP");
  } else {
    note("DHCP", pcId, `${pc.name} has a static IP — no DHCP needed`,
      `Configured by hand: ${pc.ports[0].addr || "no IP"}, gateway ${pc.gw || "none"}, DNS server ${pc.dns || "none"}.`);
  }
  stages.push({ name:"DHCP", ok:true });
  const mine = portAddr(pc, 0);
  if (!mine) { note("DHCP", pcId, `${pc.name} has no IP address`, "", "drop"); return finish(false, "No IP address", "DNS"); }
  const myIp = numToIp(mine.ip);

  // 2. DNS (UDP port 53)
  let serverIp = parseIp(url.host);
  if (serverIp !== null) {
    note("DNS", pcId, `${url.host} is already an IP address — no DNS lookup needed`);
  } else {
    const dnsIp = parseIp(pc.dns);
    if (dnsIp === null) {
      note("DNS", pcId, `${pc.name} doesn't know a DNS server`,
        `To turn ${url.host} into an IP address the PC must ask a DNS server. Set one in the DHCP pool (or the PC's static settings).`, "drop");
      return finish(false, "No DNS server configured", "DNS");
    }
    const sport = 50000 + pc.num;
    if (!absorb(trace(live, pcId, numToIp(dnsIp), { l4:`UDP ${sport} → 53`, app:`DNS query: A record for ${url.host}?`, label:"DNS query", arpCache }), "DNS"))
      return finish(false, "DNS query didn't reach the server", "DNS");
    const dnsDev = live.devices.find(d => deviceIps(d).includes(dnsIp));
    if (!dnsDev?.services?.dns) {
      note("DNS", dnsDev.id, `${dnsDev.name} isn't running a DNS server`,
        `Nothing listens on UDP port 53 at ${numToIp(dnsIp)}, so the query goes unanswered (a real host would send ICMP "port unreachable").`, "drop");
      return finish(false, "No DNS service at that address", "DNS");
    }
    serverIp = dnsLookup(dnsDev, url.host);
    note("DNS", dnsDev.id,
      serverIp === null ? `${dnsDev.name} has no record for ${url.host}` : `${dnsDev.name} looks up ${url.host} → ${numToIp(serverIp)}`,
      serverIp === null ? "The name isn't in this server's records, so it answers NXDOMAIN (non-existent domain)." : "It finds an A record and sends the answer back over UDP.");
    if (dnsDev.type !== "pc" || !absorb(trace(live, dnsDev.id, myIp, {
      l4:`UDP 53 → ${sport}`, label:"DNS response", arpCache,
      app: serverIp === null ? `DNS response: NXDOMAIN (${url.host})` : `DNS response: ${url.host} A ${numToIp(serverIp)}`,
    }), "DNS")) return finish(false, "DNS response didn't make it back", "DNS");
    if (serverIp === null) {
      note("DNS", pcId, `Name not found: ${url.host}`, "The browser shows “server not found”. No TCP connection is attempted.", "drop");
      return finish(false, `NXDOMAIN for ${url.host}`, "DNS");
    }
  }
  stages.push({ name:"DNS", ok:true });

  // 3. TCP three-way handshake to port 80
  const srv = numToIp(serverIp);
  const cport = 49152 + pc.num, cIsn = 1000 + pc.num * 100, sIsn = 5000;
  if (!absorb(trace(live, pcId, srv, { l4:`TCP ${cport} → 80 [SYN] seq=${cIsn}`, label:"TCP SYN", arpCache }), "TCP"))
    return finish(false, "TCP SYN didn't reach the server", "TCP");
  const web = live.devices.find(d => deviceIps(d).includes(serverIp));
  if (!web?.services?.web) {
    note("TCP", web.id, `${web.name} has no web server on port 80`,
      "Nothing is listening on TCP port 80, so the host refuses the connection with a RST segment.", "drop");
    if (web.type === "pc") absorb(trace(live, web.id, myIp, { l4:`TCP 80 → ${cport} [RST, ACK] seq=0 ack=${cIsn + 1}`, label:"TCP RST", arpCache }), "TCP");
    note("TCP", pcId, "Connection refused", "The browser reports that the site refused to connect.", "drop");
    return finish(false, "Connection refused — no web server on port 80", "TCP");
  }
  if (!absorb(trace(live, web.id, myIp, { l4:`TCP 80 → ${cport} [SYN, ACK] seq=${sIsn} ack=${cIsn + 1}`, label:"TCP SYN-ACK", arpCache }), "TCP"))
    return finish(false, "TCP SYN-ACK didn't make it back", "TCP");
  if (!absorb(trace(live, pcId, srv, { l4:`TCP ${cport} → 80 [ACK] seq=${cIsn + 1} ack=${sIsn + 1}`, label:"TCP ACK", arpCache }), "TCP"))
    return finish(false, "TCP ACK didn't reach the server", "TCP");
  note("TCP", pcId, "TCP connection established",
    `Three-way handshake done: client port ${cport} ↔ server port 80, starting sequence numbers ${cIsn} (client) and ${sIsn} (server).`, "deliver");
  stages.push({ name:"TCP", ok:true });

  // 4. HTTP request and response
  const get = `GET ${url.path} HTTP/1.1 · Host: ${url.host}`;
  const getLen = get.length + 60;
  if (!absorb(trace(live, pcId, srv, { l4:`TCP ${cport} → 80 [PSH, ACK] seq=${cIsn + 1} ack=${sIsn + 1} len=${getLen}`, app:`HTTP ${get}`, label:"HTTP GET", arpCache }), "HTTP"))
    return finish(false, "HTTP request didn't reach the server", "HTTP");
  const title = String(web.services.web.title || "").trim() || "Welcome";
  if (!absorb(trace(live, web.id, myIp, {
    l4:`TCP 80 → ${cport} [PSH, ACK] seq=${sIsn + 1} ack=${cIsn + 1 + getLen} len=512`,
    app:`HTTP/1.1 200 OK · <title>${title}</title>`, label:"HTTP 200 OK", arpCache,
  }), "HTTP")) return finish(false, "HTTP response didn't make it back", "HTTP");
  note("HTTP", pcId, `Page loaded: “${title}”`,
    `${pc.name}'s browser renders the page from ${web.name} (${srv}). DHCP, ARP, DNS, TCP and HTTP all had to work for this to happen.`, "deliver");
  stages.push({ name:"HTTP", ok:true });
  return { ok:true, steps, learned, stages, title, serverIp:srv };
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
    if (d.type === "pc" && d.dhcp && d.lease?.apipa) {
      add("warn", d.id, `${d.name} got no DHCP lease and fell back to APIPA ${numToIp(d.lease.ip)}: ${d.lease.error}`);
    }
    if (d.type === "router") {
      interfaces(d).forEach(f => {
        const cfg = poolConfig(d, f);
        const pool = parsePool(cfg, f);
        if (pool?.error) add("error", d.id, `${d.name} ${f.name} DHCP pool: ${pool.error}`);
        if (cfg?.dns && parseIp(cfg.dns) === null) add("error", d.id, `${d.name} ${f.name} DHCP pool: DNS server "${cfg.dns}" is not an IP`);
      });
    }
    if (d.type === "pc" && !d.dhcp && d.dns && parseIp(d.dns) === null) add("error", d.id, `${d.name}: DNS server "${d.dns}" is not an IP`);
    if (d.type === "pc" && d.services?.dns) {
      (d.services.dns.records || []).forEach(r => {
        if (!normName(r.name)) add("error", d.id, `${d.name} DNS: a record has no name`);
        else if (parseIp(r.ip) === null) add("error", d.id, `${d.name} DNS: ${r.name} points to "${r.ip}", which is not an IP`);
      });
    }
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

  for (const l of topo.links) {
    if (l.cost !== undefined && String(l.cost).trim() !== "" && String(linkCost(l)) !== String(l.cost).trim())
      add("error", l.a.dev, `Cable ${portLabel(topo, l.a)} ↔ ${portLabel(topo, l.b)}: cost must be a whole number from 1 to 9999`);
  }
  if (topo.dynamic) {
    routerGraph(topo).edges.filter(e => !e.usable).forEach(e => add("warn", e.a,
      `${deviceById(topo, e.a).name}–${deviceById(topo, e.b).name} cable needs IPs on the same subnet at both ends before link-state routing can use it`));
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
      // APIPA hosts already get their own warning
      const real = members.filter(m => !deviceById(topo, m.dev).lease?.apipa);
      const first = real[0];
      const odd = first && real.find(m => m.f.a.net !== first.f.a.net || m.f.a.prefix !== first.f.a.prefix);
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
    if (cfg.dhcp) d.dhcp = true;
    if (cfg.dns) d.dns = cfg.dns;
    if (cfg.services) d.services = cfg.services;
    const poolOf = ([start, end, dns]) => ({ start, end, ...(dns ? { dns } : {}) });
    Object.entries(cfg.subs || {}).forEach(([i, subs]) => {
      d.ports[i].subs = subs.map(([vlan, addr, pool]) => ({ vlan:String(vlan), addr, ...(pool ? { dhcp:poolOf(pool) } : {}) }));
    });
    Object.entries(cfg.pools || {}).forEach(([i, pool]) => { d.ports[i].dhcp = poolOf(pool); });
    Object.entries(cfg.sw || {}).forEach(([i, p]) => { Object.assign(d.ports[i], p); });
    topo.devices.push(d);
  }
  spec.links.forEach(([a, pa, b, pb, cost], i) =>
    topo.links.push({ id:`l${i + 1}`, a:{ dev:a, port:pa }, b:{ dev:b, port:pb }, ...(cost ? { cost:String(cost) } : {}) }));
  if (spec.dynamic) topo.dynamic = true;
  return topo;
}

// Routers wired point-to-point with /30 transit links, plus one PC LAN per entry in `lans`
function routerLab({ routers, edges, lans }) {
  const num = Object.fromEntries(routers.map(([n], i) => [n, i + 1]));
  const addrs = Object.fromEntries(routers.map(([n]) => [n, []]));
  const devices = [], links = [];
  edges.forEach(([a, b, cost], k) => {
    const pa = addrs[a].length, pb = addrs[b].length;
    addrs[a].push(`10.0.${k + 1}.1/30`);
    addrs[b].push(`10.0.${k + 1}.2/30`);
    links.push([`router${num[a]}`, pa, `router${num[b]}`, pb, cost]);
  });
  lans.forEach(([r, pcName, x, y, third], j) => {
    const p = addrs[r].length;
    addrs[r].push(`192.168.${third}.1/24`);
    devices.push(["pc", j + 1, x, y, { name:pcName, addrs:[`192.168.${third}.10/24`], gw:`192.168.${third}.1` }]);
    links.push([`pc${j + 1}`, 0, `router${num[r]}`, p]);
  });
  routers.forEach(([n, x, y]) => devices.push(["router", num[n], x, y, { name:n, addrs:addrs[n] }]));
  return { devices, links, dynamic:true };
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

const DHCP_CAMPUS = vlan20Pool => {
  const spec = VLAN_CAMPUS("");
  spec.devices = spec.devices.map(([type, num, x, y, cfg = {}]) => {
    if (type === "pc") return [type, num, x, y, { dhcp:true }];
    if (type === "router") return [type, num, x, y, { subs:{ 0:[
      [10, "192.168.10.1/24", ["192.168.10.100", "192.168.10.199"]],
      [20, "192.168.20.1/24", vlan20Pool ? ["192.168.20.100", "192.168.20.199"] : null],
    ] } }];
    return [type, num, x, y, cfg];
  });
  return spec;
};

const DAY_IN_LIFE = webRecordIp => ({
  devices: [
    ["pc", 1, 90, 230, { name:"Laptop", dhcp:true }],
    ["switch", 1, 230, 230],
    ["router", 1, 390, 230, { name:"Campus", addrs:["192.168.1.1/24", "10.0.12.1/30"], routes:[["0.0.0.0/0", "10.0.12.2"]],
      pools:{ 0:["192.168.1.100", "192.168.1.199", "10.0.3.53"] } }],
    ["router", 2, 590, 230, { name:"ISP", addrs:["10.0.12.2/30", "10.0.3.1/24"], routes:[["192.168.1.0/24", "10.0.12.1"]] }],
    ["switch", 2, 760, 230],
    ["pc", 2, 910, 120, { name:"DNS", addrs:["10.0.3.53/24"], gw:"10.0.3.1",
      services:{ dns:{ records:[{ name:"www.cs204.edu", ip:webRecordIp }, { name:"cs204.edu", ip:webRecordIp }] } } }],
    ["pc", 3, 910, 340, { name:"Web", addrs:["10.0.3.80/24"], gw:"10.0.3.1", services:{ web:{ title:"CS204: Computer Networks" } } }],
  ],
  links: [
    ["pc1", 0, "switch1", 0], ["switch1", 7, "router1", 0], ["router1", 1, "router2", 0],
    ["router2", 1, "switch2", 7], ["switch2", 0, "pc2", 0], ["switch2", 1, "pc3", 0],
  ],
});

export const PRESETS = [
  { id:"dayinlife", name:"A day in the life of a web request", hint:"Open www.cs204.edu from the Laptop: DHCP → ARP → DNS → TCP handshake → HTTP, as in the lecture's synthesis slides.",
    build: () => build(DAY_IN_LIFE("10.0.3.80")) },
  { id:"webpuzzle", name:"Puzzle: the page won't load", hint:"The Laptop gets an address and DNS answers, but www.cs204.edu still won't load. Follow the trace to find out why.",
    build: () => build(DAY_IN_LIFE("10.0.3.81")) },
  { id:"dijkstra", name:"Routing: Dijkstra example (lecture)", hint:"The u–z network from the Dijkstra slides. Open the Routing algorithms tab and pick u as the source.",
    build: () => build(routerLab({
      routers: [["u", 150, 230], ["v", 340, 110], ["x", 340, 350], ["w", 560, 110], ["y", 560, 350], ["z", 760, 230]],
      edges: [["u", "v", 2], ["u", "x", 1], ["u", "w", 5], ["v", "x", 2], ["v", "w", 3], ["x", "w", 3], ["x", "y", 1], ["w", "y", 1], ["w", "z", 5], ["y", "z", 2]],
      lans: [["u", "PC-u", 60, 380, 1], ["z", "PC-z", 900, 380, 2]],
    })) },
  { id:"dv", name:"Routing: distance vector example (lecture)", hint:"The a–i grid from the distance-vector slides: every link costs 1 except a–b (8), and there's no c–f link.",
    build: () => build(routerLab({
      routers: [["a", 200, 80], ["b", 450, 80], ["c", 700, 80], ["d", 200, 220], ["e", 450, 220], ["f", 700, 220], ["g", 200, 360], ["h", 450, 360], ["i", 700, 360]],
      edges: [["a", "b", 8], ["b", "c", 1], ["a", "d", 1], ["b", "e", 1], ["d", "e", 1], ["e", "f", 1], ["d", "g", 1], ["e", "h", 1], ["f", "i", 1], ["g", "h", 1], ["h", "i", 1]],
      lans: [["a", "PC-a", 60, 80, 1], ["c", "PC-c", 880, 80, 3]],
    })) },
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
  { id:"dhcp", name:"DHCP on two VLANs", hint:"Every PC gets its address from R1. Select a PC and press “Show DHCP” to watch Discover, Offer, Request and Ack.",
    build: () => build(DHCP_CAMPUS(true)) },
  { id:"dhcppuzzle", name:"Puzzle: 169.254 addresses", hint:"PC2 and PC4 ended up with 169.254.x.x addresses and can't reach anything off their segment. Why?",
    build: () => build(DHCP_CAMPUS(false)) },
  { id:"empty", name:"Empty canvas", hint:"Start from scratch", build: () => ({ devices:[], links:[] }) },
];
