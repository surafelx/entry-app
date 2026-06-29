import mongoose from "mongoose";

const { Schema, model } = mongoose;

const transcriptSchema = new Schema({
  entry: {
    type: Schema.Types.ObjectId,
    ref: "Entry",
    required: true,
    unique: true, // 1:1 with Entry
  },
  fullText: { type: String, required: true },
  language: { type: String },
});

export default model("Transcript", transcriptSchema);
