import { useState, useRef, useEffect } from "react";
import { useChatRoom } from "./hooks/useChatRoom.js";

export default function StreamChat({ roomId, userName = "Anonymous" }) {
  const { connected, messages, typingUsers, sendMessage, startTyping, stopTyping } =
    useChatRoom(roomId, { userId: `user-${Date.now()}`, userName });
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
    <div className="stream-chat">
      <div className="sc-header">
        <span className={`sc-dot ${connected ? "on" : ""}`} />
        <span>{connected ? "Live" : "Reconnecting..."}</span>
      </div>

      <div className="sc-messages">
        {messages.map((m) => (
          <div key={m._id} className="sc-msg">
            <span className="sc-name">{m.senderName}</span>
            <span className="sc-text">{m.text}</span>
            <span className="sc-time">{fmtTime(m.createdAt)}</span>
          </div>
        ))}
        {typingUsers.length > 0 && (
          <div className="sc-typing">
            {typingUsers.map((u) => u.userName).join(", ")} typing...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="sc-input">
        <input
          type="text"
          placeholder="Say something..."
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (e.target.value) startTyping();
            else stopTyping();
          }}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={!connected}
        />
        <button className="btn accent small" onClick={handleSend} disabled={!connected || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
