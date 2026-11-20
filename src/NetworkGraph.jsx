import { useEffect, useRef, useMemo, useState } from "react";

const INTERNAL_PREFIXES = ["192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31."];
const isInternal = (ip) => ip !== "—" && INTERNAL_PREFIXES.some(p => ip.startsWith(p));

const PROTO_COLORS = { TCP: "#63B3ED", UDP: "#42D9B8", ICMP: "#F2C36B", DNS: "#A78BFA", Unknown: "#666" };
function protoColor(p) { return PROTO_COLORS[p] || "#63B3ED"; }

function buildGraph(packets) {
  const nodeMap = new Map();
  const edgeMap = new Map();

  for (const pkt of packets) {
    const src = pkt.src_ip;
    const dst = pkt.dst_ip;
    if (!src || !dst || src === "—" || dst === "—") continue;

    if (!nodeMap.has(src)) nodeMap.set(src, { id: src, internal: isInternal(src), degree: 0, bytes: 0 });
    if (!nodeMap.has(dst)) nodeMap.set(dst, { id: dst, internal: isInternal(dst), degree: 0, bytes: 0 });

    nodeMap.get(src).degree++;
    nodeMap.get(src).bytes += pkt.bytes || 0;

    const key = `${src}→${dst}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { src, dst, count: 0, bytes: 0, protocol: pkt.protocol || "Unknown", dots: [] });
    }
    const edge = edgeMap.get(key);
    edge.count++;
    edge.bytes += pkt.bytes || 0;
    if (!edge.protocol || edge.protocol === "Unknown") edge.protocol = pkt.protocol || "Unknown";
  }

  return {
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };
}

function initSimulation(nodes, edges, width, height) {
  // Place nodes in a circle initially
  const cx = width / 2, cy = height / 2;
  const r = Math.min(width, height) * 0.32;
  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    node.x = cx + r * Math.cos(angle) + (Math.random() - 0.5) * 20;
    node.y = cy + r * Math.sin(angle) + (Math.random() - 0.5) * 20;
    node.vx = 0;
    node.vy = 0;
  });
}

function tickSimulation(nodes, edges, width, height, alpha) {
  const REPULSION = 3200;
  const SPRING_LEN = 120;
  const SPRING_K = 0.04;
  const DAMPING = 0.78;
  const GRAVITY = 0.012;
  const cx = width / 2, cy = height / 2;

  // Reset forces
  for (const n of nodes) { n.fx = 0; n.fy = 0; }

  // Repulsion between all pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.fx -= fx; a.fy -= fy;
      b.fx += fx; b.fy += fy;
    }
  }

  // Spring attraction along edges
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  for (const edge of edges) {
    const a = nodeById.get(edge.src), b = nodeById.get(edge.dst);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - SPRING_LEN) * SPRING_K;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.fx += fx; a.fy += fy;
    b.fx -= fx; b.fy -= fy;
  }

  // Center gravity
  for (const n of nodes) {
    n.fx += (cx - n.x) * GRAVITY;
    n.fy += (cy - n.y) * GRAVITY;
  }

  // Integrate
  const PAD = 36;
  for (const n of nodes) {
    n.vx = (n.vx + n.fx * alpha) * DAMPING;
    n.vy = (n.vy + n.fy * alpha) * DAMPING;
    n.x = Math.max(PAD, Math.min(width - PAD, n.x + n.vx));
    n.y = Math.max(PAD, Math.min(height - PAD, n.y + n.vy));
  }
}

function spawnDots(edges) {
  const maxCount = Math.max(...edges.map(e => e.count), 1);
  for (const edge of edges) {
    const rate = 0.08 + (edge.count / maxCount) * 0.5;
    if (Math.random() < rate && edge.dots.length < 8) {
      edge.dots.push({ progress: 0, speed: 0.004 + Math.random() * 0.008 });
    }
    edge.dots.forEach(d => { d.progress += d.speed; });
    edge.dots = edge.dots.filter(d => d.progress < 1);
  }
}

function draw(ctx, nodes, edges, selectedId, width, height) {
  ctx.clearRect(0, 0, width, height);

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const maxDegree = Math.max(...nodes.map(n => n.degree), 1);

  // Draw edges
  for (const edge of edges) {
    const a = nodeById.get(edge.src), b = nodeById.get(edge.dst);
    if (!a || !b) continue;
    const highlighted = selectedId && (edge.src === selectedId || edge.dst === selectedId);
    const color = protoColor(edge.protocol);
    const alpha = highlighted ? 0.9 : selectedId ? 0.12 : 0.35;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
    ctx.lineWidth = highlighted ? 2 : 1;
    ctx.stroke();

    // Draw animated dots
    for (const dot of edge.dots) {
      const x = a.x + (b.x - a.x) * dot.progress;
      const y = a.y + (b.y - a.y) * dot.progress;
      ctx.beginPath();
      ctx.arc(x, y, highlighted ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = highlighted ? 0.95 : selectedId ? 0.2 : 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Arrowhead at destination
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const nodeR = 8 + (b.degree / maxDegree) * 10;
    const ax = b.x - (nodeR + 6) * Math.cos(angle);
    const ay = b.y - (nodeR + 6) * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - 7 * Math.cos(angle - 0.4), ay - 7 * Math.sin(angle - 0.4));
    ctx.lineTo(ax - 7 * Math.cos(angle + 0.4), ay - 7 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
    ctx.fill();
  }

  // Draw nodes
  for (const node of nodes) {
    const r = 8 + (node.degree / maxDegree) * 10;
    const isSelected = node.id === selectedId;
    const dimmed = selectedId && !isSelected;
    const fill = node.internal ? "#42D9B8" : "#E63946";
    const alpha = dimmed ? 0.25 : 1;

    // Glow for selected
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
      ctx.fillStyle = fill + "33";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill + (dimmed ? "40" : "cc");
    ctx.fill();
    ctx.strokeStyle = fill + (dimmed ? "30" : "ff");
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.stroke();

    // Label
    ctx.font = `${isSelected ? "bold " : ""}10px 'JetBrains Mono', monospace`;
    ctx.fillStyle = `rgba(241,245,249,${dimmed ? 0.2 : 0.85})`;
    ctx.textAlign = "center";
    ctx.fillText(node.id, node.x, node.y + r + 13);
  }
}

export default function NetworkGraph({ packets }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const rafRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  const graph = useMemo(() => buildGraph(packets), [packets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph.nodes.length) return;

    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    const ctx = canvas.getContext("2d");
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const nodes = graph.nodes.map(n => ({ ...n }));
    const edges = graph.edges.map(e => ({ ...e, dots: [] }));

    initSimulation(nodes, edges, width, height);
    stateRef.current = { nodes, edges, width, height, selectedId: null };

    let tick = 0;
    function loop() {
      const s = stateRef.current;
      const alpha = tick < 120 ? 1 : tick < 300 ? 0.3 : 0.05;
      if (tick < 400) tickSimulation(s.nodes, s.edges, s.width, s.height, alpha);
      spawnDots(s.edges);
      draw(ctx, s.nodes, s.edges, s.selectedId, s.width, s.height);
      tick++;
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [graph]);

  const handleClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !stateRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { nodes } = stateRef.current;
    const maxDegree = Math.max(...nodes.map(n => n.degree), 1);
    for (const node of nodes) {
      const r = 8 + (node.degree / maxDegree) * 10 + 4;
      if ((mx - node.x) ** 2 + (my - node.y) ** 2 <= r * r) {
        const newId = stateRef.current.selectedId === node.id ? null : node.id;
        stateRef.current.selectedId = newId;
        setSelectedNode(newId ? node : null);
        return;
      }
    }
    stateRef.current.selectedId = null;
    setSelectedNode(null);
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !stateRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { nodes } = stateRef.current;
    const maxDegree = Math.max(...nodes.map(n => n.degree), 1);
    for (const node of nodes) {
      const r = 8 + (node.degree / maxDegree) * 10 + 4;
      if ((mx - node.x) ** 2 + (my - node.y) ** 2 <= r * r) {
        canvas.style.cursor = "pointer";
        setHoveredNode(node.id);
        return;
      }
    }
    canvas.style.cursor = "default";
    setHoveredNode(null);
  };

  const selectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return graph.edges.filter(e => e.src === selectedNode.id || e.dst === selectedNode.id);
  }, [selectedNode, graph.edges]);

  if (!graph.nodes.length) {
    return <div className="ws-graph-empty">No IP connections found in this capture.</div>;
  }

  return (
    <div className="ws-graph-wrap">
      <div className="ws-graph-legend">
        <div className="ws-graph-legend-row">
          <span className="ws-graph-dot" style={{ background: "#42D9B8" }} />
          <span>Internal IP</span>
        </div>
        <div className="ws-graph-legend-row">
          <span className="ws-graph-dot" style={{ background: "#E63946" }} />
          <span>External IP</span>
        </div>
        <div className="ws-graph-legend-row">
          <span className="ws-graph-line" style={{ background: "#63B3ED" }} />
          <span>TCP</span>
        </div>
        <div className="ws-graph-legend-row">
          <span className="ws-graph-line" style={{ background: "#42D9B8" }} />
          <span>UDP</span>
        </div>
        <div className="ws-graph-legend-sep" />
        <span className="ws-graph-hint">Click a node to inspect it</span>
        <span className="ws-graph-hint">Node size = connection count</span>
        <span className="ws-graph-hint">Dots = live packet flow</span>
      </div>

      <div className="ws-graph-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="ws-graph-canvas"
          onClick={handleClick}
          onMouseMove={handleMouseMove}
        />
      </div>

      <div className="ws-graph-info">
        <div className="ws-graph-counts">
          <div className="ws-graph-count-row">
            <span>{graph.nodes.length}</span>
            <span>IP addresses</span>
          </div>
          <div className="ws-graph-count-row">
            <span>{graph.edges.length}</span>
            <span>connections</span>
          </div>
        </div>

        {selectedNode ? (
          <div className="ws-graph-detail">
            <div className="ws-graph-detail-ip">
              <span className="ws-graph-ip-dot" style={{ background: selectedNode.internal ? "#42D9B8" : "#E63946" }} />
              <strong>{selectedNode.id}</strong>
              <span className="ws-graph-ip-tag">{selectedNode.internal ? "Internal" : "External"}</span>
            </div>
            <div className="ws-graph-detail-stats">
              <div><span>Connections</span><strong>{selectedNode.degree}</strong></div>
              <div><span>Data sent</span><strong>{selectedNode.bytes > 1048576 ? `${(selectedNode.bytes / 1048576).toFixed(1)} MB` : `${(selectedNode.bytes / 1024).toFixed(0)} KB`}</strong></div>
            </div>
            <div className="ws-graph-detail-edges">
              {selectedEdges.slice(0, 6).map((e, i) => {
                const other = e.src === selectedNode.id ? e.dst : e.src;
                const dir = e.src === selectedNode.id ? "→" : "←";
                return (
                  <div key={i} className="ws-graph-edge-row">
                    <span className="ws-graph-edge-dir">{dir}</span>
                    <span className="ws-graph-edge-ip">{other}</span>
                    <span className="ws-graph-edge-proto" style={{ color: protoColor(e.protocol) }}>{e.protocol}</span>
                    <span className="ws-graph-edge-count">{e.count} pkts</span>
                  </div>
                );
              })}
              {selectedEdges.length > 6 && <div className="ws-graph-more">+{selectedEdges.length - 6} more</div>}
            </div>
          </div>
        ) : (
          <div className="ws-graph-no-select">
            <span>Select a node<br />to see its connections</span>
          </div>
        )}
      </div>
    </div>
  );
}
