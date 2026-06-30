import { useState, useRef, useEffect, useMemo } from "react";
import { sentimentEmoji } from "./lib.js";

const COLORS = {
  accent: "#ef4444",
  blue: "#4d5dff",
  green: "#22c55e",
  muted: "rgba(255,255,255,0.3)",
  glass: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.1)",
  text: "rgba(255,255,255,0.85)",
  dim: "rgba(255,255,255,0.4)",
};

function MoodGraph({ entries }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.scale(dpr, dpr);

    const ready = entries.filter(e => e.analysis?.sentiment != null).slice().reverse();
    if (!ready.length) return;

    const pad = { t: 20, b: 24, l: 28, r: 12 };
    const gw = w - pad.l - pad.r;
    const gh = h - pad.t - pad.b;

    // grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (gh / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
    }

    // mood labels
    ctx.fillStyle = COLORS.dim;
    ctx.font = "9px 'Space Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText("😊", pad.l - 4, pad.t + 6);
    ctx.fillText("😐", pad.l - 4, pad.t + gh / 2 + 3);
    ctx.fillText("😔", pad.l - 4, pad.t + gh + 4);

    // line + dots
    const points = ready.map((e, i) => ({
      x: pad.l + (i / Math.max(1, ready.length - 1)) * gw,
      y: pad.t + gh / 2 - (e.analysis.sentiment * gh / 2),
      s: e.analysis.sentiment,
      t: e.title || "",
    }));

    // gradient fill under line
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + gh);
    grad.addColorStop(0, "rgba(34,197,94,0.15)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.02)");
    grad.addColorStop(1, "rgba(239,68,68,0.15)");
    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.t + gh / 2);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, pad.t + gh / 2);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // dots
    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = p.s > 0.25 ? COLORS.green : p.s < -0.25 ? COLORS.accent : COLORS.dim;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }, [entries]);

  return <canvas ref={canvasRef} className="viz-canvas" />;
}

function DomainChart({ entries }) {
  const canvasRef = useRef(null);
  const domainMap = useMemo(() => {
    const map = {};
    entries.forEach(e => {
      (e.analysis?.lifeSections || []).forEach(s => {
        map[s.domain] = (map[s.domain] || 0) + 1;
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !domainMap.length) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.scale(dpr, dpr);

    const total = domainMap.reduce((s, d) => s + d[1], 0);
    const cx = w * 0.35;
    const cy = h / 2;
    const r = Math.min(cx - 12, cy - 12, 70);
    const palette = [COLORS.accent, COLORS.blue, COLORS.green, "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899"];

    let angle = -Math.PI / 2;
    domainMap.forEach(([domain, count], i) => {
      const slice = (count / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = palette[i % palette.length];
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
      angle += slice;
    });

    // center hole
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "#09090b";
    ctx.fill();

    // center text
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 18px 'Unbounded', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(total, cx, cy - 6);
    ctx.font = "8px 'Space Mono', monospace";
    ctx.fillStyle = COLORS.dim;
    ctx.fillText("MOMENTS", cx, cy + 10);

    // legend
    const lx = w * 0.65;
    let ly = 14;
    domainMap.slice(0, 6).forEach(([domain, count], i) => {
      ctx.fillStyle = palette[i % palette.length];
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.font = "11px 'Space Grotesk', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(domain, lx + 10, ly);
      ctx.fillStyle = COLORS.dim;
      ctx.font = "9px 'Space Mono', monospace";
      ctx.fillText(`${count}`, lx + 10 + ctx.measureText(domain).width + 6, ly);
      ly += 20;
    });
  }, [domainMap]);

  return <canvas ref={canvasRef} className="viz-canvas" />;
}

function TopicMindmap({ entries }) {
  const canvasRef = useRef(null);
  const topics = useMemo(() => {
    const map = {};
    entries.forEach(e => {
      (e.analysis?.topics || []).forEach(t => {
        map[t] = (map[t] || 0) + 1;
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [entries]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !topics.length) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.scale(dpr, dpr);

    const maxCount = topics[0][1];
    const cx = w / 2;
    const cy = h / 2;

    // place nodes in a force-ish radial layout
    const nodes = topics.map(([topic, count], i) => {
      const angle = (i / topics.length) * Math.PI * 2 - Math.PI / 2;
      const dist = 40 + (1 - count / maxCount) * 60;
      return {
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        r: 8 + (count / maxCount) * 14,
        topic, count,
      };
    });

    // connections
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    nodes.forEach((a, i) => {
      nodes.forEach((b, j) => {
        if (j <= i) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 120) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      });
    });

    // nodes
    nodes.forEach(n => {
      const alpha = 0.3 + (n.count / maxCount) * 0.7;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(239,68,68,${alpha * 0.3})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(239,68,68,${alpha * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = `rgba(255,255,255,${0.6 + alpha * 0.4})`;
      ctx.font = `${n.r > 14 ? 10 : 8}px 'Space Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(n.topic, n.x, n.y);
    });
  }, [topics]);

  return <canvas ref={canvasRef} className="viz-canvas" />;
}

export default function Visuals({ entries }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("mood");

  if (!open) {
    return (
      <button className="viz-trigger" onClick={() => setOpen(true)} title="visuals">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18"/>
          <path d="M7 16l4-5 4 3 5-7"/>
        </svg>
      </button>
    );
  }

  return (
    <div className="viz-overlay" onClick={() => setOpen(false)}>
      <div className="viz-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viz-head">
          <span className="viz-title">insights</span>
          <div className="viz-tabs">
            <button className={`viz-tab ${tab === "mood" ? "on" : ""}`} onClick={() => setTab("mood")}>mood</button>
            <button className={`viz-tab ${tab === "domains" ? "on" : ""}`} onClick={() => setTab("domains")}>domains</button>
            <button className={`viz-tab ${tab === "topics" ? "on" : ""}`} onClick={() => setTab("topics")}>topics</button>
          </div>
          <button className="viz-close" onClick={() => setOpen(false)}>×</button>
        </div>
        <div className="viz-body">
          {tab === "mood" && <MoodGraph entries={entries} />}
          {tab === "domains" && <DomainChart entries={entries} />}
          {tab === "topics" && <TopicMindmap entries={entries} />}
        </div>
      </div>
    </div>
  );
}
