import { useState, useRef, useEffect, useMemo } from "react";
import { sentimentEmoji, timeAgo } from "./lib.js";

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

    const pad = { t: 16, b: 20, l: 24, r: 8 };
    const gw = w - pad.l - pad.r;
    const gh = h - pad.t - pad.b;

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (gh / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
    }

    ctx.fillStyle = COLORS.dim;
    ctx.font = "8px 'Space Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText("+", pad.l - 4, pad.t + 6);
    ctx.fillText("0", pad.l - 4, pad.t + gh / 2 + 3);
    ctx.fillText("-", pad.l - 4, pad.t + gh + 4);

    const points = ready.map((e, i) => ({
      x: pad.l + (i / Math.max(1, ready.length - 1)) * gw,
      y: pad.t + gh / 2 - (e.analysis.sentiment * gh / 2),
      s: e.analysis.sentiment,
    }));

    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + gh);
    grad.addColorStop(0, "rgba(34,197,94,0.12)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.01)");
    grad.addColorStop(1, "rgba(239,68,68,0.12)");
    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.t + gh / 2);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, pad.t + gh / 2);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = p.s > 0.25 ? COLORS.green : p.s < -0.25 ? COLORS.accent : COLORS.dim;
      ctx.fill();
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
    const cx = w * 0.32;
    const cy = h / 2;
    const r = Math.min(cx - 10, cy - 10, 60);
    const palette = [COLORS.accent, COLORS.blue, COLORS.green, "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899"];

    let angle = -Math.PI / 2;
    domainMap.forEach(([_, count], i) => {
      const slice = (count / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = palette[i % palette.length];
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
      angle += slice;
    });

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#09090b";
    ctx.fill();

    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 16px 'Unbounded', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(total, cx, cy - 4);
    ctx.font = "7px 'Space Mono', monospace";
    ctx.fillStyle = COLORS.dim;
    ctx.fillText("TOTAL", cx, cy + 10);

    const lx = w * 0.62;
    let ly = 10;
    domainMap.slice(0, 5).forEach(([domain, count], i) => {
      ctx.fillStyle = palette[i % palette.length];
      ctx.beginPath();
      ctx.arc(lx, ly, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.font = "10px 'Space Grotesk', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(domain, lx + 8, ly);
      ly += 18;
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
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
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

    const nodes = topics.map(([topic, count], i) => {
      const angle = (i / topics.length) * Math.PI * 2 - Math.PI / 2;
      const dist = 30 + (1 - count / maxCount) * 50;
      return {
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        r: 6 + (count / maxCount) * 10,
        topic, count,
      };
    });

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    nodes.forEach((a, i) => {
      nodes.forEach((b, j) => {
        if (j <= i) return;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 100) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      });
    });

    nodes.forEach(n => {
      const alpha = 0.3 + (n.count / maxCount) * 0.7;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(239,68,68,${alpha * 0.25})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(239,68,68,${alpha * 0.5})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = `rgba(255,255,255,${0.5 + alpha * 0.5})`;
      ctx.font = `${n.r > 12 ? 9 : 7}px 'Space Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(n.topic, n.x, n.y);
    });
  }, [topics]);

  return <canvas ref={canvasRef} className="viz-canvas" />;
}

function OverallSummary({ entries }) {
  const stats = useMemo(() => {
    const ready = entries.filter(e => e.analysis);
    const sentiments = ready.map(e => e.analysis.sentiment).filter(s => s != null);
    const avg = sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0;
    const topics = {};
    ready.forEach(e => (e.analysis.topics || []).forEach(t => topics[t] = (topics[t] || 0) + 1));
    const topTopics = Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const arcs = {};
    ready.forEach(e => { const t = e.analysis.trajectory; if (t) arcs[t] = (arcs[t] || 0) + 1; });
    const topArc = Object.entries(arcs).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    const totalDur = ready.reduce((s, e) => s + (e.durationSec || 0), 0);
    return { total: ready.length, avg, topTopics, topArc, totalDur };
  }, [entries]);

  const moodLabel = stats.avg > 0.25 ? "positive" : stats.avg < -0.25 ? "heavy" : "balanced";
  const mood = stats.avg > 0.25 ? "😊" : stats.avg < -0.25 ? "😔" : "😐";

  return (
    <div className="viz-summary">
      <p className="viz-summary-text">
        {mood} overall mood is <b>{moodLabel}</b> across {stats.total} moments.
        {stats.topTopics.length > 0 && (
          <> dominant themes: {stats.topTopics.map(([t]) => t).join(", ")}.</>
        )}
        {" "}arc tends toward <b>{stats.topArc}</b>.
      </p>
      <div className="viz-summary-row">
        <span className="viz-summary-stat"><b>{stats.total}</b> moments</span>
        <span className="viz-summary-stat"><b>{Math.round(stats.totalDur / 60)}m</b> recorded</span>
        <span className="viz-summary-stat"><b>{stats.topTopics.length}</b> unique topics</span>
        <span className="viz-summary-stat"><b>{moodLabel}</b> avg mood</span>
      </div>
    </div>
  );
}

export default function Visuals({ entries, onBack }) {
  const [tab, setTab] = useState("mood");

  return (
    <div className="viz-view">
      <div className="viz-head">
        <button className="back-btn" onClick={onBack}>← back</button>
        <span className="viz-title">insights</span>
        <div className="viz-tabs">
          <button className={`viz-tab ${tab === "mood" ? "on" : ""}`} onClick={() => setTab("mood")}>mood</button>
          <button className={`viz-tab ${tab === "domains" ? "on" : ""}`} onClick={() => setTab("domains")}>domains</button>
          <button className={`viz-tab ${tab === "topics" ? "on" : ""}`} onClick={() => setTab("topics")}>topics</button>
        </div>
      </div>

      <div className="viz-grid">
        <div className="viz-chart">
          <div className="viz-chart-label">{tab}</div>
          {tab === "mood" && <MoodGraph entries={entries} />}
          {tab === "domains" && <DomainChart entries={entries} />}
          {tab === "topics" && <TopicMindmap entries={entries} />}
        </div>

        <OverallSummary entries={entries} />
      </div>
    </div>
  );
}
