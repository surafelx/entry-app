// Thin fetch wrapper. Vite proxies /api to the Express server in dev.
async function request(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const listEntries = () => request("/entries");
export const getEntry = (id) => request(`/entries/${id}`);
export const createEntry = (data) =>
  request("/entries", { method: "POST", body: JSON.stringify(data) });
export const deleteEntry = (id) =>
  request(`/entries/${id}`, { method: "DELETE" });

// Upload a recorded/selected clip as multipart form-data.
export async function uploadEntry({ blob, filename, source, title, durationSec, transcript, frames }) {
  const fd = new FormData();
  fd.append("media", blob, filename);
  fd.append("source", source);
  if (title) fd.append("title", title);
  if (durationSec != null) fd.append("durationSec", String(durationSec));
  if (transcript) fd.append("transcript", transcript);
  if (frames?.length) fd.append("frames", JSON.stringify(frames));
  fd.append("recordedAt", new Date().toISOString());
  const res = await fetch("/api/entries/upload", { method: "POST", body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

// Re-edit an existing entry: replace media, re-run pipeline.
export async function reEditEntry(id, { blob, filename, transcript, frames, title, durationSec }) {
  const fd = new FormData();
  fd.append("media", blob, filename);
  if (title) fd.append("title", title);
  if (durationSec != null) fd.append("durationSec", String(durationSec));
  if (transcript) fd.append("transcript", transcript);
  if (frames?.length) fd.append("frames", JSON.stringify(frames));
  const res = await fetch(`/api/entries/${id}/re-edit`, { method: "POST", body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Re-edit failed: ${res.status}`);
  }
  return res.json();
}

// ── LiveKit ──────────────────────────────────────────────────────────────
export const createLiveKitToken = (roomName, participantName) =>
  request("/livekit/token", {
    method: "POST",
    body: JSON.stringify({ roomName, participantName }),
  });

export const createLiveKitRoom = (name, maxParticipants) =>
  request("/livekit/room", {
    method: "POST",
    body: JSON.stringify({ name, maxParticipants }),
  });

export const listLiveKitRooms = () => request("/livekit/rooms");

export const startRecording = (roomName) =>
  request("/livekit/record/start", {
    method: "POST",
    body: JSON.stringify({ roomName }),
  });

export const stopRecording = (egressId) =>
  request("/livekit/record/stop", {
    method: "POST",
    body: JSON.stringify({ egressId }),
  });

export const endStream = (roomName, title) =>
  request("/livekit/stream/end", {
    method: "POST",
    body: JSON.stringify({ roomName, title, recordedAt: new Date().toISOString() }),
  });
