import mongoose from "mongoose";

const { Schema, model } = mongoose;

const noteSchema = new Schema(
  { text: { type: String, required: true } },
  { timestamps: { createdAt: true, updatedAt: false } }
);

noteSchema.set("toJSON", { virtuals: true });

export default model("Note", noteSchema);
