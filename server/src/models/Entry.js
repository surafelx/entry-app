import mongoose from "mongoose";

const { Schema, model } = mongoose;

// Mirrors the Prisma `Entry` model. In MERN we lean on Mongo's native
// types: timestamps are real Dates, refs replace foreign keys.
const entrySchema = new Schema(
  {
    recordedAt: { type: Date, required: true }, // when the moment actually happened
    source: {
      type: String,
      required: true,
      enum: ["checkin", "upload", "stream_vod"],
    },
    title: { type: String },
    status: {
      type: String,
      default: "ingested",
      // ingested → transcribing → analyzing → ready → error
      enum: ["ingested", "transcribing", "analyzing", "ready", "error"],
    },
    mediaPath: { type: String, required: true }, // raw recorded video
    posterPath: { type: String }, // still frame thumbnail (from first captured frame)
    compressedPath: { type: String }, // h264 mp4 for cheap playback
    cartoonPath: { type: String }, // cartoonified h264 mp4 (saturated + edge outlines)
    retroPath: { type: String }, // retro vintage cartoon effect
    audioPath: { type: String }, // extracted mono mp3 — the lightweight artifact
    ditherPath: { type: String }, // pixel/dithered animated webp preview
    pixelPath: { type: String }, // pixel art video
    glitchPath: { type: String }, // VHS glitch effect
    bwPath: { type: String }, // high-contrast black and white
    vhsPath: { type: String }, // warm VHS degradation
    durationSec: { type: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Virtuals to pull the 1:1 / 1:many relations, matching the Prisma relations.
entrySchema.virtual("transcript", {
  ref: "Transcript",
  localField: "_id",
  foreignField: "entry",
  justOne: true,
});
entrySchema.virtual("analysis", {
  ref: "Analysis",
  localField: "_id",
  foreignField: "entry",
  justOne: true,
});
entrySchema.virtual("segments", {
  ref: "Segment",
  localField: "_id",
  foreignField: "entry",
});

entrySchema.set("toJSON", { virtuals: true });
entrySchema.set("toObject", { virtuals: true });

export default model("Entry", entrySchema);
