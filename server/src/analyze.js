import "dotenv/config";
import OpenAI from "openai";
import Entry from "./models/Entry.js";
import Analysis from "./models/Analysis.js";

// ── Config ──────────────────────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "minimax/minimax-m2.7";

function getClient() {
  return new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://entry-app.dev",
      "X-Title": "Entry App",
    },
  });
}

// ── JSON Schema for structured output ───────────────────────────────────────
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One-paragraph summary of this moment" },
    sentiment: { type: "number", description: "Mood score from -1 (heavy) to 1 (bright)" },
    trajectory: { type: "string", enum: ["rising", "flat", "falling"], description: "Emotional arc direction" },
    energy: { type: "string", enum: ["low", "medium", "high"], description: "Energy level" },
    emotions: { type: "array", items: { type: "string" }, description: "Detected emotions" },
    topics: { type: "array", items: { type: "string" }, description: "Key topics or themes" },
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          novelty: { type: "number", description: "How novel/original this idea is (0-1)" },
        },
        required: ["text", "novelty"],
      },
    },
    identity: { type: "array", items: { type: "string" }, description: "Identity statements or self-observations" },
    quotes: { type: "array", items: { type: "string" }, description: "Notable quotes from the transcript" },
    followUps: { type: "array", items: { type: "string" }, description: "Open questions or threads to revisit" },
    lifeSections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Life domain (e.g. Work, Relationships, Health)" },
          status: { type: "string", description: "Short status label (e.g. Momentum, Strained, Searching)" },
          summary: { type: "string" },
        },
        required: ["domain", "status", "summary"],
      },
      description: "Break life into 3-6 domains present in this recording",
    },
    standing: { type: "string", description: "One vivid paragraph: where this person is right now" },
    visual: { type: "string", description: "What the camera shows — expression, setting, energy" },
    patterns: {
      type: "array",
      items: { type: "string" },
      description: "Cross-entry patterns: themes that keep recurring across recordings",
    },
    growth: {
      type: "string",
      description: "How this entry compares to previous ones — any shift or evolution",
    },
  },
  required: [
    "summary", "sentiment", "trajectory", "energy", "emotions", "topics",
    "ideas", "identity", "quotes", "followUps", "lifeSections", "standing",
    "visual", "patterns", "growth",
  ],
  additionalProperties: false,
};

// ── System prompt ───────────────────────────────────────────────────────────
const SYSTEM = `You are an insightful, warm biographer-analyst. You receive a transcript of someone speaking candidly — a check-in, a recording, a stream. From it, you draft a portrait of where this person is in their life right now.

Be specific and grounded in what they actually said. Infer carefully; never invent facts. Write in second person where natural ("You're…"), like a perceptive friend reflecting back.

You may also be given still frames captured from the video of them speaking. Use them: read facial expression, posture, energy, and setting, and let what you see inform mood, energy, and your portrait — but never over-claim from a blurry frame.

You may also receive a MEMORY section summarizing this person's recent entries. Use it to:
- Identify recurring themes ("you've been talking about X a lot lately")
- Note shifts or evolution ("compared to last week, you seem more grounded")
- Flag unresolved threads from earlier recordings
- Track patterns in mood, energy, focus over time

For lifeSections: break their life into 3–6 domains that are actually present in the transcript (e.g. Work & Craft, Relationships, Health & Body, Mind & Growth, Money, Identity, Play). For each: a short status label (e.g. "Momentum", "Strained", "Searching") and 1–2 sentences on where they stand in it.

For standing: one vivid paragraph capturing where this person is right now — the throughline of this moment in their life.

For visual: 1–2 sentences on what the camera shows — their expression, body language, energy, and surroundings. If no frames were provided, return an empty string.

For patterns: if memory is provided, list 2-4 themes that keep recurring. If no memory, return an empty array.

For growth: if memory is provided, note any shift or evolution compared to previous entries. If no memory, return an empty string.

IMPORTANT: Return ONLY a valid JSON object matching the schema below. No markdown, no code fences, no explanation — just the raw JSON.`;

