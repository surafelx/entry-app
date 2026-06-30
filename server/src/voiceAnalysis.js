import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { MEDIA_DIR } from "./index.js";

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

const TIMEOUT = 20000;

function execSafe(cmd) {
  try {
    return execSync(cmd, { timeout: TIMEOUT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

// ── Part A: ffmpeg audio feature extraction ──
export function extractAudioFeatures(audioPath) {
  if (!audioPath || !fs.existsSync(audioPath)) return null;

  try {
    // RMS energy + peak via astats
    const stats = execSafe(
      `ffmpeg -i "${audioPath}" -af "astats=metadata=1:reset=0" -f null - 2>&1`
    );

    const rmsLines = [...stats.matchAll(/RMS level dB:\s*([-\d.]+)/g)];
    const peakLines = [...stats.matchAll(/Peak level dB:\s*([-\d.]+)/g)];
    const rmsValues = rmsLines.map((m) => parseFloat(m[1])).filter((v) => !isNaN(v));
    const peakValues = peakLines.map((m) => parseFloat(m[1])).filter((v) => !isNaN(v));

    const rmsEnergy = rmsValues.length ? rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length : null;
    const peakDb = peakValues.length ? Math.max(...peakValues) : null;

    // Silence detection for speaking rate
    const silenced = execSafe(
      `ffmpeg -i "${audioPath}" -af "silencedetect=noise=-30dB:d=0.5" -f null - 2>&1`
    );

    const pauses = (silenced.match(/silence_end/g) || []).length;
    const pauseDurations = [...silenced.matchAll(/silence_duration:\s*([\d.]+)/g)]
      .map((m) => parseFloat(m[1]));
    const totalPause = pauseDurations.reduce((a, b) => a + b, 0);

    // Duration
    const durationStr = execSafe(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`
    ).trim();
    const duration = parseFloat(durationStr) || 0;

    // Loudness via ebur128
    const loudnessOutput = execSafe(
      `ffmpeg -i "${audioPath}" -af "ebur128" -f null - 2>&1`
    );
    const lufsMatch = loudnessOutput.match(/I:\s*([-\d.]+)\s*LUFS/);
    const loudness = lufsMatch ? parseFloat(lufsMatch[1]) : null;

    return {
      rmsEnergy: rmsEnergy != null ? Math.round(rmsEnergy * 100) / 100 : null,
      peakDb: peakDb != null ? Math.round(peakDb * 100) / 100 : null,
      speakingRate: duration > 0 ? Math.round(((duration - totalPause) / duration) * 100) / 100 : null,
      pauseRatio: duration > 0 ? Math.round((totalPause / duration) * 100) / 100 : null,
      loudness: loudness != null ? Math.round(loudness * 100) / 100 : null,
      duration: Math.round(duration * 100) / 100,
    };
  } catch (e) {
    console.error("[voice] audio feature extraction failed:", e.message);
    return null;
  }
}

// ── Trim audio to 60s for LLM analysis ──
function trimAudio(inputPath, maxSeconds = 60) {
  const outPath = inputPath.replace(/\.[^.]+$/, ".trimmed.mp3");
  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -t ${maxSeconds} -ac 1 -ar 16000 -b:a 32k "${outPath}"`,
      { timeout: 15000 }
    );
    return outPath;
  } catch {
    return null;
  }
}

// ── Part B: LLM voice emotion inference ──
export async function analyzeVoiceEmotion(transcript, audioFeatures, audioPath) {
  if (!transcript && !audioFeatures) return null;

  // Build context from audio features
  const featureContext = audioFeatures
    ? [
        `Energy: ${audioFeatures.rmsEnergy}dB RMS, peak ${audioFeatures.peakDb}dB`,
        `Speaking pace: ${Math.round((audioFeatures.speakingRate || 0) * 100)}% active speech`,
        `Pause ratio: ${Math.round((audioFeatures.pauseRatio || 0) * 100)}% silence`,
        `Loudness: ${audioFeatures.loudness} LUFS`,
        `Duration: ${audioFeatures.duration}s`,
      ].join("\n")
    : "No audio features available.";

  // Try to send trimmed audio to multimodal model
  let audioBase64 = null;
  if (audioPath && fs.existsSync(audioPath)) {
    const trimmed = trimAudio(audioPath);
    if (trimmed && fs.existsSync(trimmed)) {
      try {
        const buf = fs.readFileSync(trimmed);
        audioBase64 = buf.toString("base64");
        fs.unlinkSync(trimmed);
      } catch {}
    }
  }

  const messages = [
    {
      role: "system",
      content: `You are a voice emotion analyst. Given a transcript, audio features (energy, pace, pauses), and optionally the audio itself, infer the speaker's emotional state.
Return JSON: { emotion (one word), confidence (0-1), vocalTone (e.g. "warm", "flat", "tense", "energetic", "soft") }`,
    },
  ];

  if (audioBase64) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: `Audio features:\n${featureContext}\n\nTranscript:\n${(transcript || "").slice(0, 2000)}\n\nListen to the audio and analyze the vocal emotion. Return JSON only.` },
        { type: "input_audio", input_audio: { data: audioBase64, format: "mp3" } },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: `Audio features:\n${featureContext}\n\nTranscript:\n${(transcript || "").slice(0, 2000)}\n\nInfer the vocal emotion from these speech patterns. Return JSON only.`,
    });
  }

  try {
    const res = await getClient().chat.completions.create({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      max_tokens: 200,
    });

    const text = res.choices[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.error("[voice] emotion analysis failed:", e.message);
    return null;
  }
}
