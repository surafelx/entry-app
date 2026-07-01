// Media-free re-analysis: re-run the (goal-aware) AI analysis on an entry using
// its stored transcript + previously-computed audio/voice/image analysis. No
// ffmpeg, no Cloudinary, no frames — cheap enough to backfill the whole history.
import Entry from "./models/Entry.js";
import Transcript from "./models/Transcript.js";
import Analysis from "./models/Analysis.js";
import { analyzeTranscript } from "./analyze.js";

export async function reanalyzeEntry(entryId) {
  const entry = await Entry.findById(entryId);
  if (!entry) return { skipped: true, reason: "not found" };

  const transcript = await Transcript.findOne({ entry: entryId });
  const existing = await Analysis.findOne({ entry: entryId }).lean();
  const text = (transcript?.fullText || "").trim();
  if (!text) return { skipped: true, reason: "no transcript" };

  const a = await analyzeTranscript(text, {
    source: entry.source,
    title: entry.title,
    recordedAt: entry.recordedAt,
    entryId,
    // reuse stored multimodal context so the read keeps its depth
    audioFeatures: existing?.audioFeatures,
    voiceEmotion: existing?.voiceEmotion,
    imageAnalysis: existing?.imageAnalysis,
  });

  const lifeSections = (a.lifeSections || []).map((s) => ({
    domain: s.domain, status: s.status, summary: s.summary || s.description || "",
  }));

  await Analysis.findOneAndUpdate(
    { entry: entryId },
    {
      entry: entryId,
      summary: a.summary, sentiment: a.sentiment, trajectory: a.trajectory,
      energy: a.energy, emotions: a.emotions, topics: a.topics,
      ideas: a.ideas, identity: a.identity, quotes: a.quotes,
      followUps: a.followUps, lifeSections, standing: a.standing,
      visual: a.visual, patterns: a.patterns || [], growth: a.growth || "",
      nextStep: a.nextStep || "", goalReflections: a.goalReflections || [],
      raw: a.raw,
      // preserve the stored multimodal features (analysis didn't recompute them)
      ...(existing?.audioFeatures && { audioFeatures: existing.audioFeatures }),
      ...(existing?.voiceEmotion && { voiceEmotion: existing.voiceEmotion }),
      ...(existing?.imageAnalysis && { imageAnalysis: existing.imageAnalysis }),
    },
    { upsert: true }
  );

  await Entry.findByIdAndUpdate(entryId, { goals: a.linkedGoalIds || [] });
  return { ok: true, goals: a.linkedGoalIds || [], nextStep: a.nextStep || "" };
}

// Re-analyze every entry that has a transcript, sequentially (avoid rate limits).
export async function backfillAll(onProgress) {
  const entries = await Entry.find().select("_id").sort({ recordedAt: 1 }).lean();
  let processed = 0, linked = 0, skipped = 0;
  for (const e of entries) {
    try {
      const r = await reanalyzeEntry(e._id);
      if (r?.ok) { processed++; if (r.goals?.length) linked++; }
      else skipped++;
    } catch (err) {
      skipped++;
      console.error(`[backfill] ${e._id} failed:`, err.message);
    }
    onProgress?.({ processed, skipped, total: entries.length });
  }
  return { processed, linked, skipped, total: entries.length };
}
