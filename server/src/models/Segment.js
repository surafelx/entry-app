import mongoose from "mongoose";

const { Schema, model } = mongoose;

const segmentSchema = new Schema({
  entry: {
    type: Schema.Types.ObjectId,
    ref: "Entry",
    required: true,
    index: true,
  },
  startSec: { type: Number, required: true },
  endSec: { type: Number, required: true },
  text: { type: String, required: true },
  // Float32 vector for semantic search. Stored as a number array in Mongo
  // (vs. Prisma's Bytes blob) so it can feed Atlas Vector Search later.
  embedding: { type: [Number], default: undefined },
});

export default model("Segment", segmentSchema);
