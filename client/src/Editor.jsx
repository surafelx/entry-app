import { useEffect, useRef, useState, useCallback } from "react";
import Timeline from "./Timeline.jsx";
import { exportVideo } from "./exportVideo.js";
import { processFrame, STYLE_PRESETS } from "./videoFx.js";
import { uploadEntry, reEditEntry } from "./api.js";

const TABS = [
  { id: "trim", label: "Trim" },
  { id: "audio", label: "Audio" },
  { id: "style", label: "Style" },
  { id: "effects", label: "Effects" },
  { id: "text", label: "Text" },
];

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const DEFAULTS = {
  trimStart: 0,
  trimEnd: 0,
  volume: 1.2,
  speed: 1,
  noiseReduction: true,
  brightness: 1.15,
  contrast: 1.3,
  saturation: 1.4,
  blur: 0,
  grayscale: 0,
  sepia: 0.15,
  hueRotate: 0,
  overlayText: "",
  overlaySize: 48,
  overlayColor: "#ffffff",
  overlayPosition: "bottom",
};

export default function Editor({
  sourceUrl,
  sourceBlob,
  trimEnd: initialTrimEnd,
  transcript,
  frames,
  source,
  title,
  entry,
  onSaved,
  onCancel,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const [duration, setDuration] = useState(initialTrimEnd || 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState("ready"); // ready | exporting | saving
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("trim");
  const [waveform, setWaveform] = useState(null);

  // Edit state
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(initialTrimEnd || 0);
  const [volume, setVolume] = useState(DEFAULTS.volume);
  const [speed, setSpeed] = useState(DEFAULTS.speed);
  const [noiseReduction, setNoiseReduction] = useState(DEFAULTS.noiseReduction);
  const [brightness, setBrightness] = useState(DEFAULTS.brightness);
  const [contrast, setContrast] = useState(DEFAULTS.contrast);
  const [saturation, setSaturation] = useState(DEFAULTS.saturation);
  const [blur, setBlur] = useState(DEFAULTS.blur);
  const [grayscale, setGrayscale] = useState(DEFAULTS.grayscale);
  const [sepia, setSepia] = useState(DEFAULTS.sepia);
  const [hueRotate, setHueRotate] = useState(DEFAULTS.hueRotate);
  const [overlayText, setOverlayText] = useState(DEFAULTS.overlayText);
  const [overlaySize, setOverlaySize] = useState(DEFAULTS.overlaySize);
  const [overlayColor, setOverlayColor] = useState(DEFAULTS.overlayColor);
  const [overlayPosition, setOverlayPosition] = useState(DEFAULTS.overlayPosition);

  // Stylize state — defaults to the cartoon look.
  const [stylePreset, setStylePreset] = useState("cartoon");
  const [pixelSize, setPixelSize] = useState(1);
  const [posterize, setPosterize] = useState(5);
  const [dither, setDither] = useState("none");
  const [duotone, setDuotone] = useState(null);

  const applyPreset = (preset) => {
    setStylePreset(preset.id);
    const fx = preset.fx;
    setPixelSize(fx.pixelSize ?? 1);
    setPosterize(fx.posterize ?? 0);
    setDither(fx.dither ?? "none");
    setDuotone(fx.duotone ?? null);
    if (fx.saturation != null) setSaturation(fx.saturation);
    if (fx.contrast != null) setContrast(fx.contrast);
    if (fx.brightness != null) setBrightness(fx.brightness);
    if (fx.sepia != null) setSepia(fx.sepia);
    if (preset.id === "none") {
      setSaturation(DEFAULTS.saturation);
      setContrast(DEFAULTS.contrast);
      setBrightness(DEFAULTS.brightness);
      setSepia(DEFAULTS.sepia);
    }
  };

  // AI suggestions from entry analysis
  const suggestions = entry?.analysis?.suggestions || [];

  // Load source video
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !sourceUrl) return;
    v.src = sourceUrl;
    v.load();
    v.onloadedmetadata = () => {
      const dur = v.duration;
      setDuration(dur);
      setTrimEnd(initialTrimEnd || dur);
      setPhase("ready");
    };
    v.ontimeupdate = () => {
      setCurrentTime(v.currentTime);
      // Stop at trim end
      if (v.currentTime >= trimEnd) {
        v.pause();
        setPlaying(false);
      }
    };
    v.onended = () => {
      // Loop within trim region
      v.currentTime = trimStart;
      v.play();
    };
  }, [sourceUrl]);

  // Draw frame preview on canvas — always running when source loaded
  const drawFrame = useCallback(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) {
      rafRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    const ctx = c.getContext("2d", { willReadFrequently: true });
    processFrame(v, c, ctx, {
      brightness, contrast, saturation, blur, grayscale, sepia, hueRotate,
      pixelSize, posterize, dither, duotone, grain: 0.07, vignette: true,
      overlayText, overlaySize, overlayColor, overlayPosition,
    });

    rafRef.current = requestAnimationFrame(drawFrame);
  }, [brightness, contrast, saturation, blur, grayscale, sepia, hueRotate, overlayText, overlayColor, overlaySize, overlayPosition, pixelSize, posterize, dither, duotone]);

  // Start render loop once source is loaded
  useEffect(() => {
    if (sourceUrl) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(drawFrame);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [sourceUrl, drawFrame]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
        v.currentTime = trimStart;
      }
      v.playbackRate = speed;
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const seekTo = (time) => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = time;
      setCurrentTime(time);
    }
  };

  const applySuggestion = (suggestion) => {
    const p = suggestion.params || {};
    if (suggestion.type === "effect") {
      if (p.sepia != null) setSepia(p.sepia);
      if (p.brightness != null) setBrightness(p.brightness);
      if (p.grayscale != null) setGrayscale(p.grayscale);
      if (p.contrast != null) setContrast(p.contrast);
      if (p.saturation != null) setSaturation(p.saturation);
      setActiveTab("effects");
    } else if (suggestion.type === "overlay") {
      if (p.text) setOverlayText(p.text);
      if (p.position) setOverlayPosition(p.position);
      setActiveTab("text");
    } else if (suggestion.type === "audio") {
      if (p.noiseReduction) setNoiseReduction(true);
      if (p.volume != null) setVolume(p.volume);
      setActiveTab("audio");
    } else if (suggestion.type === "trim") {
      if (p.start != null) setTrimStart(p.start);
      if (p.end != null) setTrimEnd(p.end);
      setActiveTab("trim");
    }
  };

  const handleSave = async () => {
    setPhase("exporting");
    setProgress(0);
    setError(null);

    try {
      const blob = await exportVideo({
        sourceUrl,
        trimStart,
        trimEnd,
        volume,
        speed,
        noiseReduction,
        brightness,
        contrast,
        saturation,
        blur,
        grayscale,
        sepia,
        hueRotate,
        overlayText,
        overlaySize,
        overlayColor,
        overlayPosition,
        pixelSize,
        posterize,
        dither,
        duotone,
        maxHeight: 720,
        onProgress: setProgress,
      });

      setPhase("saving");

      const filename = `edited-${Date.now()}.webm`;

      if (entry) {
        // Post-upload: re-edit existing entry
        await reEditEntry(entry._id, {
          blob,
          filename,
          transcript: transcript || "",
          frames: frames || [],
          title: title || entry.title,
          durationSec: trimEnd - trimStart,
        });
      } else {
        // Pre-upload: new entry
        await uploadEntry({
          blob,
          filename,
          source: source || "checkin",
          title: title || "",
          durationSec: trimEnd - trimStart,
          transcript: transcript || "",
          frames: frames || [],
        });
      }

      onSaved?.();
    } catch (err) {
      setError(err.message);
      setPhase("ready");
    }
  };

  const fmt = (s) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const isWorking = phase === "exporting" || phase === "saving";

  return (
    <div className="editor-overlay">
      <div className="editor">
        <div className="editor-head">
          <h2>Editor</h2>
          <div className="editor-actions">
            <button className="btn ghost" onClick={onCancel} disabled={isWorking}>
              Cancel
            </button>
            <button className="btn primary" onClick={handleSave} disabled={isWorking}>
              {phase === "exporting"
                ? `Exporting ${Math.round(progress * 100)}%`
                : phase === "saving"
                ? "Saving..."
                : entry
                ? "Save & Re-analyze"
                : "Save & Upload"}
            </button>
          </div>
        </div>

        {error && <p className="editor-error">{error}</p>}

        {/* AI Suggestions */}
        {suggestions.length > 0 && (
          <div className="editor-suggestions">
            <span className="es-label">AI suggests:</span>
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="editor-chip"
                onClick={() => applySuggestion(s)}
                title={s.reason}
                disabled={isWorking}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Preview */}
        <div className="editor-preview">
          <video
            ref={videoRef}
            style={{ display: "none" }}
            muted
            playsInline
            preload="auto"
          />
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="editor-canvas"
          />
          <div className="editor-controls-row">
            <button className="btn ghost small" onClick={togglePlay} disabled={isWorking}>
              {playing ? "⏸" : "▶"}
            </button>
            <span className="ec-time">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
            {playing && (
              <span className="ec-speed">{speed}x</span>
            )}
          </div>
        </div>

        {/* Timeline */}
        <Timeline
          duration={duration}
          currentTime={currentTime}
          trimStart={trimStart}
          trimEnd={trimEnd}
          waveform={waveform}
          onSeek={seekTo}
          onTrimChange={(start, end) => {
            setTrimStart(start);
            setTrimEnd(end);
          }}
        />

        {/* Tabs */}
        <div className="editor-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${activeTab === t.id ? "on" : ""}`}
              onClick={() => setActiveTab(t.id)}
              disabled={isWorking}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        <div className="editor-panel">
          {activeTab === "trim" && (
            <div className="ep-trim">
              <label className="ep-row">
                <span>Start</span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={trimStart}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setTrimStart(Math.min(v, trimEnd - 0.5));
                  }}
                />
                <span className="ep-val">{fmt(trimStart)}</span>
              </label>
              <label className="ep-row">
                <span>End</span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={trimEnd}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setTrimEnd(Math.max(v, trimStart + 0.5));
                  }}
                />
                <span className="ep-val">{fmt(trimEnd)}</span>
              </label>
              <p className="ep-hint">Trimmed: {fmt(trimEnd - trimStart)}</p>
            </div>
          )}

          {activeTab === "audio" && (
            <div className="ep-audio">
              <label className="ep-row">
                <span>Volume</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
                <span className="ep-val">{Math.round(volume * 100)}%</span>
              </label>
              <div className="ep-row">
                <span>Speed</span>
                <div className="speed-pills">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      className={`pill ${speed === s ? "on" : ""}`}
                      onClick={() => setSpeed(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
              <label className="ep-row">
                <span>Noise Reduction</span>
                <button
                  className={`toggle ${noiseReduction ? "on" : ""}`}
                  onClick={() => setNoiseReduction(!noiseReduction)}
                >
                  {noiseReduction ? "ON" : "OFF"}
                </button>
              </label>
            </div>
          )}

          {activeTab === "style" && (
            <div className="ep-style">
              <div className="style-presets">
                {STYLE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`style-card ${stylePreset === p.id ? "on" : ""}`}
                    onClick={() => applyPreset(p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="ep-row">
                <span>Pixelate</span>
                <input
                  type="range"
                  min={1}
                  max={16}
                  step={1}
                  value={pixelSize}
                  onChange={(e) => { setPixelSize(Number(e.target.value)); setStylePreset("custom"); }}
                />
                <span className="ep-val">{pixelSize > 1 ? `${pixelSize}px` : "off"}</span>
              </label>
              <label className="ep-row">
                <span>Color levels</span>
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={posterize}
                  onChange={(e) => { setPosterize(Number(e.target.value)); setStylePreset("custom"); }}
                />
                <span className="ep-val">{posterize > 1 ? posterize : "off"}</span>
              </label>
              <label className="ep-row">
                <span>Dither</span>
                <button
                  className={`toggle ${dither === "bayer" ? "on" : ""}`}
                  onClick={() => { setDither(dither === "bayer" ? "none" : "bayer"); setStylePreset("custom"); }}
                >
                  {dither === "bayer" ? "ON" : "OFF"}
                </button>
              </label>
              <p className="ep-hint">
                Cartoonish + dithered looks render smaller and load faster.
              </p>
            </div>
          )}

          {activeTab === "effects" && (
            <div className="ep-effects">
              {[
                { label: "Brightness", val: brightness, set: setBrightness, min: 0, max: 2, step: 0.05 },
                { label: "Contrast", val: contrast, set: setContrast, min: 0, max: 2, step: 0.05 },
                { label: "Saturation", val: saturation, set: setSaturation, min: 0, max: 2, step: 0.05 },
                { label: "Blur", val: blur, set: setBlur, min: 0, max: 10, step: 0.5 },
                { label: "Grayscale", val: grayscale, set: setGrayscale, min: 0, max: 1, step: 0.05 },
                { label: "Sepia", val: sepia, set: setSepia, min: 0, max: 1, step: 0.05 },
                { label: "Hue Rotate", val: hueRotate, set: setHueRotate, min: 0, max: 360, step: 5 },
              ].map(({ label, val, set, min, max, step }) => (
                <label key={label} className="ep-row">
                  <span>{label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) => set(Number(e.target.value))}
                  />
                  <span className="ep-val">
                    {label === "Hue Rotate" ? `${val}°` : Math.round(val * 100) + "%"}
                  </span>
                </label>
              ))}
              <button
                className="btn ghost small"
                onClick={() => {
                  setBrightness(1);
                  setContrast(1);
                  setSaturation(1);
                  setBlur(0);
                  setGrayscale(0);
                  setSepia(0);
                  setHueRotate(0);
                }}
              >
                Reset effects
              </button>
            </div>
          )}

          {activeTab === "text" && (
            <div className="ep-text">
              <label className="ep-row">
                <span>Text</span>
                <input
                  className="ep-input"
                  type="text"
                  placeholder="Enter overlay text..."
                  value={overlayText}
                  onChange={(e) => setOverlayText(e.target.value)}
                  maxLength={100}
                />
              </label>
              <label className="ep-row">
                <span>Size</span>
                <input
                  type="range"
                  min={16}
                  max={120}
                  step={2}
                  value={overlaySize}
                  onChange={(e) => setOverlaySize(Number(e.target.value))}
                />
                <span className="ep-val">{overlaySize}px</span>
              </label>
              <label className="ep-row">
                <span>Color</span>
                <input
                  type="color"
                  value={overlayColor}
                  onChange={(e) => setOverlayColor(e.target.value)}
                  className="ep-color"
                />
              </label>
              <div className="ep-row">
                <span>Position</span>
                <div className="speed-pills">
                  {["top", "center", "bottom"].map((p) => (
                    <button
                      key={p}
                      className={`pill ${overlayPosition === p ? "on" : ""}`}
                      onClick={() => setOverlayPosition(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Export progress */}
        {isWorking && (
          <div className="export-progress">
            <div className="ep-bar" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
