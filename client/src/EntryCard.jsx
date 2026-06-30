import { STATUS, WORKING, sentimentEmoji, timeAgo, thumbSrc } from "./lib.js";

export default function EntryCard({ entry, onOpen, onDelete, onEdit }) {
  const st = STATUS[entry.status] || STATUS.ingested;
  const a = entry.analysis;
  const playable = !!entry.mediaPath;
  const thumb = thumbSrc(entry);
  const working = WORKING.includes(entry.status);
  const ready = entry.status === "ready" && a;
  return (
    <article
      className={`entry ${ready ? "clickable" : ""}`}
      style={{ "--glow": st.c }}
      onClick={() => ready && onOpen(entry)}
    >
      <div className="entry-media">
        {thumb ? (
          <img src={thumb} alt="" className="entry-poster" />
        ) : playable ? (
          <video src={entry.mediaPath} preload="metadata" muted />
        ) : (
          <div className="entry-nomedia">
            <span>{entry.source}</span>
          </div>
        )}
        {entry.ditherPath && <span className="entry-fx">dithered</span>}
        <span
          className={`status-chip ${working ? "pulsing" : ""}`}
          style={{ "--c": st.c }}
        >
          <i /> {st.label}
        </span>
        {ready && <span className="entry-open">Read insights →</span>}
      </div>
      <div className="entry-body">
        <div className="entry-row">
          <h3>{entry.title || "Untitled moment"}</h3>
          {a && <span className="senti">{sentimentEmoji(a.sentiment)}</span>}
        </div>
        <div className="entry-meta">
          {entry.source} · {timeAgo(entry.recordedAt)}
          {entry.durationSec ? ` · ${entry.durationSec}s` : ""}
        </div>
        {a?.standing ? (
          <p className="entry-summary">{a.standing}</p>
        ) : a?.summary ? (
          <p className="entry-summary">{a.summary}</p>
        ) : working ? (
          <p className="entry-summary muted">Drafting insights…</p>
        ) : null}
        {a?.topics?.length > 0 && (
          <div className="tags">
            {a.topics.slice(0, 4).map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="entry-actions">
          {entry.mediaPath && (
            <button
              className="btn ghost small entry-edit"
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(entry);
              }}
            >
              ✂ Edit
            </button>
          )}
          <button
            className="del"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry._id);
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
