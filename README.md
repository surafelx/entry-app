# Entry App (MERN)

Record moments, transcribe them live, and let AI draft where you are in your
life — read back as a full-screen magazine spread. Mongoose models mirror the
original Prisma schema: **Entry** → Transcript (1:1), Segments (1:many),
Analysis (1:1).

## Features

- **Studio** — live webcam streaming, real-time audio waveform, in-browser
  recording (MediaRecorder), and **live speech-to-text captions** (Web Speech API).
- **Pipeline** — saved clips auto-advance `ingested → transcribing → analyzing →
  ready`; the timeline polls and updates live.
- **AI insights** — `claude-opus-4-8` drafts the moment into **life sections**
  (Work, Relationships, Health, …) plus a "where you are" read, mood, arc,
  energy, topics, ideas, and quotes. Falls back to local heuristics when no API
  key is set, so it always runs.
- **Magazine reader** — click a ready entry for a full-screen editorial spread
  with the recorded date/time, drop-cap lede, pull quotes, and life sections.

> Set `ANTHROPIC_API_KEY` in `server/.env` for real Claude analysis. Live
> captions need a Chromium browser (Web Speech API).

```
entry-app/
├── server/   Express + Mongoose API (ESM)
│   └── src/
│       ├── models/   Entry, Transcript, Segment, Analysis
│       ├── routes/   /api/entries CRUD
│       ├── db.js     mongoose connection
│       ├── seed.js   sample data
│       └── index.js  app entry
└── client/   React + Vite (proxies /api → :4000)
```

## Setup

Requires Node 18+ and a running MongoDB (local `mongod` or Atlas URI).

```bash
cd ~/entry-app
npm run install:all          # root + server + client deps
cp server/.env.example server/.env   # edit MONGODB_URI if needed
npm run seed                 # optional: load sample entry
npm run dev                  # server :4000 + client :5173
```

Open http://localhost:5173.

## API

| Method | Path               | Description                  |
| ------ | ------------------ | ---------------------------- |
| GET    | /api/health        | health check                 |
| GET    | /api/entries       | list entries (+ analysis)    |
| GET    | /api/entries/:id   | one entry (+ all relations)  |
| POST   | /api/entries          | create entry (JSON)          |
| POST   | /api/entries/upload   | upload a recorded clip (multipart) → runs pipeline |
| POST   | /api/entries/:id/analyze | (re)run transcribe + analyze |
| PATCH  | /api/entries/:id      | update (e.g. advance status) |
| DELETE | /api/entries/:id      | delete entry + media + related docs |

## Notes on the Prisma → Mongoose port

- `cuid` ids → Mongo `ObjectId` (`_id`).
- JSON-string columns on `Analysis` (emotions, topics, ideas, …) are now
  native arrays/objects — no `JSON.parse` needed.
- `Segment.embedding` is a `Number[]` (was `Bytes`), ready for Atlas Vector
  Search if you add it later.
- Relations are refs + populated virtuals on `Entry`.
