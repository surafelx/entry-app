import { Router } from "express";
import Goal from "../models/Goal.js";
import Entry from "../models/Entry.js";
import { reanalyzeEntry, backfillAll } from "../reanalyze.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const STALL_DAYS = 14;

// Attach derived progress to a goal from the entries linked to it.
async function withProgress(goal) {
  const entries = await Entry.find({ goals: goal._id })
    .sort({ recordedAt: -1 })
    .populate("analysis")
    .lean({ virtuals: true });

  const sentimentTrend = entries
    .map((e) => e.analysis?.sentiment)
    .filter((v) => v != null);
  const latest = entries[0];
  const lastTouched = latest?.recordedAt || null;
  const staleByTime = lastTouched
    ? Date.now() - new Date(lastTouched).getTime() > STALL_DAYS * 864e5
    : true;
  const falling = latest?.analysis?.trajectory === "falling";

  return {
    ...goal,
    linkedCount: entries.length,
    lastTouched,
    sentimentTrend,
    latestStanding: latest?.analysis?.standing || "",
    latestNextStep: latest?.analysis?.nextStep || "",
    stalled: goal.status === "active" && (staleByTime || falling),
  };
}

// GET /api/goals — all goals with derived progress
router.get("/", wrap(async (_req, res) => {
  const goals = await Goal.find().sort({ createdAt: -1 }).lean({ virtuals: true });
  res.json(await Promise.all(goals.map(withProgress)));
}));

// POST /api/goals/backfill — re-analyze every entry (goal-aware) in the
// background; returns immediately so the request doesn't hang on the LLM calls.
router.post("/backfill", wrap(async (_req, res) => {
  const pending = await Entry.countDocuments();
  backfillAll(({ processed, total }) => {
    if (processed % 3 === 0 || processed === total)
      console.log(`[backfill] ${processed}/${total}`);
  })
    .then((r) => console.log("[backfill] done:", JSON.stringify(r)))
    .catch((e) => console.error("[backfill] failed:", e.message));
  res.status(202).json({ started: true, total: pending });
}));

// GET /api/goals/:id — goal + its linked entries
router.get("/:id", wrap(async (req, res) => {
  const goal = await Goal.findById(req.params.id).lean({ virtuals: true });
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  const entries = await Entry.find({ goals: goal._id })
    .sort({ recordedAt: -1 })
    .populate("analysis")
    .lean({ virtuals: true });
  res.json({ ...(await withProgress(goal)), entries });
}));

// POST /api/goals
router.post("/", wrap(async (req, res) => {
  const { title, why, domain, metric, targetDate, keywords, status } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "title required" });
  const goal = await Goal.create({
    title: title.trim(), why, domain, metric,
    targetDate: targetDate ? new Date(targetDate) : undefined,
    keywords, status,
  });
  res.status(201).json(goal);
}));

// PATCH /api/goals/:id
router.patch("/:id", wrap(async (req, res) => {
  const goal = await Goal.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  res.json(goal);
}));

// DELETE /api/goals/:id — also unlink it from any entries
router.delete("/:id", wrap(async (req, res) => {
  const goal = await Goal.findByIdAndDelete(req.params.id);
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  await Entry.updateMany({ goals: goal._id }, { $pull: { goals: goal._id } });
  res.status(204).end();
}));

export default router;
