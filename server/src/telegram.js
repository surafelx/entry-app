// Telegram bot — receives video/audio messages and creates diary entries.
//
// Usage: send any video, round video, voice note, or video note to the bot.
// It downloads the file, uploads to Cloudinary, creates an entry, and kicks off the pipeline.

import { Bot } from "grammy";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Entry from "./models/Entry.js";
import { MEDIA_DIR } from "./index.js";
import { runPipeline } from "./pipeline.js";

const log = (tag, ...a) => console.log(`[tg:${tag}]`, ...a);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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

  // Use local path — Cloudinary upload happens after processing completes
  const mediaPath = `/media/${filename}`;

  const entry = await Entry.create({
    recordedAt: new Date(),
    source: "upload",
    title: title || file.file_name || null,
    mediaPath,
    status: "ingested",
  });
  log("ingest", `created entry ${entry._id}`);

  runPipeline(entry._id, "", []);
  return entry;
}

export function startBot() {
  if (!BOT_TOKEN) {
    log("init", "no TELEGRAM_BOT_TOKEN — bot disabled");
    return null;
  }

  const bot = new Bot(BOT_TOKEN);

  bot.command("start", (ctx) =>
    ctx.reply(
      "send me a video, round video, or voice note and i'll turn it into a diary entry.\n\n" +
      "add a caption to set the title.\n\n" +
      "commands:\n" +
      "/status — list recent entries and their pipeline status\n" +
      "/help — this message"
    )
  );

  bot.command("help", (ctx) =>
    ctx.reply(
      "send a video → i download it, transcribe it, analyze it with AI, and generate a cartoonified version.\n\n" +
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

  bot.on("message:video", async (ctx) => {
    const file = ctx.message.video;
    const title = ctx.message.caption || null;
    await ctx.reply("downloading video...");
    try {
      const entry = await ingestFile(ctx, file, title);
      await ctx.reply(
        `entry created: ${entry.title || "(untitled)"}\nstatus: processing\n\n` +
        "i'll transcribe, analyze, and cartoonify it. use /status to check progress."
      );
    } catch (e) {
      log("error", "video handler failed:", e.message);
      await ctx.reply(`error: ${e.message}`);
    }
  });

  bot.on("message:video_note", async (ctx) => {
    const file = ctx.message.video_note;
    const title = ctx.message.caption || null;
    await ctx.reply("downloading video note...");
    try {
      const tgFile = await ctx.api.getFile(file.file_id);
      const filename = mediaFilename(null, "video/mp4");
      const destPath = path.join(MEDIA_DIR, filename);

      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgFile.file_path}`;
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`Telegram download failed: ${res.status}`);

      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destPath, buf);

      const mediaPath = `/media/${filename}`;

      const entry = await Entry.create({
        recordedAt: new Date(),
        source: "upload",
        title: title || "video note",
        mediaPath,
        status: "ingested",
      });

      runPipeline(entry._id, "", []);

      await ctx.reply(
        `entry created: ${entry.title}\nstatus: processing\n\n` +
        "use /status to check progress."
      );
    } catch (e) {
      log("error", "video_note handler failed:", e.message);
      await ctx.reply(`error: ${e.message}`);
    }
  });

  bot.on("message:voice", async (ctx) => {
    const file = ctx.message.voice;
    const title = ctx.message.caption || null;
    await ctx.reply("downloading voice note...");
    try {
      const tgFile = await ctx.api.getFile(file.file_id);
      const filename = mediaFilename(null, file.mime_type || "audio/ogg");
      const destPath = path.join(MEDIA_DIR, filename);

      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgFile.file_path}`;
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`Telegram download failed: ${res.status}`);

      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(destPath, buf);

      const mediaPath = `/media/${filename}`;

      const entry = await Entry.create({
        recordedAt: new Date(),
        source: "upload",
        title: title || "voice note",
        mediaPath,
        status: "ingested",
      });

      runPipeline(entry._id, "", []);

      await ctx.reply(
        `entry created: ${entry.title}\nstatus: processing\n\n` +
        "use /status to check progress."
      );
    } catch (e) {
      log("error", "voice handler failed:", e.message);
      await ctx.reply(`error: ${e.message}`);
    }
  });

  bot.on("message:document", async (ctx) => {
    const file = ctx.message.document;
    const isVideo = VIDEO_TYPES.includes(file.mime_type);
    const isAudio = AUDIO_TYPES.includes(file.mime_type);
    if (!isVideo && !isAudio) {
      return ctx.reply("send a video or voice note, not a document.");
    }
    const title = ctx.message.caption || null;
    await ctx.reply(`downloading ${file.mime_type}...`);
    try {
      const entry = await ingestFile(ctx, file, title);
      await ctx.reply(
        `entry created: ${entry.title || "(untitled)"}\nstatus: processing\n\n` +
        "use /status to check progress."
      );
    } catch (e) {
      log("error", "document handler failed:", e.message);
      await ctx.reply(`error: ${e.message}`);
    }
  });

  bot.catch((err) => { log("error", "bot error:", err.message); });

  bot.start({
    onStart: () => log("init", `bot running as @${bot.botInfo.username}`),
  });

  return bot;
}
