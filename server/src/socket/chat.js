import Message from "../models/Message.js";
import ChatRoom from "../models/ChatRoom.js";

export function registerChatHandlers(io, socket) {
  const userId = socket.handshake.auth?.userId || socket.id;
  const userName = socket.handshake.auth?.userName || "Anonymous";

  // ── Join a room ──────────────────────────────────────────────────────
  socket.on("room:join", async ({ roomId }) => {
    socket.join(roomId);
    const messages = await Message.find({ roomId, deletedAt: null })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    socket.emit("room:history", { roomId, messages: messages.reverse() });
  });

  // ── Leave a room ─────────────────────────────────────────────────────
  socket.on("room:leave", ({ roomId }) => {
    socket.leave(roomId);
  });

  // ── Send message (persist-then-broadcast) ────────────────────────────
  socket.on("message:send", async ({ roomId, text, type, replyTo }, ack) => {
    try {
      if (!text?.trim() && type !== "system") {
        if (ack) ack({ status: "error", error: "Empty message" });
        return;
      }

      const msg = await Message.create({
        roomId,
        senderId: userId,
        senderName: userName,
        text: text || "",
        type: type || "text",
        replyTo: replyTo || null,
      });

      await ChatRoom.findByIdAndUpdate(roomId, {
        lastMessage: {
          text: text || "",
          senderId: userId,
          senderName: userName,
          sentAt: new Date(),
        },
      });

      io.to(roomId).emit("message:new", msg.toObject());
      if (ack) ack({ status: "ok", messageId: msg._id });
    } catch (err) {
      console.error("[chat] send failed:", err.message);
      if (ack) ack({ status: "error", error: err.message });
    }
  });

  // ── Typing indicators (ephemeral) ────────────────────────────────────
  socket.on("typing:start", ({ roomId }) => {
    socket.to(roomId).emit("typing:update", {
      userId,
      userName,
      isTyping: true,
    });
  });

  socket.on("typing:stop", ({ roomId }) => {
    socket.to(roomId).emit("typing:update", {
      userId,
      userName,
      isTyping: false,
    });
  });

  // ── Read receipts ────────────────────────────────────────────────────
  socket.on("message:read", async ({ roomId, messageIds }) => {
    await Message.updateMany(
      { _id: { $in: messageIds }, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } }
    );
    io.to(roomId).emit("message:read-receipt", { userId, messageIds });
  });
}
