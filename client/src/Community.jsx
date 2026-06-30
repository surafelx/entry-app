import { useState, useEffect, useRef } from "react";
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
  const [posting, setPosting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    listFeedback()
      .then(setComments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const post = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      const item = await submitFeedback(text);
      setComments((prev) => [item, ...prev]);
      setText("");
      inputRef.current?.focus();
    } catch (e) {}
    setPosting(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      post();
    }
  };

  return (
    <div className="comment-board">
      <div className="comment-input-wrap">
        <div className="comment-input-box">
          <textarea
            ref={inputRef}
            className="comment-input"
            placeholder="Say something..."
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
          />
          <button className={`comment-send ${text.trim() ? "active" : ""}`} onClick={post} disabled={!text.trim() || posting}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <span className="comment-hint">Enter to send · Shift+Enter for new line</span>
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
