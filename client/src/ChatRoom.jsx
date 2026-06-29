import { useState, useRef, useEffect } from "react";
import { useChatRoom } from "./hooks/useChatRoom.js";

export default function ChatRoom({ roomId, roomName, userName = "You" }) {
  const { connected, messages, typingUsers, sendMessage, startTyping, stopTyping } =
    useChatRoom(roomId, { userId: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userName });
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
    stopTyping();
  };

  const fmtTime = (d) => {
    const date = new Date(d);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="chat-room">
      <div className="cr-header">
        <h3>{roomName || "Chat"}</h3>
        <span className={`cr-status ${connected ? "on" : ""}`}>
          {connected ? "Connected" : "Reconnecting..."}
        </span>
      </div>

      <div className="cr-messages">
        {messages.length === 0 && (
          <p className="cr-empty">No messages yet. Start the conversation!</p>
        )}
        {messages.map((m) => (
          <div key={m._id} className="cr-msg">
            <span className="cr-avatar" style={{ background: stringToColor(m.senderName) }}>
              {m.senderName[0]?.toUpperCase()}
            </span>
            <div className="cr-body">
              <div className="cr-meta">
                <span className="cr-name">{m.senderName}</span>
                <span className="cr-time">{fmtTime(m.createdAt)}</span>
              </div>
              <p className="cr-text">{m.text}</p>
            </div>
          </div>
        ))}
        {typingUsers.length > 0 && (
          <div className="cr-typing">
            {typingUsers.map((u) => u.userName).join(", ")} typing...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="cr-input">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (e.target.value) startTyping();
            else stopTyping();
          }}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={!connected}
        />
        <button className="btn primary small" onClick={handleSend} disabled={!connected || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ["#FF4D2E", "#4D5DFF", "#1FA66A", "#E0A100", "#8B3FE8", "#FF6B9D"];
  return colors[Math.abs(hash) % colors.length];
}
