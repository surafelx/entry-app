import { useEffect, useState, useCallback, useRef } from "react";
import { useSocket } from "./useSocket.js";

export function useChatRoom(roomId, authPayload) {
  const socket = useSocket(authPayload);
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [connected, setConnected] = useState(socket?.connected ?? false);
  const typingTimerRef = useRef(null);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    setConnected(socket.connected);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || !roomId) return;

    const onHistory = ({ roomId: rid, messages: history }) => {
      if (rid === roomId) setMessages(history);
    };

    const onNewMessage = (msg) => {
      if (msg.roomId === roomId) {
        setMessages((prev) => [...prev, msg]);
      }
    };

    const onTyping = ({ userId, userName, isTyping }) => {
      setTypingUsers((prev) => {
        if (isTyping) {
          return prev.some((u) => u.userId === userId)
            ? prev
            : [...prev, { userId, userName }];
        }
        return prev.filter((u) => u.userId !== userId);
      });
    };

    socket.emit("room:join", { roomId });
    socket.on("room:history", onHistory);
    socket.on("message:new", onNewMessage);
    socket.on("typing:update", onTyping);

    return () => {
      socket.emit("room:leave", { roomId });
      socket.off("room:history", onHistory);
      socket.off("message:new", onNewMessage);
      socket.off("typing:update", onTyping);
      setMessages([]);
      setTypingUsers([]);
    };
  }, [socket, roomId]);

  const sendMessage = useCallback(
    (text, replyTo) => {
      if (!socket || !roomId || !text?.trim()) return;
      socket.timeout(5000).emit(
        "message:send",
        { roomId, text: text.trim(), type: "text", replyTo },
        (response) => {
          if (response?.status === "error") {
            console.error("Send failed:", response.error);
          }
        }
      );
    },
    [socket, roomId]
  );

  const startTyping = useCallback(() => {
    if (!socket || !roomId) return;
    socket.emit("typing:start", { roomId });
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket.emit("typing:stop", { roomId });
    }, 2000);
  }, [socket, roomId]);

  const stopTyping = useCallback(() => {
    if (!socket || !roomId) return;
    clearTimeout(typingTimerRef.current);
    socket.emit("typing:stop", { roomId });
  }, [socket, roomId]);

  return {
    socket,
    connected,
    messages,
    typingUsers,
    sendMessage,
    startTyping,
    stopTyping,
  };
}
