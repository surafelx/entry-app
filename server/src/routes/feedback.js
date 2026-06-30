import { Router } from "express";
import Feedback from "../models/Feedback.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get("/", wrap(async (_req, res) => {
  const items = await Feedback.find().sort({ createdAt: -1 }).limit(100);
  res.json(items);
}));

router.post("/", wrap(async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text required" });
  const feedback = await Feedback.create({ text: text.trim() });
  res.status(201).json(feedback);
}));

export default router;
