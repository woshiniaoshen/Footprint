// Discrete-event simulator for the reliable-data-transfer protocols in
// Kurose & Ross chapter 3: rdt2.0, rdt2.1, rdt3.0 (stop-and-wait), Go-Back-N, Selective Repeat.
//
// Each transmission gets a stable key ("d2#1" = first send of message 2, "a2#1" = first ACK
// generated for message 2, "n2#1" = first NAK) so the UI can mark it lost or corrupted.

export const PROTOCOLS = {
  rdt20: { name:"rdt2.0", full:"rdt2.0 — ACK/NAK, no sequence numbers", pipelined:false, timer:false },
  rdt21: { name:"rdt2.1", full:"rdt2.1 — adds sequence numbers 0/1", pipelined:false, timer:false },
  rdt30: { name:"rdt3.0", full:"rdt3.0 — stop-and-wait with a timer", pipelined:false, timer:true },
  gbn:   { name:"Go-Back-N", full:"Go-Back-N — cumulative ACKs, one timer", pipelined:true, timer:true },
  sr:    { name:"Selective Repeat", full:"Selective Repeat — individual ACKs, a timer per packet", pipelined:true, timer:true },
  tcp:   { name:"TCP", full:"TCP — byte sequence numbers, cumulative ACKs, fast retransmit", pipelined:true, timer:true, tcp:true },
};

export const DEFAULTS = { packets:6, window:4, timeout:3, D:1, dt:0.25, mss:100, isn:100 };

export function nextFault(f) { return f === "lost" ? "corrupt" : f === "corrupt" ? undefined : "lost"; }