// ── Helpers ─────────────────────────────────────────────────────────────────
function buildPrompt(transcript, meta) {
  const when = meta?.recordedAt
    ? new Date(meta.recordedAt).toLocaleString()
    : "unknown time";

  let prompt = `Recording metadata: source=${meta?.source || "unknown"}, recorded=${when}, title=${meta?.title || "(untitled)"}.

Transcript:
"""
${transcript}
"""`;

  // Inject voice analysis context
  if (meta?.voiceEmotion) {
    const ve = meta.voiceEmotion;
    prompt += `\n\nVOICE EMOTION ANALYSIS: emotion="${ve.emotion || "unknown"}", confidence=${ve.confidence || 0}, vocalTone="${ve.vocalTone || "unknown"}"`;
  }
  if (meta?.audioFeatures) {
    const af = meta.audioFeatures;
    prompt += `\nAUDIO FEATURES: energy=${af.rmsEnergy}dB, peak=${af.peakDb}dB, speakingPace=${Math.round((af.speakingRate || 0) * 100)}%, pauseRatio=${Math.round((af.pauseRatio || 0) * 100)}%, loudness=${af.loudness}LUFS`;
  }

  // Inject image analysis context
  if (meta?.imageAnalysis) {
    const ia = meta.imageAnalysis;
    const parts = [];
    if (ia.scene) parts.push(`scene: ${ia.scene}`);
    if (ia.facialExpression) parts.push(`expression: ${ia.facialExpression}`);
    if (ia.bodyLanguage) parts.push(`body language: ${ia.bodyLanguage}`);
    if (ia.mood) parts.push(`visual mood: ${ia.mood}`);
    if (ia.objects?.length) parts.push(`objects: ${ia.objects.join(", ")}`);
    if (parts.length) prompt += `\n\nIMAGE ANALYSIS: ${parts.join("; ")}`;
  }

  prompt += "\n\nAnalyze this moment and draft where this person is in their life.";
  return prompt;
}

function buildMemoryBlock(memoryEntries) {
  if (!memoryEntries?.length) return "";
  const lines = memoryEntries.map((e, i) => {
    const when = new Date(e.recordedAt).toLocaleDateString();
    const summary = e.analysis?.summary || "(no summary)";
    const sentiment = e.analysis?.sentiment;
    const mood = sentiment == null ? "" : sentiment > 0.25 ? "bright" : sentiment < -0.25 ? "heavy" : "even";
    const topics = (e.analysis?.topics || []).join(", ");
    return `  ${i + 1}. [${when}] "${e.title || "Untitled"}" — mood: ${mood}, topics: ${topics || "none"}\n     Summary: ${summary}`;
  });
  return `\n\nMEMORY — previous entries (newest first):\n${lines.join("\n")}`;
}

function frameBlocks(frames = []) {
  return frames.slice(0, 4).flatMap((f) => {
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(f);
    if (!m) return [];
    return {
      type: "image_url",
      image_url: { url: `data:${m[1]};base64,${m[2]}` },
    };
  });
}

