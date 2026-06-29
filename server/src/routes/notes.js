import { Router } from "express";
import Note from "../models/Note.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get("/", wrap(async (_req, res) => {
  const notes = await Note.find().sort({ createdAt: -1 }).limit(200);
  res.json(notes);
}));

router.post("/", wrap(async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text required" });
  const note = await Note.create({ text: text.trim() });
  res.status(201).json(note);
}));

export default router;
