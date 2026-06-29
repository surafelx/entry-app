import { useEffect, useRef, useState, useCallback } from "react";
import { uploadEntry } from "./api.js";

const SOURCES = [
  { id: "checkin", label: "Check-in" },
  { id: "stream_vod", label: "Stream VOD" },
  { id: "upload", label: "Upload" },
];

const fmt = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

// Picks a webm mime the browser actually supports.
function pickMime() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
}

export default function Recorder({ onSaved }) {
  const liveRef = useRef(null); // live camera <video>
  const canvasRef = useRef(null); // waveform
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const rafRef = useRef(0);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const timerRef = useRef(0);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef(""); // accumulated final transcript
  const framesRef = useRef([]); // captured still frames (data-URLs)
  const frameTimerRef = useRef(0);

  const [phase, setPhase] = useState("idle"); // idle | live | recording | review | edit
  const [elapsed, setElapsed] = useState(0);
  const [recorded, setRecorded] = useState(null); // { url, blob, duration, transcript }
  const [source, setSource] = useState("checkin");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState(""); // live interim caption
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const SpeechRecognition =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  // ---- live audio waveform ----------------------------------------------
  const drawWave = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    const buf = new Uint8Array(analyser.frequencyBinCount);

    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      analyser.getByteTimeDomainData(buf);
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#FF4D2E");
      grad.addColorStop(0.5, "#4D5DFF");
      grad.addColorStop(1, "#FF4D2E");
      ctx.lineWidth = 3;
      ctx.strokeStyle = grad;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      const slice = w / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] / 128.0;
        const y = (v * h) / 2;
        const x = i * slice;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    render();
  }, []);

  // ---- camera on/off -----------------------------------------------------
  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      if (liveRef.current) liveRef.current.srcObject = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const sourceNode = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      sourceNode.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;

      setPhase("live");
      drawWave();
    } catch (e) {
      setError(
        e.name === "NotAllowedError"
          ? "Camera/mic permission denied."
          : e.message
      );
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }

  // ---- live transcription (Web Speech API) -------------------------------
  function startTranscription() {
    if (!SpeechRecognition) return; // unsupported (e.g. Firefox) — skip gracefully
    transcriptRef.current = "";
    setCaption("");
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) transcriptRef.current += t + " ";
        else interim += t;
      }
      setCaption(interim || transcriptRef.current.slice(-90));
    };
    rec.onerror = () => {}; // ignore (no-speech, aborted, etc.)
    rec.onend = () => {
      // Auto-restart while still recording (the API stops on silence).
      if (recognitionRef.current === rec && phase === "recording") {
        try {
          rec.start();
        } catch {}
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {}
  }

  function stopTranscription() {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.stop();
      } catch {}
    }
  }

  // ---- visual frame capture ----------------------------------------------
  // Grab a downscaled still from the live camera for vision analysis.
  function captureFrame() {
    const v = liveRef.current;
    if (!v || !v.videoWidth || framesRef.current.length >= 4) return;
    const w = 512;
    const h = Math.round((v.videoHeight / v.videoWidth) * w) || 288;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(v, 0, 0, w, h);
    framesRef.current.push(c.toDataURL("image/jpeg", 0.7));
  }

  // ---- recording ---------------------------------------------------------
  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    framesRef.current = [];
    startTranscription();
    captureFrame(); // opening frame
    frameTimerRef.current = setInterval(captureFrame, 4000); // ~every 4s, max 4
    const mimeType = pickMime();
    const rec = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {});
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: mimeType || "video/webm",
      });
      const url = URL.createObjectURL(blob);
      setRecorded({
        url,
        blob,
        duration: timerRef.current,
        transcript: transcriptRef.current.trim(),
        frames: framesRef.current.slice(),
      });
      setPhase("review");
    };
    rec.start();
    recorderRef.current = rec;
    setPhase("recording");
    setElapsed(0);
    timerRef.current = 0;
    const started = Date.now();
    const tick = setInterval(() => {
      timerRef.current = (Date.now() - started) / 1000;
      setElapsed(timerRef.current);
    }, 200);
    rec._timer = tick;
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    clearInterval(rec._timer);
    clearInterval(frameTimerRef.current);
    captureFrame(); // closing frame
    stopTranscription();
    setCaption("");
    rec.stop();
  }

  // ---- save / discard ----------------------------------------------------
  async function save() {
    if (!recorded) return;
    setSaving(true);
    setError(null);
    try {
      await uploadEntry({
        blob: recorded.blob,
        filename: `recording-${Date.now()}.webm`,
        source,
        title: title.trim(),
        durationSec: recorded.duration,
        transcript: recorded.transcript,
        frames: recorded.frames,
      });
      URL.revokeObjectURL(recorded.url);
      setRecorded(null);
      setTitle("");
      setPhase("live");
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (recorded) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setPhase("live");
  }

  function shutdown() {
    clearInterval(frameTimerRef.current);
    stopTranscription();
    stopStream();
    if (recorded) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setCaption("");
    setPhase("idle");
  }

  useEffect(() => () => stopStream(), []); // cleanup on unmount

  const live = phase === "live" || phase === "recording";

  return (
    <section className="studio glass">
      <div className="studio-head">
        <span className="dot-rec" data-on={phase === "recording"} />
        <h2>Studio</h2>
        <div className="src-pills">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              className={`spill ${source === s.id ? "on" : ""}`}
              onClick={() => setSource(s.id)}
              disabled={phase === "recording"}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stage">
        {/* Live camera stream */}
        <video
          ref={liveRef}
          className="stage-video"
          autoPlay
          muted
          playsInline
          style={{ display: live ? "block" : "none" }}
        />

        {/* Recorded review */}
        {phase === "review" && recorded && (
          <video
            className="stage-video"
            src={recorded.url}
            controls
            autoPlay
            loop
          />
        )}

        {/* Idle splash */}
        {phase === "idle" && (
          <div className="stage-idle">
            <div className="orb" />
            <p>Camera off</p>
            <button className="btn primary" onClick={startCamera}>
              ◉ Start camera
            </button>
          </div>
        )}

        {/* HUD */}
        {phase === "recording" && (
          <div className="hud">
            <span className="rec-badge">● REC {fmt(elapsed)}</span>
          </div>
        )}
        {phase === "recording" && caption && (
          <div className="caption">{caption}</div>
        )}
        {live && <canvas ref={canvasRef} width={640} height={70} className="wave" />}
      </div>

      <div className="studio-controls">
        {phase === "live" && (
          <>
            <button className="btn rec" onClick={startRecording}>
              ● Record
            </button>
            <button className="btn ghost" onClick={shutdown}>
              Stop camera
            </button>
          </>
        )}
        {phase === "recording" && (
          <button className="btn stop" onClick={stopRecording}>
            ■ Stop
          </button>
        )}
        {phase === "review" && (
          <div className="review-bar">
            <input
              className="title-input"
              placeholder="Give this moment a title…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "✓ Save & analyze"}
            </button>
            <button className="btn ghost" onClick={discard} disabled={saving}>
              Retake
            </button>
          </div>
        )}
      </div>

      {phase === "review" && (
        <p className="transcript-preview">
          {recorded?.transcript
            ? `“${recorded.transcript.slice(0, 220)}${recorded.transcript.length > 220 ? "…" : ""}”`
            : SpeechRecognition
            ? "No speech captured — you can still save the clip."
            : "Live transcription isn’t supported in this browser (try Chrome)."}
          {recorded?.frames?.length > 0 && (
            <span className="frame-note">
              {" "}
              · {recorded.frames.length} frame
              {recorded.frames.length > 1 ? "s" : ""} captured for visual analysis
            </span>
          )}
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