// ── Main analysis function ──────────────────────────────────────────────────
export async function analyzeTranscript(transcript, meta = {}) {
  const text = (transcript || "").trim();
  const frames = meta.frames || [];
  if (!text && frames.length === 0) return emptyAnalysis();
  if (!OPENROUTER_API_KEY) {
    console.log("[analyze] no OPENROUTER_API_KEY, using heuristic fallback");
    return heuristic(text, meta);
  }

  // Fetch recent entries for cross-entry memory
  const memoryEntries = await Entry.find({ _id: { $ne: meta.entryId } })
    .sort({ recordedAt: -1 })
    .limit(10)
    .populate("analysis")
    .lean({ virtuals: true });

  const memoryBlock = buildMemoryBlock(memoryEntries);

  // Only send frames if model likely supports vision (skip for text-only models)
  const supportsVision = !MODEL.includes("minimax");
  const images = supportsVision ? frameBlocks(frames) : [];

  const userContent = [
    ...images,
    {
      type: "text",
      text:
        buildPrompt(text || "(no speech captured)", meta) +
        memoryBlock +
        (images.length
          ? `\n\n${images.length} still frame(s) from the video are attached above.`
          : ""),
    },
  ];

  const client = getClient();

  // Retry up to 2 times on transient errors
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "analysis",
            strict: true,
            schema: ANALYSIS_SCHEMA,
          },
        },
        max_tokens: 4000,
        temperature: 0.7,
      });

      const raw = response.choices?.[0]?.message?.content;
      if (!raw) {
        if (attempt < MAX_RETRIES) {
          console.log(`[analyze] empty response, retrying (${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return heuristic(text, meta);
      }

      // Strip markdown code fences and extract JSON object
      let cleaned = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      // If the response has markdown wrapping (bold markers etc), find the JSON object
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
      }
      console.log("[analyze] raw response first 300 chars:", raw.slice(0, 300));
      const parsed = JSON.parse(cleaned);
      console.log(`[analyze] success on attempt ${attempt + 1} (model=${MODEL}, tokens=${response.usage?.total_tokens || "?"})`);
      return {
        summary: parsed.summary || "",
        sentiment: clampSentiment(parsed.sentiment),
        trajectory: parsed.trajectory || "flat",
        energy: parsed.energy || "medium",
        emotions: parsed.emotions || [],
        topics: parsed.topics || [],
        ideas: parsed.ideas || [],
        identity: parsed.identity || [],
        quotes: parsed.quotes || [],
        followUps: parsed.followUps || [],
        lifeSections: parsed.lifeSections || [],
        standing: parsed.standing || "",
        visual: parsed.visual || "",
        patterns: parsed.patterns || [],
        growth: parsed.growth || "",
        suggestions: generateSuggestions(parsed, meta),
        raw: parsed,
      };
    } catch (err) {
      const isLast = attempt === MAX_RETRIES;
      const isTransient = err.status === 429 || err.status === 502 || err.status === 503;
      if (!isLast && isTransient) {
        const delay = 1000 * (attempt + 1);
        console.log(`[analyze] transient error ${err.status}, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.error(`[analyze] OpenRouter failed (attempt ${attempt + 1}):`, err.message);
      if (isLast) return heuristic(text, meta);
    }
  }

  return heuristic(text, meta);
}

