import mongoose from "mongoose";

const { Schema, model } = mongoose;

// A goal the person is pursuing. Entries link to goals (Entry.goals), and each
// analysis reflects on movement toward/away from active goals.
const goalSchema = new Schema(
  {
    title: { type: String, required: true },
    why: { type: String, default: "" },            // the motivation behind it
    domain: { type: String, default: "" },          // free text, matches lifeSection domains
    metric: { type: String, default: "" },          // e.g. "save 20k", "3x/week"
    targetDate: { type: Date },
    keywords: { type: [String], default: [] },      // for heuristic entry↔goal matching
    status: {
      type: String,
      enum: ["active", "stalled", "hit", "archived"],
      default: "active",
    },
  },
  { timestamps: true }
);

// Seed keywords from the title when none were provided, so matching works out
// of the box (drops short stop-words).
goalSchema.pre("save", function seedKeywords(next) {
  if (!this.keywords?.length && this.title) {
    this.keywords = this.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
  }
  next();
});

goalSchema.set("toJSON", { virtuals: true });
goalSchema.set("toObject", { virtuals: true });

export default model("Goal", goalSchema);
