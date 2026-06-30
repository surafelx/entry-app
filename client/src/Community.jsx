import { useState, useEffect } from "react";
import { listFeedback, submitFeedback } from "./api.js";

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  const colors = ["#FF4D2E", "#4D5DFF", "#1FA66A", "#E0A100", "#8B3FE8", "#FF6B9D"];
  return colors[Math.abs(h) % colors.length];
}

export default function Community() {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listFeedback()
      .then(setComments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const post = async () => {
    if (!text.trim()) return;
    try {
      const item = await submitFeedback(text);
      setComments((prev) => [item, ...prev]);
      setText("");
    } catch (e) {}
  };

  return (
    <div className="comment-board">
      <div className="comment-input-wrap">
        <textarea
          className="feedback-input"
          placeholder="Leave a comment..."
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && post()}
        />
        <button className="follow on" onClick={post} disabled={!text.trim()}>Post</button>
      </div>

      <div className="comment-list">
        {loading && <p className="feedback-thanks">loading...</p>}
        {!loading && comments.length === 0 && (
          <p className="feedback-thanks">No comments yet. Be the first.</p>
        )}
        {comments.map((c) => (
          <div key={c._id} className="comment-item">
            <span className="avatar small" style={{ background: hashColor(c.text) }}>
              {c.text[0]?.toUpperCase() || "?"}
            </span>
            <div className="comment-body">
              <span className="comment-text">{c.text}</span>
              <span className="comment-time">{timeAgo(c.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
