// Exam-style question generators for CS204. Every answer is computed by the same
// engines that drive the topology builder and transport lab, so the working shown
// to the student is exactly what the simulators do.
import { numToIp, dijkstra, distanceVector } from "./topoEngine.js";
import { simulate, rttEstimate, congestion, checksum, bin16 } from "./transportEngine.js";

export const TOPICS = { network:"Network layer", transport:"Transport layer", link:"Link layer" };

// ── seeded randomness ────────────────────────────────────────────────────────
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = arr => arr[Math.floor(next() * arr.length)];
  const shuffle = arr => { const c = [...arr]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };
  return { next, int, pick, shuffle };
}

const maskOf = p => (p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0);
const fmt = n => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)));

// Builds a multiple-choice answer from the correct value plus distractors (deduplicated)
function choice(r, correct, distractors) {
  const opts = [String(correct)];
  for (const d of distractors) if (!opts.includes(String(d))) opts.push(String(d));
  const shuffled = r.shuffle(opts.slice(0, 4));
  return { type:"choice", choices:shuffled, correct:shuffled.indexOf(String(correct)) };
}

// ── generators ───────────────────────────────────────────────────────────────
const GENERATORS = [
  {
    id:"subnet", topic:"network", title:"Subnets and CIDR",
    make(r) {
      const prefix = r.int(20, 29);
      const ip = ((r.int(10, 223) << 24) | (r.int(0, 255) << 16) | (r.int(0, 255) << 8) | r.int(1, 254)) >>> 0;
      const mask = maskOf(prefix), net = (ip & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
      const hosts = 2 ** (32 - prefix) - 2;
      const kind = r.pick(["network", "broadcast", "hosts"]);
      const explain = [
        `/${prefix} → subnet mask ${numToIp(mask)} (${prefix} network bits, ${32 - prefix} host bits).`,
        `Network address = IP AND mask = ${numToIp(net)}.`,
        `Broadcast address = network with all host bits set to 1 = ${numToIp(bc)}.`,
        `Usable hosts = 2^${32 - prefix} − 2 = ${hosts} (minus the network and broadcast addresses).`,
      ];
      if (kind === "hosts") return { prompt:`How many usable host addresses are in the subnet containing ${numToIp(ip)}/${prefix}?`, answer:{ type:"number", value:hosts }, explain };
      return {
        prompt:`What is the ${kind} address of the subnet containing ${numToIp(ip)}/${prefix}?`,
        answer:{ type:"ip", value:numToIp(kind === "network" ? net : bc) }, explain,
      };
    },
  },
  {
    id:"lpm", topic:"network", title:"Longest prefix matching",
    make(r) {
      const base = ((r.int(11, 223) << 24) | (r.int(0, 255) << 16) | (r.int(0, 31) << 11)) >>> 0;
      const table = [
        { net:base, prefix:21, link:0 },
        { net:(base + (r.int(0, 3) << 9)) >>> 0, prefix:23, link:1 },
        { net:(base + (r.int(0, 7) << 8)) >>> 0, prefix:24, link:2 },
        { net:0, prefix:0, link:3 },
      ];
      const dst = r.next() < 0.8
        ? (base + r.int(0, 2047)) >>> 0
        : (((base >>> 24) + 1) << 24 | r.int(0, 0xffffff)) >>> 0;
      const matches = table.filter(e => ((dst & maskOf(e.prefix)) >>> 0) === e.net);
      const best = matches.sort((a, b) => b.prefix - a.prefix)[0];
      return {
        prompt:`A router has this forwarding table. Out of which link interface does it forward a datagram to ${numToIp(dst)}?`,
        table:{ cols:["Destination prefix", "Link interface"], rows:table.map(e => [`${numToIp(e.net)}/${e.prefix}`, String(e.link)]) },
        answer:{ type:"choice", choices:["0", "1", "2", "3"], correct:best.link },
        explain:[
          ...table.map(e => `${numToIp(e.net)}/${e.prefix}: ${((dst & maskOf(e.prefix)) >>> 0) === e.net ? "matches" : "no match"}`),
          `Of the matching entries, the longest prefix is /${best.prefix}, so the datagram goes out interface ${best.link}.`,
        ],
      };
    },
  },
  {
    id:"dijkstra", topic:"network", title:"Dijkstra's link-state algorithm",
    make(r) {
      const g = randomGraph(r, ["u", "v", "w", "x", "y", "z"], 3);
      const dj = dijkstra(g, "u");
      const kind = r.pick(["cost", "hop", "order", "step"]);
      const edgesTable = { cols:["Link", "Cost"], rows:g.edges.map(e => [`${e.a}–${e.b}`, String(e.cost)]) };
      const order = dj.steps.map(s => s.added);
      const explain = dj.steps.map((s, i) => `Step ${i}: N′ = ${s.N.join("")} · ` + g.nodes.filter(n => n !== "u")
        .map(n => (s.N.includes(n) ? null : `D(${n}) = ${s.D[n] === Infinity ? "∞" : `${s.D[n]},${s.P[n]}`}`)).filter(Boolean).join(" · "));
      if (kind === "cost") {
        return { prompt:"Run Dijkstra's algorithm from u. What is the least-cost path cost from u to z?", table:edgesTable,
          answer:{ type:"number", value:dj.D.z }, explain:[...explain, `Least cost to z = ${dj.D.z}.`] };
      }
      if (kind === "hop") {
        const hop = dj.firstHop("z");
        return { prompt:"Using Dijkstra from u, which neighbour of u is the next hop on the least-cost path to z?", table:edgesTable,
          answer:choice(r, hop, ["v", "w", "x", "y"].filter(n => n !== hop)),
          explain:[...explain, `Following p(·) back from z reaches u via ${hop}, so u forwards to ${hop}.`] };
      }
      if (kind === "order") {
        const k = r.int(2, 4);
        return { prompt:`Run Dijkstra from u. Which node is added to N′ at step ${k}?`, table:edgesTable,
          answer:choice(r, order[k], r.shuffle(g.nodes.filter(n => n !== "u" && n !== order[k]))),
          explain:[...explain, `At step ${k} the node with the smallest D(·) not yet in N′ is ${order[k]}.`] };
      }
      const k = r.int(1, 2);
      const target = g.nodes.find(n => n !== "u" && !dj.steps[k].N.includes(n));
      return { prompt:`Run Dijkstra from u. After step ${k}, what is D(${target}) (the current estimate of the cost from u to ${target})?`, table:edgesTable,
        answer:{ type:"number", value:dj.steps[k].D[target], allowInfinity:true }, explain:explain.slice(0, k + 1) };
    },
  },
  {
    id:"dv", topic:"network", title:"Distance vector (Bellman-Ford)",
    make(r) {
      const g = randomGraph(r, ["x", "y", "z", "w"], 2);
      const dv = distanceVector(g);
      const [from, to] = r.pick([["x", "z"], ["x", "w"], ["y", "w"], ["z", "x"]]);
      const atOne = r.next() < 0.5;
      const it = atOne ? dv.iterations[1] : dv.iterations.at(-1);
      const nbs = g.edges.filter(e => e.a === from || e.b === from).map(e => ({ v:e.a === from ? e.b : e.a, c:e.cost }));
      const prev = atOne ? dv.iterations[0] : dv.iterations.at(-2) ?? dv.iterations[0];
      return {
        prompt:`Each node runs distance vector (all nodes exchange vectors at the same time, starting from their direct link costs at t = 0). What is D${from}(${to}) ${atOne ? "after the first exchange (t = 1)" : "once the algorithm has converged"}?`,
        table:{ cols:["Link", "Cost"], rows:g.edges.map(e => [`${e.a}–${e.b}`, String(e.cost)]) },
        answer:{ type:"number", value:it.V[from][to], allowInfinity:true },
        explain:[
          `Bellman-Ford: D${from}(${to}) = min over neighbours v of { c(${from},v) + Dv(${to}) }.`,
          ...nbs.map(({ v, c }) => `via ${v}: ${c} + ${fmtInf(prev.V[v][to])} = ${fmtInf(c + prev.V[v][to])}`),
          `Result: ${fmtInf(it.V[from][to])}${atOne ? " (using the neighbours' t = 0 vectors)" : ` (after ${dv.iterations.length - 1} exchanges)`}.`,
        ],
      };
    },
  },
  {
    id:"nat", topic:"network", title:"NAT translation",
    make(r) {
      const pub = `${r.int(100, 200)}.${r.int(0, 255)}.${r.int(0, 255)}.${r.int(2, 250)}`;
      const inside = `10.0.0.${r.int(1, 9)}`, iport = r.int(1025, 9999), next = r.int(5001, 5100);
      const server = `${r.int(100, 200)}.${r.int(0, 255)}.${r.int(0, 255)}.${r.int(2, 250)}`;
      const kind = r.pick(["out", "back"]);
      if (kind === "out") {
        return {
          prompt:`Host ${inside}, port ${iport}, sends a TCP segment to ${server}:80 through a NAT router whose public address is ${pub}. The next free public port is ${next}. What source address and port does the server see?`,
          answer:choice(r, `${pub}:${next}`, [`${inside}:${iport}`, `${pub}:${iport}`, `${inside}:${next}`]),
          explain:[`The NAT router replaces the private source ${inside}:${iport} with its public address and a fresh port, ${pub}:${next}, and records this pair in its NAT translation table.`],
        };
      }
      return {
        prompt:`A NAT router (public address ${pub}) has the table entry ${pub}:${next} ↔ ${inside}:${iport}. A reply from ${server}:80 arrives addressed to ${pub}:${next}. Where does the router forward it?`,
        answer:choice(r, `${inside}:${iport}`, [`${pub}:${next}`, `${inside}:${next}`, `${server}:80`]),
        explain:[`The router looks up port ${next} in its NAT table, rewrites the destination to ${inside}:${iport} and forwards it to the inside host.`],
      };
    },
  },
  {
    id:"dhcp", topic:"network", title:"DHCP",
    make(r) {
      const kind = r.pick(["order", "src", "after"]);
      if (kind === "order") {
        return { prompt:"In what order are the four DHCP messages exchanged when a host joins a network?",
          answer:choice(r, "Discover, Offer, Request, ACK", ["Request, Offer, Discover, ACK", "Discover, Request, Offer, ACK", "Offer, Discover, Request, ACK"]),
          explain:["Client broadcasts DISCOVER → server OFFERs an address → client broadcasts REQUEST for it → server confirms with ACK (“DORA”)."] };
      }
      if (kind === "src") {
        return { prompt:"What source IP address does a new host use in its DHCP Discover message?",
          answer:choice(r, "0.0.0.0", ["255.255.255.255", "The router's IP address", "169.254.0.1"]),
          explain:["The host has no address yet, so it sends from 0.0.0.0 to the broadcast address 255.255.255.255."] };
      }
      return { prompt:"Besides an IP address, which of these does a DHCP server typically also hand out?",
        answer:choice(r, "Default gateway, subnet mask and DNS server", ["The MAC address of the client", "A TCP port number", "The ISP's routing table"]),
        explain:["DHCP returns the IP address plus the first-hop router (gateway), the network mask and the local DNS server."] };
    },
  },
  {
    id:"tcpack", topic:"transport", title:"TCP sequence and ACK numbers",
    make(r) {
      const mss = r.pick([100, 200, 500, 1000]);
      const isn = r.pick([0, 100, 92, 1000, 4000]);
      const lost = r.int(1, 3);
      const sim = simulate({ protocol:"tcp", sizes:Array(5).fill(mss), isn, window:5, timeout:6, faults:{ [`d${lost}#1`]:"lost" }, fastRetransmit:false });
      const seq = i => isn + i * mss;
      const j = r.pick([0, 1, 2, 3, 4].filter(i => i !== lost));
      const ack = sim.txs.find(t => t.kind === "ack" && t.key === `a${j}#1`).seq;
      return {
        prompt:`A TCP sender sends five segments of ${mss} bytes with Seq = ${[0, 1, 2, 3, 4].map(seq).join(", ")}. The segment with Seq = ${seq(lost)} is lost. What ACK number does the receiver send right after it receives the segment with Seq = ${seq(j)}?`,
        answer:{ type:"number", value:ack },
        explain:[
          "The ACK number is the sequence number of the next byte the receiver expects (cumulative ACK).",
          j < lost ? `Everything up to Seq ${seq(j)} arrived in order, so it expects ${seq(j)} + ${mss} = ${ack}.`
            : `Seq ${seq(lost)} is missing, so whatever arrives after the gap it keeps asking for ${ack} (a duplicate ACK).`,
        ],
      };
    },
  },
  {
    id:"rtt", topic:"transport", title:"TCP RTT and timeout",
    make(r) {
      const est = r.int(10, 40) * 10, dev = r.int(2, 12) * 5, sample = est + r.int(-8, 20) * 10;
      const row = rttEstimate(est, dev, [sample])[0];
      const kind = r.pick(["est", "dev", "timeout"]);
      const value = kind === "est" ? row.est : kind === "dev" ? row.dev : row.timeout;
      return {
        prompt:`EstimatedRTT = ${est} ms and DevRTT = ${dev} ms. The next SampleRTT is ${sample} ms. With α = 0.125 and β = 0.25, what is the new ${kind === "est" ? "EstimatedRTT" : kind === "dev" ? "DevRTT" : "TimeoutInterval"} (ms)?`,
        answer:{ type:"number", value, tol:0.01 },
        explain:[
          `EstimatedRTT = 0.875×${est} + 0.125×${sample} = ${fmt(row.est)}`,
          `DevRTT = 0.75×${dev} + 0.25×|${sample} − ${est}| = ${fmt(row.dev)}`,
          `TimeoutInterval = ${fmt(row.est)} + 4×${fmt(row.dev)} = ${fmt(row.timeout)}`,
        ],
      };
    },
  },
  {
    id:"cwnd", topic:"transport", title:"TCP congestion control",
    make(r) {
      const variant = r.pick(["reno", "reno", "tahoe"]);
      const ssthresh = r.pick([4, 6, 8, 10, 12, 16]);
      const lossAt = r.int(5, 9);
      const type = r.pick(["dup", "timeout"]);
      const rows = congestion({ rounds:lossAt + 6, ssthresh, variant, events:{ [lossAt]:type } });
      const q = r.int(lossAt + 1, lossAt + 5);
      const ask = r.pick(["cwnd", "ssthresh"]);
      const val = rows[q - 1][ask];
      return {
        prompt:`TCP ${variant === "reno" ? "Reno" : "Tahoe"} starts with cwnd = 1 MSS and ssthresh = ${ssthresh} MSS. At the end of transmission round ${lossAt} it detects a loss by ${type === "dup" ? "three duplicate ACKs" : "a timeout"}. What is ${ask} (in MSS) during round ${q}?`,
        answer:{ type:"number", value:val, tol:0.01 },
        explain:[
          `Rounds 1–${lossAt}: cwnd = ${rows.slice(0, lossAt).map(x => x.cwnd).join(", ")} (doubling in slow start until ssthresh, then +1 per round).`,
          type === "timeout" || variant === "tahoe"
            ? `Loss: ssthresh = ${rows[lossAt - 1].cwnd}/2 = ${rows[lossAt].ssthresh}, cwnd = 1, back to slow start.`
            : `Three duplicate ACKs in Reno: ssthresh = ${rows[lossAt - 1].cwnd}/2 = ${rows[lossAt].ssthresh}, cwnd = ssthresh + 3 = ${rows[lossAt].cwnd} (fast recovery), then +1 per round.`,
          `Rounds ${lossAt + 1}–${q}: cwnd = ${rows.slice(lossAt, q).map(x => x.cwnd).join(", ")}; ssthresh = ${rows[q - 1].ssthresh}.`,
        ],
      };
    },
  },
  {
    id:"checksum", topic:"transport", title:"Internet checksum",
    make(r) {
      const a = r.int(0x8000, 0xffff), b = r.int(0x8000, 0xffff);
      const res = checksum([bin16(a), bin16(b)]);
      const noWrap = (~((a + b) & 0xffff)) & 0xffff;
      const noFlip = res.sum;
      const off = (res.checksum + 1) & 0xffff;
      return {
        prompt:`What is the Internet checksum of these two 16-bit words?\n${bin16(a)}\n${bin16(b)}`,
        answer:choice(r, bin16(res.checksum), [bin16(noWrap), bin16(noFlip), bin16(off), bin16(res.checksum ^ 0x0110)]),
        explain:[
          `Sum: ${a + b > 0xffff ? "1 " : ""}${bin16((a + b) & 0xffff)}${a + b > 0xffff ? " (carry out)" : ""}`,
          ...(a + b > 0xffff ? [`Wraparound (add the carry back in): ${bin16(res.sum)}`] : []),
          `Flip every bit (one's complement): ${bin16(res.checksum)}`,
        ],
      };
    },
  },
  {
    id:"gbnsr", topic:"transport", title:"Go-Back-N vs Selective Repeat",
    make(r) {
      const N = r.int(3, 5), lost = r.int(1, 3), protocol = r.pick(["gbn", "sr"]);
      const sim = simulate({ protocol, packets:8, window:N, faults:{ [`d${lost}#1`]:"lost" } });
      return {
        prompt:`A sender with window size N = ${N} sends 8 packets (pkt0–pkt7) using ${protocol === "gbn" ? "Go-Back-N" : "Selective Repeat"}. Only pkt${lost} is lost, once; no ACKs are lost. How many packets does the sender retransmit?`,
        answer:{ type:"number", value:sim.stats.retrans },
        explain: protocol === "gbn"
          ? [`The receiver discards everything after the gap. When pkt${lost}'s timer expires, the sender resends pkt${lost} and every packet sent after it — the whole window of ${N} (fewer only near the end of the data).`, `Answer: ${sim.stats.retrans}.`]
          : [`The receiver buffers the out-of-order packets and ACKs each one. Only pkt${lost}'s own timer expires, so only pkt${lost} is resent.`, `Answer: ${sim.stats.retrans}.`],
      };
    },
  },
  {
    id:"util", topic:"transport", title:"Stop-and-wait vs pipelining",
    make(r) {
      const L = r.pick([1000, 1500, 8000, 12000]);
      const Rg = r.pick([1, 10, 100]);
      const rtt = r.pick([10, 20, 30, 60]);
      const N = r.pick([1, 1, 3, 5]);
      const trans = L / (Rg * 1e9) * 1000; // ms
      const u = Math.min(1, (N * trans) / (rtt + trans));
      return {
        prompt:`A link has rate R = ${Rg} Gbps and RTT = ${rtt} ms. Packets are L = ${L} bits. What is the sender utilization with ${N === 1 ? "stop-and-wait" : `a pipelined protocol sending ${N} packets per RTT`}? (answer as a decimal, e.g. 0.00027)`,
        answer:{ type:"number", value:u, rel:0.02 },
        explain:[
          `Transmission time L/R = ${L} / ${Rg}×10⁹ = ${fmt(trans)} ms.`,
          `U = ${N > 1 ? `${N}×` : ""}(L/R) / (RTT + L/R) = ${N > 1 ? `${N}×` : ""}${fmt(trans)} / (${rtt} + ${fmt(trans)}) = ${u.toPrecision(3)}.`,
        ],
      };
    },
  },
  {
    id:"switch", topic:"link", title:"Switch self-learning",
    make(r) {
      const hosts = ["A", "B", "C", "D"];
      const port = Object.fromEntries(r.shuffle([1, 2, 3, 4]).map((p, i) => [hosts[i], p]));
      const seen = r.shuffle(hosts).slice(0, r.int(1, 3));
      const learned = {};
      const frames = seen.map(src => { const dst = r.pick(hosts.filter(h => h !== src)); learned[src] = port[src]; return `${src} → ${dst}`; });
      const src = r.pick(hosts), dst = r.pick(hosts.filter(h => h !== src));
      const known = learned[dst] ?? (dst === src ? port[src] : undefined);
      const correct = known ? `Forward it only out of port ${known}` : `Flood it out of every port except ${port[src]}`;
      return {
        prompt:`A switch starts with an empty table. Hosts A–D are on ports ${hosts.map(h => `${h}=${port[h]}`).join(", ")}. These frames have already passed through: ${frames.join(", ")}. What does the switch do with a new frame ${src} → ${dst}?`,
        answer:choice(r, correct, [
          known ? `Flood it out of every port except ${port[src]}` : `Forward it only out of port ${port[dst]}`,
          "Drop it", `Send it back out of port ${port[src]}`,
        ]),
        explain:[
          `The switch learns a MAC from the source of each frame: it now knows ${Object.keys(learned).map(h => `${h} on port ${learned[h]}`).join(", ") || "nothing"}.`,
          known ? `${dst} is in the table, so the frame is forwarded only to port ${known}.` : `${dst} has never sent a frame, so the switch doesn't know where it is and floods.`,
          `It also learns ${src} is on port ${port[src]}.`,
        ],
      };
    },
  },
  {
    id:"arp", topic:"link", title:"Addressing across a router",
    make(r) {
      const a = { ip:`111.111.111.${r.int(10, 99)}`, mac:"74-29-9C-E8-FF-55" };
      const rl = { ip:"111.111.111.110", mac:"E6-E9-00-17-BB-4B" };
      const rr = { ip:"222.222.222.220", mac:"1A-23-F9-CD-06-9B" };
      const b = { ip:`222.222.222.${r.int(10, 99)}`, mac:"49-BD-D2-C7-56-2A" };
      const kind = r.pick(["dstmac", "dstip", "srcmac2"]);
      const intro = `Host A (${a.ip}, ${a.mac}) sends an IP datagram to host B (${b.ip}, ${b.mac}) on another subnet, through router R (left interface ${rl.ip} / ${rl.mac}, right interface ${rr.ip} / ${rr.mac}).`;
      if (kind === "dstmac") return { prompt:`${intro}\nWhat is the destination MAC address of the frame as it leaves A?`,
        answer:choice(r, rl.mac, [b.mac, rr.mac, "FF-FF-FF-FF-FF-FF"]),
        explain:["B is on another subnet, so A sends the frame to its first-hop router.", `A uses ARP to find R's left-interface MAC (${rl.mac}) and puts that in the frame; the IP destination stays B.`] };
      if (kind === "dstip") return { prompt:`${intro}\nWhat is the destination IP address of the datagram as it leaves A?`,
        answer:choice(r, b.ip, [rl.ip, rr.ip, a.ip]),
        explain:["IP addresses are end-to-end: the datagram is addressed to B the whole way.", "Only the link-layer (MAC) addresses change hop by hop."] };
      return { prompt:`${intro}\nWhen R forwards the datagram onto B's subnet, what is the source MAC address of the new frame?`,
        answer:choice(r, rr.mac, [a.mac, rl.mac, b.mac]),
        explain:["R builds a brand-new frame on the outgoing link.", `Its source MAC is R's right interface (${rr.mac}) and its destination MAC is B (${b.mac}).`] };
    },
  },
];

const fmtInf = v => (v === Infinity ? "∞" : fmt(v));

// A connected random graph: a spanning tree plus `extra` additional links, costs 1–9
function randomGraph(r, names, extra) {
  const edges = [], has = (a, b) => edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  const order = r.shuffle(names);
  for (let i = 1; i < order.length; i++) {
    const a = order[r.int(0, i - 1)], b = order[i];
    edges.push({ a, b, cost:r.int(1, 9) });
  }
  for (let k = 0, tries = 0; k < extra && tries < 50; tries++) {
    const a = r.pick(names), b = r.pick(names);
    if (a !== b && !has(a, b)) { edges.push({ a, b, cost:r.int(1, 9) }); k++; }
  }
  edges.forEach((e, i) => { e.id = `e${i}`; e.usable = true; if (e.a > e.b) [e.a, e.b] = [e.b, e.a]; });
  edges.sort((p, q) => (p.a + p.b).localeCompare(q.a + q.b));
  return { nodes:[...names], names:Object.fromEntries(names.map(n => [n, n])), edges };
}

export const QUESTION_TYPES = GENERATORS.map(({ id, topic, title }) => ({ id, topic, title }));

export function makeQuestion(seed, topics = Object.keys(TOPICS), only = null) {
  const r = rng(seed);
  const pool = GENERATORS.filter(gn => (only ? gn.id === only : topics.includes(gn.topic)));
  if (!pool.length) return null;
  const gen = pool[Math.floor(r.next() * pool.length)];
  return { ...gen.make(r), id:gen.id, topic:gen.topic, title:gen.title, seed };
}

// Checks a typed or chosen answer; returns { correct, expected }
export function checkAnswer(q, input) {
  const a = q.answer;
  if (a.type === "choice") return { correct: Number(input) === a.correct, expected: a.choices[a.correct] };
  if (a.type === "ip") {
    const norm = String(input ?? "").trim();
    return { correct: norm === a.value, expected: a.value };
  }
  const raw = String(input ?? "").trim().toLowerCase().replace(/,/g, "");
  const expected = a.value === Infinity ? "∞" : fmt(a.value);
  if (a.value === Infinity) return { correct: ["∞", "inf", "infinity"].includes(raw), expected };
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return { correct:false, expected };
  const tol = a.rel ? Math.abs(a.value) * a.rel : a.tol ?? 0;
  return { correct: Math.abs(n - a.value) <= tol + 1e-9, expected };
}