export function simulate({ protocol, packets = DEFAULTS.packets, window = DEFAULTS.window, timeout = DEFAULTS.timeout,
  faults = {}, D = DEFAULTS.D, dt = DEFAULTS.dt, tMax = 80,
  sizes = null, mss = DEFAULTS.mss, isn = DEFAULTS.isn, fastRetransmit = true }) {
  const segSizes = protocol === "tcp" ? (sizes?.length ? sizes : Array(packets).fill(mss)) : null;
  const M = segSizes ? segSizes.length : packets;
  const N = PROTOCOLS[protocol]?.pipelined ? Math.max(1, window) : 1;
  const dtAck = 0.05;
  const txs = [], sNotes = [], rNotes = [], deliveries = [], snaps = [];
  const queue = [];
  let order = 0;
  const schedule = (t, fn) => { queue.push({ t, o:order++, fn }); };
  const counts = {};
  const sNote = (t, text, kind = "info") => sNotes.push({ t, text, kind });
  const rNote = (t, text, kind = "info") => rNotes.push({ t, text, kind });

  // ── channel ──
  const transmit = (from, kind, msg, seq, t, label) => {
    const base = `${kind[0]}${msg}`;
    counts[base] = (counts[base] || 0) + 1;
    const key = `${base}#${counts[base]}`;
    const fate = faults[key] || "ok";
    const dur = (kind === "data" ? dt : dtAck) + D;
    const tx = { id:txs.length, key, kind, msg, seq, from, label, t0:t,
      t1: fate === "lost" ? t + dur * 0.55 : t + dur, fate, attempt:counts[base] };
    txs.push(tx);
    if (fate !== "lost") schedule(t + dur, () => (from === "S" ? recv : sendr)(tx, t + dur));
    return tx;
  };

  // ── sender pacing: one packet per transmission time (L/R) ──
  let freeAt = 0;
  const slot = t => { const s = Math.max(t, freeAt); freeAt = s + dt; return s; };

  // ── shared state for the window display ──
  const S = { base:0, next:0, acked:new Set(), done:false, stuck:false };
  const R = { base:0, buffered:new Set(), delivered:new Set() };
  const snap = t => snaps.push({ t, sBase:S.base, sNext:S.next, sAcked:[...S.acked], rBase:R.base, rBuf:[...R.buffered] });
  const deliver = (t, msg) => {
    const dup = R.delivered.has(msg);
    R.delivered.add(msg);
    deliveries.push({ t, msg, dup });
    rNote(t, dup ? `delivers msg ${msg} AGAIN — duplicate!` : `delivers msg ${msg} to the app`, dup ? "bad" : "good");
  };

  let sendr, recv;
  const timers = {};
  const startTimer = (t, id = "only") => {
    const token = (timers[id]?.token || 0) + 1;
    timers[id] = { token, running:true, start:t };
    schedule(t + timeout, now => { if (!S.done && timers[id]?.token === token && timers[id].running) onTimeout(now, id); });
  };
  const stopTimer = id => { if (timers[id]) timers[id].running = false; };
  let onTimeout = () => {};

  if (protocol === "rdt20" || protocol === "rdt21" || protocol === "rdt30") {
    // ── stop-and-wait family ──
    const seqOf = m => (protocol === "rdt20" ? null : m % 2);
    const pkt = m => (protocol === "rdt20" ? `pkt (msg ${m})` : `pkt${m % 2} (msg ${m})`);
    const sendCur = (t, retrans) => {
      const at = slot(t);
      S.next = S.base + 1;
      transmit("S", "data", S.base, seqOf(S.base), at, pkt(S.base));
      if (retrans) sNote(at, `resends ${pkt(S.base)}`, "warn");
      if (protocol === "rdt30") startTimer(at);
      snap(at);
    };
    const advance = t => {
      S.acked.add(S.base);
      S.base += 1;
      S.next = S.base;
      snap(t);
      if (S.base >= M) { S.done = true; S.doneAt = t; sNote(t, "all messages acknowledged", "good"); }
      else sendCur(t, false);
    };
    let expect = 0; // rdt2.1 / 3.0 receiver: expected sequence bit

    sendr = (tx, t) => {
      if (S.done) return;
      if (protocol === "rdt30") {
        if (tx.fate === "corrupt") { sNote(t, `corrupted ${tx.label} — ignored, wait for timeout`, "warn"); return; }
        if (tx.seq !== S.base % 2 || S.done) { sNote(t, `${tx.label} is for the previous packet — ignored`, "info"); return; }
        stopTimer("only");
        sNote(t, `got ${tx.label} → next message`, "good");
        advance(t);
        return;
      }
      if (tx.fate === "corrupt") {
        sNote(t, protocol === "rdt20"
          ? "garbled ACK/NAK — can't tell which, so it resends (the receiver can't spot the duplicate)"
          : "garbled ACK/NAK — resends; the sequence number lets the receiver spot a duplicate", "warn");
        sendCur(t, true);
      } else if (tx.kind === "nak") {
        sNote(t, "got NAK → resend", "warn");
        sendCur(t, true);
      } else {
        sNote(t, "got ACK → next message", "good");
        advance(t);
      }
    };

    recv = (tx, t) => {
      if (protocol === "rdt30") {
        if (tx.fate === "corrupt" || tx.seq !== expect) {
          const last = expect ^ 1;
          rNote(t, tx.fate === "corrupt" ? `${tx.label} corrupted — re-ACK${last}` : `duplicate ${tx.label} — discard, re-ACK${last}`, "warn");
          transmit("R", "ack", tx.msg, last, t, `ACK${last}`);
          return;
        }
        deliver(t, tx.msg);
        transmit("R", "ack", tx.msg, expect, t, `ACK${expect}`);
        expect ^= 1;
        R.base = tx.msg + 1;
        snap(t);
        return;
      }
      if (tx.fate === "corrupt") {
        rNote(t, `${tx.label} corrupted → NAK`, "warn");
        transmit("R", "nak", tx.msg, null, t, "NAK");
        return;
      }
      if (protocol === "rdt21" && tx.seq !== expect) {
        rNote(t, `duplicate ${tx.label} — ACK again, don't deliver`, "warn");
        transmit("R", "ack", tx.msg, null, t, "ACK");
        return;
      }
      deliver(t, tx.msg);
      if (protocol === "rdt21") expect ^= 1;
      R.base = Math.max(R.base, tx.msg + 1);
      transmit("R", "ack", tx.msg, null, t, "ACK");
      snap(t);
    };

    onTimeout = t => {
      sNote(t, `timeout! resend ${pkt(S.base)}`, "bad");
      sendCur(t, true);
    };
    sendCur(0, false);
  } else if (protocol === "gbn") {
    // ── Go-Back-N ──
    const trySend = t => {
      while (S.next < S.base + N && S.next < M) {
        const at = slot(t);
        if (S.base === S.next) startTimer(at);
        transmit("S", "data", S.next, S.next, at, `pkt${S.next}`);
        S.next += 1;
        snap(at);
      }
    };
    let expected = 0;
    sendr = (tx, t) => {
      if (S.done) return;
      if (tx.fate === "corrupt") { sNote(t, `corrupted ${tx.label} — ignored`, "warn"); return; }
      if (tx.seq < S.base) { sNote(t, `${tx.label} (duplicate, already past) — ignored`, "info"); return; }
      S.base = tx.seq + 1;
      for (let k = 0; k < S.base; k++) S.acked.add(k);
      sNote(t, `got ${tx.label} → base = ${S.base}`, "good");
      if (S.base === S.next) stopTimer("only"); else startTimer(t);
      snap(t);
      if (S.base >= M) { S.done = true; S.doneAt = t; sNote(t, "all packets acknowledged", "good"); return; }
      trySend(t);
    };
    recv = (tx, t) => {
      if (tx.fate === "corrupt" || tx.seq !== expected) {
        rNote(t, `${tx.fate === "corrupt" ? "corrupted" : "out-of-order"} ${tx.label} — discard, re-send ACK${expected - 1}`, "warn");
        transmit("R", "ack", tx.msg, expected - 1, t, `ACK${expected - 1}`);
        return;
      }
      deliver(t, tx.msg);
      transmit("R", "ack", tx.msg, expected, t, `ACK${expected}`);
      expected += 1;
      R.base = expected;
      snap(t);
    };
    onTimeout = t => {
      sNote(t, `timeout! go back: resend pkt${S.base}${S.next - 1 > S.base ? `–pkt${S.next - 1}` : ""}`, "bad");
      startTimer(t);
      for (let k = S.base; k < S.next; k++) {
        const at = slot(t);
        transmit("S", "data", k, k, at, `pkt${k}`);
      }
    };
    trySend(0);
  } else if (protocol === "sr") {
    // ── Selective Repeat ──
    const sendOne = (t, k, retrans) => {
      const at = slot(t);
      transmit("S", "data", k, k, at, `pkt${k}`);
      startTimer(at, k);
      if (retrans) sNote(at, `resends only pkt${k}`, "warn");
      return at;
    };
    const trySend = t => {
      while (S.next < S.base + N && S.next < M) {
        const at = sendOne(t, S.next, false);
        S.next += 1;
        snap(at);
      }
    };
    sendr = (tx, t) => {
      if (S.done) return;
      if (tx.fate === "corrupt") { sNote(t, `corrupted ${tx.label} — ignored`, "warn"); return; }
      const k = tx.seq;
      if (k < S.base || k >= S.next || S.acked.has(k)) { sNote(t, `${tx.label} already handled — ignored`, "info"); return; }
      S.acked.add(k);
      stopTimer(k);
      const before = S.base;
      while (S.acked.has(S.base)) S.base += 1;
      sNote(t, S.base !== before ? `got ${tx.label} → window slides to ${S.base}` : `got ${tx.label} — marked, window waits for pkt${S.base}`, S.base !== before ? "good" : "info");
      snap(t);
      if (S.base >= M) { S.done = true; S.doneAt = t; sNote(t, "all packets acknowledged", "good"); return; }
      trySend(t);
    };
    recv = (tx, t) => {
      if (tx.fate === "corrupt") { rNote(t, `corrupted ${tx.label} — ignored`, "warn"); return; }
      const k = tx.seq;
      if (k >= R.base && k < R.base + N) {
        transmit("R", "ack", tx.msg, k, t, `ACK${k}`);
        if (R.delivered.has(k) || R.buffered.has(k)) { rNote(t, `duplicate ${tx.label} — ACK again`, "warn"); return; }
        if (k !== R.base) {
          R.buffered.add(k);
          rNote(t, `${tx.label} out of order — buffer it, ACK${k}`, "info");
        } else {
          deliver(t, k);
          R.base += 1;
          while (R.buffered.has(R.base)) { R.buffered.delete(R.base); deliver(t, R.base); R.base += 1; }
        }
        snap(t);
      } else if (k >= R.base - N && k < R.base) {
        rNote(t, `old ${tx.label} — already delivered, ACK${k} again`, "warn");
        transmit("R", "ack", tx.msg, k, t, `ACK${k}`);
      } else {
        rNote(t, `${tx.label} outside the window — ignored`, "info");
      }
    };
    onTimeout = (t, k) => {
      if (S.acked.has(k)) return;
      sNote(t, `timeout for pkt${k}!`, "bad");
      sendOne(t, k, true);
    };
    trySend(0);
  } else if (protocol === "tcp") {
    // ── TCP (Kurose §3.5.4): byte sequence numbers, cumulative ACKs, one timer, fast retransmit ──
    const seqs = [];
    segSizes.reduce((acc, size, i) => { seqs[i] = acc; return acc + size; }, isn);
    const endOf = i => seqs[i] + segSizes[i];
    const label = i => `Seq=${seqs[i]}, ${segSizes[i]} B`;
    let dupCount = 0;
    const sendSeg = (t, i, why) => {
      const at = slot(t);
      transmit("S", "data", i, seqs[i], at, label(i));
      if (why) sNote(at, why, why.startsWith("fast") ? "warn" : "bad");
      return at;
    };
    const trySend = t => {
      while (S.next < S.base + N && S.next < M) {
        const at = sendSeg(t, S.next);
        if (!timers.only?.running) startTimer(at);
        S.next += 1;
        snap(at);
      }
    };
    sendr = (tx, t) => {
      if (S.done) return;
      if (tx.fate === "corrupt") { sNote(t, `corrupted ${tx.label} — discarded`, "warn"); return; }
      const ack = tx.seq;
      if (ack > seqs[S.base]) {
        const before = S.base;
        while (S.base < M && endOf(S.base) <= ack) { S.acked.add(S.base); S.base += 1; }
        dupCount = 0;
        sNote(t, `${tx.label}: bytes up to ${ack - 1} confirmed → SendBase = ${ack}${S.base - before > 1 ? " (cumulative)" : ""}`, "good");
        snap(t);
        if (S.base >= M) { S.done = true; S.doneAt = t; stopTimer("only"); sNote(t, "all bytes acknowledged", "good"); return; }
        if (S.base < S.next) startTimer(t); else stopTimer("only");
        trySend(t);
      } else {
        dupCount += 1;
        sNote(t, `duplicate ${tx.label} (#${dupCount})`, "warn");
        if (dupCount === 3 && fastRetransmit) {
          sendSeg(t, S.base, `fast retransmit Seq=${seqs[S.base]} after 3 duplicate ACKs`);
        }
      }
    };
    let rcvNext = isn;
    const buffered = new Set();
    recv = (tx, t) => {
      if (tx.fate === "corrupt") { rNote(t, `corrupted ${tx.label} — checksum fails, discarded`, "warn"); return; }
      const i = tx.msg;
      if (tx.seq === rcvNext) {
        deliver(t, i);
        rcvNext = endOf(i);
        R.base = i + 1;
        while ([...buffered].some(k => seqs[k] === rcvNext)) {
          const k = [...buffered].find(x => seqs[x] === rcvNext);
          buffered.delete(k);
          R.buffered.delete(k);
          deliver(t, k);
          rcvNext = endOf(k);
          R.base = k + 1;
        }
      } else if (tx.seq > rcvNext) {
        if (!buffered.has(i)) { buffered.add(i); R.buffered.add(i); }
        rNote(t, `${tx.label} arrived early (expected ${rcvNext}) — buffer it, ACK=${rcvNext} again`, "warn");
      } else {
        rNote(t, `${tx.label} already received — ACK=${rcvNext}`, "info");
      }
      transmit("R", "ack", i, rcvNext, t, `ACK=${rcvNext}`);
      snap(t);
    };
    onTimeout = t => {
      sendSeg(t, S.base, `timeout! resend Seq=${seqs[S.base]} (only the oldest unACKed segment)`);
      dupCount = 0;
      startTimer(t);
    };
    trySend(0);
  } else {
    return { error:`Unknown protocol ${protocol}` };
  }

  // ── run (keeps going after completion so in-flight packets and late ACKs are shown) ──
  let now = 0;
  snap(0);
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t || a.o - b.o);
    const ev = queue.shift();
    if (ev.t > tMax) break;
    now = ev.t;
    ev.fn(ev.t);
  }
  if (!S.done) {
    S.stuck = true;
    sNote(now, PROTOCOLS[protocol].timer
      ? "simulation stopped"
      : "stuck — waiting forever. With no timer, a lost packet or ACK means deadlock.", "bad");
  }

  const dataTx = txs.filter(x => x.kind === "data");
  const retrans = dataTx.filter(x => x.attempt > 1).length;
  const dups = deliveries.filter(d => d.dup).length;
  const end = Math.max(now, ...txs.map(x => x.t1), 0);
  const boxLabels = segSizes
    ? segSizes.map((_, i) => segSizes.slice(0, i).reduce((a, b) => a + b, isn))
    : null;
  return {
    protocol, M, N, timeout, D, dt, boxLabels, sizes:segSizes,
    txs, sNotes, rNotes, deliveries, snaps,
    done:S.done, stuck:S.stuck, end,
    stats: {
      sent: dataTx.length, retrans, dups,
      delivered: new Set(deliveries.map(d => d.msg)).size,
      finish: S.done ? S.doneAt : null,
      // Kurose's sender utilization: fraction of time the sender is busy sending
      utilization: Math.min(1, (N * dt) / (dt + 2 * D)),
    },
  };
}

