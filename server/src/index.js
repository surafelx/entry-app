import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { connectDB } from "./db.js";
import entriesRouter from "./routes/entries.js";
import livekitRouter from "./routes/livekit.js";
import notesRouter from "./routes/notes.js";
import { registerChatHandlers } from "./socket/chat.js";
import { startBot } from "./telegram.js";

const PORT = process.env.PORT || 4000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/entry_app";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_DIR = path.join(__dirname, "..", "media");
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const app = express();
const server = createServer(app);

// ── Socket.IO ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  CLIENT_ORIGIN,
  "http://localhost:5173",
  "https://client-lilac-eight-25.vercel.app",
  "https://client-ctt75ud6h-surafelxs-projects.vercel.app",
  "https://entry-app-0nts.onrender.com",
  "https://www.visualspam.et",
  "https://visualspam.et",
];
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.set("io", io);

// ── Express middleware ────────────────────────────────────────────────────
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Serve recorded/uploaded media for playback in the client (with CORS for cross-origin video).
app.use("/media", (req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}, express.static(MEDIA_DIR));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/entries", entriesRouter);
app.use("/api/livekit", livekitRouter);
app.use("/api/notes", notesRouter);

// ── Socket event handlers ────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  registerChatHandlers(io, socket);
  socket.on("disconnect", (reason) => {
    console.log(`[ws] client disconnected: ${socket.id} (${reason})`);
  });
});

// ── Error handler ────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

connectDB(MONGODB_URI)
  .then(() => {
    server.listen(PORT, () =>
      console.log(`[api+ws] listening on :${PORT}`)
    );
    startBot();
  })
  .catch((err) => {
    console.error("[db] connection failed:", err.message);
    process.exit(1);
  });
