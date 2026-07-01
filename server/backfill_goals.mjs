// Re-analyze every entry (goal-aware) and link them to goals.
// Usage:  node backfill_goals.mjs   (Node 20, from server/)
import "dotenv/config";
import { connectDB } from "./src/db.js";
import { backfillAll } from "./src/reanalyze.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/entry_app";
await connectDB(MONGODB_URI);
console.log("[backfill] starting…");
const r = await backfillAll(({ processed, total }) => {
  if (processed % 3 === 0 || processed === total) console.log(`  ${processed}/${total}`);
});
console.log("[backfill] done:", JSON.stringify(r));
process.exit(0);