// Window state at time t (the latest snapshot at or before t)
export function stateAt(sim, t) {
  let s = sim.snaps[0];
  for (const x of sim.snaps) { if (x.t <= t + 1e-9) s = x; else break; }
  return s;
}

// Scenarios that recreate the lecture figures
export const SCENARIOS = [
  { id:"r20-ok", protocol:"rdt20", name:"rdt2.0: operation with no errors", faults:{} },
  { id:"r20-pkt", protocol:"rdt20", name:"rdt2.0: corrupted packet → NAK", faults:{ "d1#1":"corrupt" } },
  { id:"r20-flaw", protocol:"rdt20", name:"rdt2.0's fatal flaw: garbled ACK", faults:{ "a1#1":"corrupt" } },
  { id:"r21-flaw", protocol:"rdt21", name:"rdt2.1 fixes it with sequence numbers", faults:{ "a1#1":"corrupt" } },
  { id:"r21-loss", protocol:"rdt21", name:"rdt2.1 with a lost packet (deadlock)", faults:{ "d1#1":"lost" } },
  { id:"r30-loss", protocol:"rdt30", name:"rdt3.0: packet loss", faults:{ "d1#1":"lost" } },
  { id:"r30-ack", protocol:"rdt30", name:"rdt3.0: ACK loss", faults:{ "a1#1":"lost" } },
  { id:"r30-early", protocol:"rdt30", name:"rdt3.0: premature timeout", faults:{}, timeout:2.1 },
  { id:"gbn-loss", protocol:"gbn", name:"Go-Back-N in action: pkt2 lost", faults:{ "d2#1":"lost" }, packets:8, window:4 },
  { id:"sr-loss", protocol:"sr", name:"Selective Repeat in action: pkt2 lost", faults:{ "d2#1":"lost" }, packets:8, window:4 },
  { id:"tcp-lostack", protocol:"tcp", name:"TCP: lost ACK scenario", sizes:[8], isn:92, window:1, faults:{ "a0#1":"lost" } },
  { id:"tcp-early", protocol:"tcp", name:"TCP: premature timeout", sizes:[8, 20], isn:92, window:2, timeout:2.2, faults:{} },
  { id:"tcp-cumulative", protocol:"tcp", name:"TCP: cumulative ACK covers a lost ACK", sizes:[8, 20], isn:92, window:2, faults:{ "a0#1":"lost" } },
  { id:"tcp-fast", protocol:"tcp", name:"TCP fast retransmit (3 duplicate ACKs)", sizes:[8, 20, 20, 20, 20], isn:92, window:5, timeout:6, faults:{ "d1#1":"lost" } },
  { id:"tcp-ex", protocol:"tcp", name:"Exercise: SEQ 300 lost (100-byte segments)", sizes:[100, 100, 100, 100, 100], isn:100, window:5, faults:{ "d2#1":"lost" } },
];

