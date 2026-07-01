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
  // ── Goal-aware fields ──
  nextStep: { type: String, default: "" }, // single highest-leverage next action
  goalReflections: {
    type: [new Schema({
      goal: String,                                          // goal title as seen
      movement: { type: String, enum: ["toward", "away", "neutral"] },
      note: String,                                          // evidence-grounded read
      nextStep: String,                                      // step for this goal
    }, { _id: false })],
    default: [],
  },
  raw: { type: Schema.Types.Mixed }, // full JSON the model returned
  // ── Voice analysis ──
  audioFeatures: {
    rmsEnergy: { type: Number },
    peakDb: { type: Number },
    speakingRate: { type: Number },    // 0-1, ratio of active speech
    pauseRatio: { type: Number },      // 0-1, ratio of silence
    loudness: { type: Number },        // LUFS
    duration: { type: Number },        // seconds
  },
  voiceEmotion: {
    emotion: { type: String },
    confidence: { type: Number },
    vocalTone: { type: String },
  },
  // ── Vision analysis ──
  imageAnalysis: {
    scene: { type: String },
    facialExpression: { type: String },
    bodyLanguage: { type: String },
    setting: { type: String },
    lighting: { type: String },
    mood: { type: String },
    objects: { type: [String], default: [] },
  },
});

export default model("Analysis", analysisSchema);
