// Telegram bot — receives video/audio messages and creates diary entries.
//
// Usage: send any video, round video, voice note, or video note to the bot.
// It downloads the file, asks which effects to apply, processes, and sends
// step-by-step notifications with the final analysis.

import { Bot, InputFile } from "grammy";
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Entry from "./models/Entry.js";
import { MEDIA_DIR } from "./index.js";
import { runPipeline } from "./pipeline.js";
import { EFFECTS, EFFECT_KEYS, byCategory, CATEGORY_LABELS, DISPLAY_FIELD_ORDER } from "./effects.js";

const log = (tag, ...a) => console.log(`[tg:${tag}]`, ...a);
const logErr = (tag, ...a) => console.error(`[tg:${tag}]`, ...a);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const VIDEO_TYPES = [
  "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo",
  "video/x-matroska", "video/avi",
];
const AUDIO_TYPES = ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav"];

function extFromMime(mime) {
  const map = {
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
    "video/x-msvideo": ".avi", "video/x-matroska": ".mkv",
    "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a",
  };
  return map[mime] || ".bin";
}

function mediaFilename(originalName, mime) {
  const ext = originalName ? path.extname(originalName) : extFromMime(mime);
  return `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Build the multi-select effect keyboard from the registry, grouped by category.
// `selected` is a Set of effect keys; chosen effects show a ✓.
function effectKeyboard(selected = new Set()) {
  const rows = [];
  for (const [cat, keys] of Object.entries(byCategory)) {
    rows.push([{ text: `— ${CATEGORY_LABELS[cat] || cat} —`, callback_data: "fxnoop" }]);
    for (const group of chunk(keys, 3)) {
      rows.push(
        group.map((k) => ({
          text: `${selected.has(k) ? "✓ " : ""}${EFFECTS[k].label}`,
          callback_data: `fxt:${k}`,
        }))
      );
    }
  }
  rows.push([
    { text: "🎲 surprise", callback_data: "fxrand" },
    { text: `✅ apply (${selected.size})`, callback_data: "fxgo" },
    { text: "✕ cancel", callback_data: "fxcancel" },
  ]);
  return { inline_keyboard: rows };
}

function effectLabel(effects) {
  if (!effects?.length) return "none";
  return effects.map((k) => EFFECTS[k]?.label || k).join(" + ");
}

async function ingestFile(ctx, file, title) {
  const userId = ctx.from?.id;
  log("ingest", `user=${userId} file_id=${file.file_id} size=${file.file_size || "?"}`);

  const tgFile = await ctx.api.getFile(file.file_id);
  const filename = mediaFilename(file.file_name || "video", file.mime_type || "video/mp4");
  const destPath = path.join(MEDIA_DIR, filename);

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgFile.file_path}`;
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Telegram download failed: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  log("ingest", `saved ${buf.length} bytes → ${filename}`);

  const mediaPath = `/media/${filename}`;

  const entry = await Entry.create({
    recordedAt: new Date(),
    source: "upload",
    title: title || file.file_name || null,
    mediaPath,
    status: "ingested",
  });
  log("ingest", `created entry ${entry._id}`);

  return entry;
}