// ── TCP RTT estimation (Kurose §3.5.3) ──
// DevRTT uses the EstimatedRTT from *before* this sample, matching the lecture's worked answer.
export function rttEstimate(est0, dev0, samples, alpha = 0.125, beta = 0.25) {
  let est = est0, dev = dev0;
  return samples.map(sample => {
    const newEst = (1 - alpha) * est + alpha * sample;
    const newDev = (1 - beta) * dev + beta * Math.abs(sample - est);
    const row = { sample, prevEst:est, prevDev:dev, est:newEst, dev:newDev, timeout:newEst + 4 * newDev };
    est = newEst; dev = newDev;
    return row;
  });
}

// ── TCP congestion control, one row per transmission round (RTT), cwnd in MSS ──
// events: { [round]: "dup" | "timeout" } — the loss is detected at the end of that round.
export function congestion({ rounds = 20, ssthresh = 8, variant = "reno", events = {} }) {
  const rows = [];
  let cwnd = 1, th = ssthresh, phase = "slow start";
  for (let r = 1; r <= rounds; r++) {
    const ev = events[r] || null;
    rows.push({ round:r, cwnd, ssthresh:th, phase, event:ev });
    if (ev === "timeout" || (ev === "dup" && variant === "tahoe")) {
      th = cwnd / 2; cwnd = 1; phase = "slow start";
    } else if (ev === "dup") {
      th = cwnd / 2; cwnd = th + 3; phase = "fast recovery";
    } else if (phase === "slow start") {
      cwnd = Math.min(cwnd * 2, Math.max(th, cwnd + 1));
      if (cwnd >= th) phase = "congestion avoidance";
    } else {
      cwnd += 1; phase = "congestion avoidance";
    }
  }
  return rows;
}

