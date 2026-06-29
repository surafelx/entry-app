// Shared formatting + aggregation helpers used across views.
const API_BASE = "https://143b-196-188-242-241.ngrok-free.app";

export const STATUS = {
  ingested: { c: "#6B6862", label: "Ingested" },
  transcribing: { c: "#4D5DFF", label: "Transcribing" },
  analyzing: { c: "#4D5DFF", label: "Analyzing" },
  ready: { c: "#FF4D2E", label: "Ready" },
  error: { c: "#C2362A", label: "Error" },
};

export const WORKING = ["ingested", "transcribing", "analyzing"];

// Cloudinary URLs used directly. Local /media/ paths go through the server.
const mediaUrl = (p) => {
  if (!p) return "";
  if (p.startsWith("http")) return p;
  return `${API_BASE}${p}`;
};

export const playSrc = (e) => mediaUrl(e.cartoonPath || e.compressedPath || e.mediaPath);
export const thumbSrc = (e) => mediaUrl(e.ditherPath || e.posterPath);

export const sentimentEmoji = (v) =>
  v == null ? "" : v > 0.25 ? "😊" : v < -0.25 ? "😔" : "😐";

export const moodLabel = (v) =>
  v == null
    ? "—"
    : v > 0.4
    ? "Bright"
    : v > 0.1
    ? "Warm"
    : v < -0.4
    ? "Heavy"
    : v < -0.1
    ? "Low"
    : "Even";

export function timeAgo(date) {
  const s = (Date.now() - new Date(date)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const fmtShort = (d) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const fmtDate = (d) =>
  new Date(d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export const fmtTime = (d) =>
  new Date(d).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

export function aggregateLife(entries) {
  const ready = entries.filter((e) => e.analysis);
  const byDomain = {};
  for (const e of ready) {
    for (const s of e.analysis.lifeSections || []) {
      (byDomain[s.domain] ||= []).push({
        ...s,
        recordedAt: e.recordedAt,
        title: e.title,
        id: e._id,
        entry: e,
      });
    }
  }
  const domains = Object.entries(byDomain)
    .map(([domain, notes]) => ({
      domain,
      notes: notes.sort(
        (a, b) => new Date(b.recordedAt) - new Date(a.recordedAt)
      ),
    }))
    .sort((a, b) => b.notes.length - a.notes.length);

  const sentiments = ready
    .map((e) => e.analysis.sentiment)
    .filter((v) => v != null);
  const avg = sentiments.length
    ? sentiments.reduce((s, v) => s + v, 0) / sentiments.length
    : null;
  const arcTally = ready.reduce((m, e) => {
    const t = e.analysis.trajectory;
    m[t] = (m[t] || 0) + 1;
    return m;
  }, {});
  const topArc = Object.entries(arcTally).sort((a, b) => b[1] - a[1])[0]?.[0];

  return { ready, domains, avg, topArc, total: ready.length };
}

export function recommendTasks(entries) {
  const out = [];
  const seen = new Set();
  const push = (text, kind, entry) => {
    const key = text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ id: key, text: text.trim(), kind, entry });
  };
  const ready = entries.filter((e) => e.analysis);
  for (const e of ready) {
    for (const idea of (e.analysis.ideas || []).filter((i) => i.novelty >= 0.5)) {
      push(idea.text, "idea", e);
    }
  }
  for (const e of ready) {
    for (const f of e.analysis.followUps || []) push(f, "thread", e);
  }
  return out.slice(0, 6);
}
