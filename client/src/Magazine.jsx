import { useEffect, useRef, useState } from "react";

const fmtDate = (d) =>
  new Date(d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const fmtTime = (d) =>
  new Date(d).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const TRAJ = { rising: "↗ Rising", flat: "→ Steady", falling: "↘ Falling" };

function sentimentLabel(v) {
  if (v == null) return "—";
  if (v > 0.4) return "Bright";
  if (v > 0.1) return "Warm";
  if (v < -0.4) return "Heavy";
  if (v < -0.1) return "Low";
  return "Even";
}

export default function Magazine({ entry, onClose, onEdit }) {
  const a = entry.analysis;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!a) {
    return (
      <div className="mag-wrap" onClick={onClose}>
        <div className="mag-card" onClick={(e) => e.stopPropagation()}>
          <button className="mag-close" onClick={onClose}>✕</button>
          <p className="dim">
            {entry.status === "error"
              ? "Analysis failed for this entry."
              : "Insights are still being drafted…"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mag-wrap" onClick={onClose}>
      <div className="mag-card" onClick={(e) => e.stopPropagation()}>
        {onEdit && entry.mediaPath && (
          <button className="mag-edit" onClick={() => onEdit(entry)}>
            ✂ Edit video
          </button>
        )}
        <button className="mag-close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="mag-head">
          <span className="mag-source">{entry.source.replace("_", " ")}</span>
          <span className="mag-sep">·</span>
          <span className="mag-date">{fmtDate(entry.recordedAt)}</span>
          <span className="mag-sep">·</span>
          <span className="mag-date">{fmtTime(entry.recordedAt)}</span>
          {entry.durationSec && (
            <>
              <span className="mag-sep">·</span>
              <span className="mag-date">{entry.durationSec}s</span>
            </>
          )}
        </div>

        <h1 className="mag-title">{entry.title || "An Untitled Moment"}</h1>
        {a.summary && <p className="mag-summary">{a.summary}</p>}

        {/* Stats */}
        <div className="mag-stats">
          <div className="mag-stat">
            <span className="ms-label">Mood</span>
            <span className="ms-val">{sentimentLabel(a.sentiment)}</span>
          </div>
          <div className="mag-stat">
            <span className="ms-label">Arc</span>
            <span className="ms-val">{TRAJ[a.trajectory] || a.trajectory || "—"}</span>
          </div>
          <div className="mag-stat">
            <span className="ms-label">Energy</span>
            <span className="ms-val">
              {"●".repeat(a.energy === "high" ? 3 : a.energy === "medium" ? 2 : 1).padEnd(3, "○")}
            </span>
          </div>
          {a.focus && (
            <div className="mag-stat">
              <span className="ms-label">Focus</span>
              <span className="ms-val">{a.focus}</span>
            </div>
          )}
        </div>

        {/* Visual */}
        {a.visual && (
          <div className="mag-section">
            <span className="mag-kicker">What the camera saw</span>
            <p>{a.visual}</p>
          </div>
        )}

        {/* Standing */}
        {a.standing && (
          <div className="mag-section">
            <span className="mag-kicker">Where you are</span>
            <p>{a.standing}</p>
          </div>
        )}

        {/* Quote */}
        {a.quotes?.[0] && (
          <blockquote className="mag-quote">"{a.quotes[0]}"</blockquote>
        )}

        {/* Life sections */}
        {a.lifeSections?.length > 0 && (
          <div className="mag-section">
            <span className="mag-kicker">The sections of a life</span>
            <div className="mag-cols">
              {a.lifeSections.map((s, i) => (
                <div key={i} className="mag-col">
                  <div className="mag-col-head">
                    <span>{s.domain}</span>
                    <span className="mag-col-status">{s.status}</span>
                  </div>
                  <p>{s.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Topics */}
        {a.topics?.length > 0 && (
          <div className="mag-section">
            <span className="mag-kicker">Topics</span>
            <div className="mag-tags">
              {a.topics.map((t) => (
                <span key={t} className="mag-tag">{t}</span>
              ))}
            </div>
          </div>
        )}

        {/* Emotions */}
        {a.emotions?.length > 0 && (
          <div className="mag-section">
            <span className="mag-kicker">Emotional weather</span>
            <p>{a.emotions.join(" · ")}</p>
          </div>
        )}

        {/* Ideas */}
        {a.ideas?.length > 0 && (
          <div className="mag-section">
            <span className="mag-kicker">Ideas worth keeping</span>
            <ul>
              {a.ideas.map((idea, i) => (
                <li key={i}>{idea.text || idea}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Follow-ups */}
        {a.followUps?.length > 0 && (
          <div className="mag-section">
            <span className="mag-kicker">Threads to pull</span>
            <ul>
              {a.followUps.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {a._fallback && (
          <p className="mag-note">
            Drafted by local heuristics. Set ANTHROPIC_API_KEY on the server for full analysis.
          </p>
        )}
      </div>
    </div>
  );
}