// ── Internet checksum (one's-complement sum of 16-bit words) ──
export function parseWord(s) {
  const t = String(s ?? "").trim().replace(/[\s_]/g, "");
  if (/^0x[0-9a-f]{1,4}$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^[01]{16}$/.test(t)) return parseInt(t, 2);
  return null;
}
export const bin16 = n => n.toString(2).padStart(16, "0").replace(/(\d{4})(?=\d)/g, "$1 ");
export function checksum(words) {
  const vals = words.map(parseWord);
  if (!vals.length || vals.some(v => v === null)) return { error:"Enter 16-bit words in binary (16 digits) or hex (0x…)" };
  const steps = [];
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) {
    const raw = sum + vals[i];
    const wrapped = (raw & 0xffff) + (raw >> 16);
    steps.push({ a:sum, b:vals[i], raw, carry:raw > 0xffff, wrapped });
    sum = wrapped;
  }
  const result = (~sum) & 0xffff;
  return { vals, steps, sum, checksum:result, verify:((sum + result) & 0xffff) === 0xffff };
}

// ── TCP flow control, one row per round trip ──
// The sender sends min(rwnd, remaining) bytes; at rwnd = 0 it sends a 1-byte probe.
export function flowControl({ file = 4096, buffer = 3072, reads = { 3:2048 }, rounds = 8 }) {
  const rows = [];
  let remaining = file, buffered = 0, rwnd = buffer, appGot = 0;
  for (let r = 1; r <= rounds && (remaining > 0 || buffered > 0); r++) {
    const read = Math.min(reads[r] || 0, buffered);
    buffered -= read; appGot += read;
    let sent = 0, probe = false, accepted = 0;
    if (remaining > 0) {
      if (rwnd > 0) sent = Math.min(rwnd, remaining);
      else { sent = 1; probe = true; }
      accepted = Math.min(sent, buffer - buffered);
      buffered += accepted; remaining -= accepted;
    }
    const before = rwnd;
    rwnd = buffer - buffered;
    rows.push({ round:r, rwndKnown:before, read, sent, probe, accepted, rejected:sent - accepted, buffered, rwnd, remaining, appGot });
    if (remaining === 0 && !Object.keys(reads).some(k => Number(k) > r)) break;
  }
  return rows;
}