function sendWithEffects(bot, ctx, entry, effects) {
  const chatId = ctx.chat.id;
  const notify = (msg) => {
    ctx.api.sendMessage(chatId, msg).catch(() => {});
  };
  const onComplete = async (entryId) => {
    if (!CHANNEL_ID) return;
    try {
      const full = await Entry.findById(entryId).populate("analysis").lean({ virtuals: true });
      if (!full || !full.analysis) return;
      const a = full.analysis;
      const mood = a.sentiment > 0.25 ? "😊" : a.sentiment < -0.25 ? "😔" : "😐";
      const dur = full.durationSec ? `${Math.round(full.durationSec)}s` : "";
      const domains = (a.lifeSections || []).map(s => s.domain);
      const tags = [
        ...(a.topics || []).slice(0, 5),
        ...domains.slice(0, 3),
      ].map(t => `#${t.replace(/\s+/g, "")}`).join(" ");

      const lines = [
        `${mood} ${full.title || "Untitled"}${dur ? ` · ${dur}` : ""}`,
        "",
        (a.standing || a.summary || "").slice(0, 300),
        tags ? `\n${tags}` : "",
      ].filter(Boolean);
      let caption = lines.join("\n");
      if (caption.length > 1024) caption = caption.slice(0, 1020) + "…";

      // Send the best available processed clip: prefer an applied effect (in
      // display order), then the plain compressed video, then the original.
      const videoUrl =
        DISPLAY_FIELD_ORDER.map((f) => full[f]).find(Boolean) ||
        full.compressedPath || full.mediaPath;
      if (!videoUrl) return;

      const res = await fetch(videoUrl);
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      const tmpFile = `/tmp/channel_${entryId}.mp4`;
      const fs = await import("node:fs/promises");
      await fs.writeFile(tmpFile, buf);

      await bot.api.sendVideo(CHANNEL_ID, new InputFile(tmpFile), { caption, parse_mode: undefined });
      await fs.unlink(tmpFile).catch(() => {});
      log("channel", `posted ${entryId} to ${CHANNEL_ID}`);
    } catch (e) {
      logErr("channel", "post failed:", e.message);
    }
  };
  runPipeline(entry._id, "", [], { notify, effects, onComplete });
}

