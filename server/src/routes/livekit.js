import { Router } from "express";
import { AccessToken, RoomServiceClient, EgressClient } from "livekit-server-sdk";
import Entry from "../models/Entry.js";
import Transcript from "../models/Transcript.js";
import Segment from "../models/Segment.js";
import Analysis from "../models/Analysis.js";
import ChatRoom from "../models/ChatRoom.js";
import { MEDIA_DIR } from "../index.js";
import { runPipeline } from "../pipeline.js";
import path from "node:path";
import fs from "node:fs";

const router = Router();

const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";

let roomService = null;
let egressClient = null;

if (LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET) {
  roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

// ── Generate access token ────────────────────────────────────────────────
router.post("/token", async (req, res) => {
  try {
    const { roomName, participantName } = req.body;
    if (!roomName || !participantName) {
      return res.status(400).json({ error: "roomName and participantName required" });
    }
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(503).json({ error: "LiveKit not configured" });
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participantName,
      ttl: "6h",
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canUpdateOwnMetadata: true,
    });

    const token = await at.toJwt();
    res.json({ token, roomName });
  } catch (err) {
    console.error("[livekit] token error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Create room ──────────────────────────────────────────────────────────
router.post("/room", async (req, res) => {
  try {
    const { name, maxParticipants = 20 } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    if (!roomService) return res.status(503).json({ error: "LiveKit not configured" });

    const room = await roomService.createRoom({
      name,
      emptyTimeout: 10 * 60,
      maxParticipants,
    });

    // Create a chat room for this stream
    await ChatRoom.findOneAndUpdate(
      { type: "stream", entryId: null, name: `Stream: ${name}` },
      { type: "stream", entryId: null, name: `Stream: ${name}` },
      { upsert: true, new: true }
    );

    res.json(room);
  } catch (err) {
    console.error("[livekit] room error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── List rooms ───────────────────────────────────────────────────────────
router.get("/rooms", async (_req, res) => {
  try {
    if (!roomService) return res.json([]);
    const rooms = await roomService.listRooms();
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start recording ──────────────────────────────────────────────────────
router.post("/record/start", async (req, res) => {
  try {
    const { roomName } = req.body;
    if (!roomName) return res.status(400).json({ error: "roomName required" });
    if (!egressClient) return res.status(503).json({ error: "LiveKit not configured" });

    const info = await egressClient.startRoomCompositeEgress(roomName, {
      file: {
        filepath: `recordings/${roomName}/{time}.mp4`,
      },
    });
    res.json({ egressId: info.egressId });
  } catch (err) {
    console.error("[livekit] record start error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Stop recording ───────────────────────────────────────────────────────
router.post("/record/stop", async (req, res) => {
  try {
    const { egressId } = req.body;
    if (!egressId) return res.status(400).json({ error: "egressId required" });
    if (!egressClient) return res.status(503).json({ error: "LiveKit not configured" });

    await egressClient.stopEgress(egressId);
    res.json({ stopped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── End stream — create Entry from recording ─────────────────────────────
router.post("/stream/end", async (req, res) => {
  try {
    const { roomName, title, recordedAt } = req.body;
    if (!roomName) return res.status(400).json({ error: "roomName required" });

    // Find or create entry for this stream
    const entry = await Entry.findOneAndUpdate(
      { title: `Stream: ${roomName}`, source: "stream_vod" },
      {
        title: title || `Stream: ${roomName}`,
        source: "stream_vod",
        recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
        mediaPath: "", // Will be set when recording is available
        status: "ingested",
      },
      { upsert: true, new: true }
    );

    // Run pipeline (will handle missing media gracefully)
    runPipeline(entry._id, "", []).catch(() => {});

    res.json({ entry, status: "ingested" });
  } catch (err) {
    console.error("[livekit] stream end error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
