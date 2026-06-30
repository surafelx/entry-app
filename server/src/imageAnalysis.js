import OpenAI from "openai";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "google/gemini-2.0-flash-001";

function getClient() {
  return new OpenAI({
    apiKey: OPENROUTER_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://entry-app.dev",
      "X-Title": "Entry App",
    },
  });
}

const SYSTEM = `You are a visual analysis expert. Analyze video frames and return a JSON object with these fields:
- scene: what is happening in the scene
- facialExpression: the person's facial expression (if visible), or "not visible"
- bodyLanguage: posture, gestures, energy level
- setting: indoor/outdoor, environment description
- lighting: lighting conditions and the mood they create
- mood: overall emotional mood conveyed by the visual
- objects: array of notable objects visible in the frames`;

export async function analyzeImage(frames) {
  if (!OPENROUTER_KEY || !frames?.length) return null;

  const content = [
    { type: "text", text: "Analyze these video frames. Return JSON only, no markdown." },
    ...frames.map((f) => ({
      type: "image_url",
      image_url: { url: f.startsWith("data:") ? f : `data:${f.mimeType || "image/jpeg"};base64,${f.base64 || f}` },
    })),
  ];

  try {
    const res = await getClient().chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });

    const text = res.choices[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.error("[vision] analysis failed:", e.message);
    return null;
  }
}
