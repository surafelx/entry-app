import mongoose from "mongoose";

const { Schema, model } = mongoose;

const feedbackSchema = new Schema(
  { text: { type: String, required: true } },
  { timestamps: { createdAt: true, updatedAt: false } }
);

feedbackSchema.set("toJSON", { virtuals: true });

export default model("Feedback", feedbackSchema);
