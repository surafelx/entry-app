import mongoose from "mongoose";

const { Schema, model } = mongoose;

const chatRoomSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["stream", "community"],
      required: true,
      index: true,
    },
    entryId: {
      type: Schema.Types.ObjectId,
      ref: "Entry",
      default: null,
    },
    name: {
      type: String,
      required: true,
    },
    members: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    lastMessage: {
      text: String,
      senderId: Schema.Types.ObjectId,
      senderName: String,
      sentAt: Date,
    },
  },
  { timestamps: true }
);

chatRoomSchema.index({ type: 1, members: 1 });
chatRoomSchema.index(
  { type: 1, entryId: 1 },
  { unique: true, partialFilterExpression: { type: "stream" } }
);

export default model("ChatRoom", chatRoomSchema);
