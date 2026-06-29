import mongoose from "mongoose";

const { Schema, model } = mongoose;

// Where Prisma stored JSON-as-String columns, Mongo lets us keep them as
// real arrays/objects — no JSON.parse round-trips.
const ideaSchema = new Schema(
  { text: String, novelty: Number },
  { _id: false }
);

// A drafted "section of the life" — a domain (Work, Relationships, Health…)
// with where the person currently stands in it.
const lifeSectionSchema = new Schema(
  { domain: String, status: String, summary: String },
  { _id: false }
);

const analysisSchema = new Schema({
  entry: {
    type: Schema.Types.ObjectId,
    ref: "Entry",
    required: true,
    unique: true, // 1:1 with Entry
  },
  summary: { type: String, required: true },
  sentiment: { type: Number, required: true }, // -1..1
  trajectory: { type: String, enum: ["rising", "flat", "falling"] },
  energy: { type: String, enum: ["low", "medium", "high"] },
  emotions: { type: [String], default: [] },
  topics: { type: [String], default: [] },
  ideas: { type: [ideaSchema], default: [] },
  identity: { type: [String], default: [] }, // identity signals
  quotes: { type: [String], default: [] },
  followUps: { type: [String], default: [] },
  // Phase-2 life model: where this person is and how their life breaks down.
  lifeSections: { type: [lifeSectionSchema], default: [] },
  standing: { type: String, default: "" }, // a read on "where they are" right now
  visual: { type: String, default: "" }, // what the camera saw (from video frames)
  patterns: { type: [String], default: [] }, // recurring themes across entries
  growth: { type: String, default: "" }, // how this entry compares to previous ones
  raw: { type: Schema.Types.Mixed }, // full JSON the model returned
});

export default model("Analysis", analysisSchema);