function clampSentiment(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

// ── Generate editor suggestions based on analysis ───────────────────────────
function generateSuggestions(a, meta) {
  const suggestions = [];
  if (a.sentiment > 0.2) {
    suggestions.push({ type: "effect", label: "Add warm sepia tone", reason: "Your mood is upbeat — warm tones enhance that feeling", params: { sepia: 0.25, brightness: 1.05 } });
  } else if (a.sentiment < -0.2) {
    suggestions.push({ type: "effect", label: "High contrast black & white", reason: "A heavier moment — stark contrast adds gravity", params: { grayscale: 0.8, contrast: 1.2 } });
  }
  if (a.energy === "high") {
    suggestions.push({ type: "audio", label: "Boost audio energy", reason: "High energy recording — keep the momentum", params: { volume: 1.1, speed: 1.05 } });
  }
  if (a.topics?.length) {
    suggestions.push({ type: "hashtag", label: "Tag key topics", reason: `Topics: ${a.topics.join(", ")}`, params: { tags: a.topics } });
  }
  if (a.quotes?.length) {
    suggestions.push({ type: "overlay", label: "Add pull quote overlay", reason: "Strong quote detected — put it on screen", params: { text: a.quotes[0], position: "bottom" } });
  }
  return suggestions;
}

// ── Offline fallback: keyword heuristics ────────────────────────────────────
const POS = ["good", "great", "love", "excited", "happy", "proud", "win", "shipped", "grateful", "calm", "hopeful"];
const NEG = ["tired", "stress", "anxious", "sad", "worried", "stuck", "hard", "afraid", "angry", "overwhelmed", "lonely"];
const DOMAINS = [
  { domain: "Work & Craft", keys: ["work", "ship", "project", "build", "code", "deadline", "team", "job", "career"] },
  { domain: "Relationships", keys: ["friend", "family", "partner", "love", "people", "mom", "dad", "talk", "alone", "lonely"] },
  { domain: "Health & Body", keys: ["sleep", "tired", "gym", "run", "eat", "sick", "energy", "rest", "body"] },
  { domain: "Mind & Growth", keys: ["learn", "read", "think", "idea", "growth", "figure", "understand", "question"] },
];

function heuristic(text, meta) {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const count = (list) => list.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
  const pos = count(POS);
  const neg = count(NEG);
  const sentiment = Math.max(-1, Math.min(1, (pos - neg) / Math.max(3, pos + neg)));

  const topics = DOMAINS.filter((d) => d.keys.some((k) => lower.includes(k))).map(
    (d) => d.domain.split(" ")[0].toLowerCase()
  );

  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 12);
  const lifeSections = DOMAINS.filter((d) => d.keys.some((k) => lower.includes(k))).map((d) => ({
    domain: d.domain,
    status: sentiment > 0.2 ? "Momentum" : sentiment < -0.2 ? "Strained" : "Steady",
    summary: sentences.find((s) => d.keys.some((k) => s.toLowerCase().includes(k))) || "Present in this moment.",
  }));

  const suggestions = [];
  if (sentiment > 0.2) {
    suggestions.push({ type: "effect", label: "Add warm sepia tone", reason: "Your mood is upbeat — warm tones enhance that feeling", params: { sepia: 0.25, brightness: 1.05 } });
  } else if (sentiment < -0.2) {
    suggestions.push({ type: "effect", label: "High contrast black & white", reason: "A heavier moment — stark contrast adds gravity", params: { grayscale: 0.8, contrast: 1.2 } });
  }
  if (pos > 2) {
    suggestions.push({ type: "overlay", label: "Add title overlay", reason: "Strong positive energy — frame it with a title", params: { text: meta?.title || "A Good Moment", position: "top" } });
  }
  suggestions.push({ type: "hashtag", label: "Tag key topics", reason: `Topics detected: ${topics.join(", ") || "reflection"}`, params: { tags: topics.length ? topics : ["reflection"] } });

  return {
    summary: sentences[0] || text.slice(0, 140),
    sentiment,
    trajectory: sentiment > 0.2 ? "rising" : sentiment < -0.2 ? "falling" : "flat",
    energy: words.length > 120 ? "high" : words.length > 40 ? "medium" : "low",
    emotions: [...(pos > neg ? ["upbeat"] : neg > pos ? ["heavy"] : ["even"]), ...(pos ? ["hopeful"] : []), ...(neg ? ["tired"] : [])],
    topics: topics.length ? topics : ["reflection"],
    ideas: sentences.filter((s) => /\b(could|should|want to|idea|maybe|what if)\b/i.test(s)).slice(0, 3).map((s) => ({ text: s, novelty: 0.5 })),
    identity: [],
    quotes: sentences.slice(0, 2),
    followUps: sentences.filter((s) => /\?\s*$/.test(s)).slice(0, 3),
    lifeSections: lifeSections.length ? lifeSections : [{ domain: "This Moment", status: "Steady", summary: sentences[0] || text.slice(0, 140) }],
    standing: sentences.slice(0, 2).join(" ") || "A quiet moment, captured.",
    visual: (meta.frames || []).length ? "Set an OPENROUTER_API_KEY for a full visual read." : "",
    patterns: [],
    growth: "",
    suggestions,
    _fallback: true,
  };
}

function emptyAnalysis() {
  return {
    summary: "(no speech detected)",
    sentiment: 0,
    trajectory: "flat",
    energy: "low",
    emotions: [],
    topics: [],
    ideas: [],
    identity: [],
    quotes: [],
    followUps: [],
    lifeSections: [],
    standing: "",
    visual: "",
    patterns: [],
    growth: "",
    suggestions: [],
    _empty: true,
  };
}