export function startBot() {
  if (!BOT_TOKEN) {
    log("init", "no TELEGRAM_BOT_TOKEN — bot disabled");
    return null;
  }

  const bot = new Bot(BOT_TOKEN);

  // Store pending entries awaiting effect selection
  const pending = new Map(); // chatId → { entry, msgId }

  bot.command("start", (ctx) =>
    ctx.reply(
      "send me a video, round video, or voice note and i'll turn it into a diary entry.\n\n" +
      "add a caption to set the title.\n\n" +
      `i can apply ${EFFECT_KEYS.length} visual effects (analog, digital & artistic) — ` +
      "tap to toggle any combo, then ✅ apply, or hit 🎲 surprise.\n\n" +
      "commands:\n" +
      "/status — list recent entries and their pipeline status\n" +
      "/help — this message"
    )
  );

  bot.command("help", (ctx) =>
    ctx.reply(
      "send a video → i download it, let you pick effects, transcribe, analyze with AI, and send you the insights.\n\n" +
      `effects (${EFFECT_KEYS.length}): ${EFFECT_KEYS.map((k) => EFFECTS[k].label).join(", ")}\n\n` +
      "tap effects to toggle, ✅ apply to run the chosen set, 🎲 surprise for a random pick, or ✅ apply with none selected to skip effects.\n\n" +
      "caption = title\n" +
      "/status = recent entries"
    )
  );

  bot.command("status", async (ctx) => {
    const entries = await Entry.find()
      .sort({ recordedAt: -1 })
      .limit(5)
      .populate("analysis")
      .lean({ virtuals: true });

    if (!entries.length) return ctx.reply("no entries yet.");

    const lines = entries.map((e, i) => {
      const when = new Date(e.recordedAt).toLocaleString();
      const sentiment = e.analysis?.sentiment;
      const mood =
        sentiment == null ? "" :
        sentiment > 0.25 ? "😊" : sentiment < -0.25 ? "😔" : "😐";
      const title = e.title || "(untitled)";
      const dur = e.durationSec ? `${Math.round(e.durationSec)}s` : "?";
      return `${i + 1}. ${mood} ${title} — ${dur} — ${e.status} — ${when}`;
    });

    ctx.reply(lines.join("\n"));
  });

  // Handle effect selection callbacks (multi-select toggle keyboard)
  const setProcessing = async (ctx, effects) => {
    const caption = `effects: ${effectLabel(effects)}\nprocessing...`;
    try { await ctx.editMessageCaption({ caption }); }
    catch { await ctx.editMessageText(caption).catch(() => {}); }
  };

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!/^(fxt:|fxgo|fxrand|fxcancel|fxnoop)/.test(data)) return;

    const key = ctx.chat.id;
    const p = pending.get(key);

    // Category header / expired selection — just acknowledge.
    if (data === "fxnoop") return ctx.answerCallbackQuery();
    if (!p) return ctx.answerCallbackQuery({ text: "this one already ran — send a new video" });

    // Toggle an effect and re-render the keyboard in place.
    if (data.startsWith("fxt:")) {
      const fx = data.slice(4);
      if (!EFFECT_KEYS.includes(fx)) return ctx.answerCallbackQuery();
      p.selected.has(fx) ? p.selected.delete(fx) : p.selected.add(fx);
      await ctx.answerCallbackQuery({ text: `${EFFECTS[fx].label} ${p.selected.has(fx) ? "added" : "removed"}` });
      await ctx.editMessageReplyMarkup({ reply_markup: effectKeyboard(p.selected) }).catch(() => {});
      return;
    }

    if (data === "fxcancel") {
      pending.delete(key);
      await ctx.answerCallbackQuery({ text: "cancelled" });
      try { await ctx.editMessageCaption({ caption: "cancelled." }); }
      catch { await ctx.editMessageText("cancelled.").catch(() => {}); }
      return;
    }

    // Apply — either the accumulated selection or a random surprise pick.
    let effects;
    if (data === "fxrand") {
      effects = [...EFFECT_KEYS].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
    } else { // fxgo
      effects = [...p.selected];
    }
    await ctx.answerCallbackQuery();
    pending.delete(key);
    await setProcessing(ctx, effects);
    sendWithEffects(bot, ctx, p.entry, effects);
  });

  async function handleMedia(ctx, file, title, sourceLabel) {
    await ctx.reply(`downloading ${sourceLabel}...`);
    try {
      const entry = await ingestFile(ctx, file, title);
      const mediaPath = path.join(MEDIA_DIR, path.basename(entry.mediaPath));

      // Extract first frame for preview
      let previewPath = null;
      try {
        previewPath = `/tmp/preview_${entry._id}.jpg`;
        execSync(`ffmpeg -y -i "${mediaPath}" -frames:v 1 -vf "scale=480:-2" -update 1 -q:v 4 "${previewPath}"`, { timeout: 10000 });
      } catch { previewPath = null; }

      const caption = `downloaded: ${entry.title || "(untitled)"}\n\ntap to toggle effects, then ✅ apply — or 🎲 surprise:`;
      const keyboard = effectKeyboard(new Set());

      if (previewPath && fs.existsSync(previewPath)) {
        await ctx.replyWithPhoto(new InputFile(previewPath), {
          caption,
          reply_markup: keyboard,
        });
        fs.unlinkSync(previewPath);
      } else {
        await ctx.reply(caption, { reply_markup: keyboard });
      }

      pending.set(ctx.chat.id, { entry, selected: new Set() });
    } catch (e) {
      log("error", `${sourceLabel} handler failed:`, e.message);
      await ctx.reply(`error: ${e.message}`);
    }
  }

  bot.on("message:video", async (ctx) => {
    await handleMedia(ctx, ctx.message.video, ctx.message.caption || null, "video");
  });

  bot.on("message:video_note", async (ctx) => {
    await handleMedia(ctx, ctx.message.video_note, ctx.message.caption || null, "video note");
  });

  bot.on("message:voice", async (ctx) => {
    await handleMedia(ctx, ctx.message.voice, ctx.message.caption || null, "voice note");
  });

  bot.on("message:document", async (ctx) => {
    const file = ctx.message.document;
    const isVideo = VIDEO_TYPES.includes(file.mime_type);
    const isAudio = AUDIO_TYPES.includes(file.mime_type);
    if (!isVideo && !isAudio) {
      return ctx.reply("send a video or voice note, not a document.");
    }
    await handleMedia(ctx, file, ctx.message.caption || null, file.mime_type);
  });

  bot.catch((err) => { log("error", "bot error:", err.message); });

  bot.start({
    onStart: () => log("init", `bot running as @${bot.botInfo.username}`),
  });

  return bot;
}
