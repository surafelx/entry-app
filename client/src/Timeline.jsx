import { useRef, useEffect, useCallback, useState } from "react";

const BAR_COUNT = 120;

export default function Timeline({
  duration = 0,
  currentTime = 0,
  trimStart = 0,
  trimEnd = 0,
  waveform = null,
  onSeek,
  onTrimChange,
}) {
  const barRef = useRef(null);
  const [dragging, setDragging] = useState(null); // "start" | "end" | "playhead" | null

  const fmt = (s) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const pct = (val) => (duration > 0 ? (val / duration) * 100 : 0);

  const handleBarClick = useCallback(
    (e) => {
      if (dragging) return;
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = (e.clientX - rect.left) / rect.width;
      onSeek?.(x * duration);
    },
    [dragging, duration, onSeek]
  );

  const handleMouseDown = useCallback(
    (e, type) => {
      e.stopPropagation();
      setDragging(type);
    },
    []
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = x * duration;

      if (dragging === "start") {
        onTrimChange?.(Math.min(time, trimEnd - 0.5), trimEnd);
      } else if (dragging === "end") {
        onTrimChange?.(trimStart, Math.max(time, trimStart + 0.5));
      } else if (dragging === "playhead") {
        onSeek?.(time);
      }
    };

    const handleMouseUp = () => setDragging(null);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, duration, trimStart, trimEnd, onSeek, onTrimChange]);

  // Default waveform: uniform bars
  const bars = waveform || Array.from({ length: BAR_COUNT }, () => 0.3 + Math.random() * 0.4);

  return (
    <div className="timeline">
      <div className="timeline-bar" ref={barRef} onClick={handleBarClick}>
        {/* Waveform */}
        <div className="timeline-wave">
          {bars.map((h, i) => {
            const barTime = (i / bars.length) * duration;
            const inTrim = barTime >= trimStart && barTime <= trimEnd;
            return (
              <div
                key={i}
                className={`tw-bar ${inTrim ? "" : "dim"}`}
                style={{ height: `${Math.max(8, h * 100)}%` }}
              />
            );
          })}
        </div>

        {/* Trim region overlay */}
        <div
          className="trim-region"
          style={{
            left: `${pct(trimStart)}%`,
            width: `${pct(trimEnd) - pct(trimStart)}%`,
          }}
        >
          {/* Left handle */}
          <div
            className="trim-handle left"
            onMouseDown={(e) => handleMouseDown(e, "start")}
          />
          {/* Right handle */}
          <div
            className="trim-handle right"
            onMouseDown={(e) => handleMouseDown(e, "end")}
          />
        </div>

        {/* Playhead */}
        <div
          className="playhead"
          style={{ left: `${pct(currentTime)}%` }}
          onMouseDown={(e) => handleMouseDown(e, "playhead")}
        />
      </div>

      {/* Time labels */}
      <div className="timeline-times">
        <span className="tt-trim">{fmt(trimStart)}</span>
        <span className="tt-current">{fmt(currentTime)} / {fmt(duration)}</span>
        <span className="tt-trim">{fmt(trimEnd)}</span>
      </div>
    </div>
  );
}
