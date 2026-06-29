import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { listEntries, getEntry, deleteEntry, listNotes, createNote } from "./api.js";
import {
  WORKING, playSrc, moodLabel, sentimentEmoji,
  fmtDate, fmtTime, timeAgo, aggregateLife,
} from "./lib.js";
import { createMusicGen } from "./music.js";
import { createAudioFX } from "./audioFx.js";
import Recorder from "./Recorder.jsx";

const ARC = { rising: "↗", falling: "↘", flat: "→" };
const mmss = (s) => {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

// Draw a static dither pattern on a canvas (Bayer 4x4 ordered dither)
function drawDitherCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const BAYER = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const threshold = BAYER[y & 3][x & 3] / 16;
      const v = threshold < 0.5 ? 0 : 255;
      img.data[i] = img.data[i+1] = img.data[i+2] = v;
      img.data[i+3] = 12;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Calendar helpers
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function monthKey(d) { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`; }
function monthLabel(key) { const [y, m] = key.split("-"); return `${MONTH_NAMES[parseInt(m)-1]} ${y}`; }
function groupByMonth(entries) {
  const groups = {};
  for (const e of entries) {
    const k = monthKey(e.recordedAt);
    (groups[k] ||= []).push(e);
  }
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
}

const STATUS_LABELS = { ingested: "Queued", transcribing: "Transcribing...", analyzing: "Analyzing...", ready: "Ready", error: "Error" };
const NAV = [
  { id: "home", label: "home" },
  { id: "calendar", label: "calendar" },
  { id: "community", label: "people" },
];

// Minimal stroked line-icons for the nav dock.
function NavIcon({ id }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {id === "home" && (
        <g {...p}><path d="M4 11.2 12 4l8 7.2" /><path d="M6 10.5V20h12v-9.5" /><path d="M10 20v-5h4v5" /></g>
      )}
      {id === "calendar" && (
        <g {...p}><rect x="3.5" y="5" width="17" height="15" rx="2.2" /><path d="M3.5 9.5h17" /><path d="M8 3.2v3.4M16 3.2v3.4" /><circle cx="8" cy="13.5" r="1.05" fill="currentColor" stroke="none" /><circle cx="12" cy="13.5" r="1.05" fill="currentColor" stroke="none" /><circle cx="16" cy="13.5" r="1.05" fill="currentColor" stroke="none" /></g>
      )}
      {id === "community" && (
        <g {...p}><circle cx="9" cy="9" r="3.1" /><path d="M3.5 19.5c0-3.2 2.5-5.3 5.5-5.3s5.5 2.1 5.5 5.3" /><path d="M16 6.4a3 3 0 0 1 0 5.4" /><path d="M17.4 14.5c2.2.5 3.6 2.3 3.6 4.7" /></g>
      )}
    </svg>
  );
}
const GENRES = ["chill", "dark", "intense", "dreamy"];
const GENRE_LABELS = { chill: "lo-fi", dark: "darkwave", intense: "synthwave", dreamy: "ambient" };

export default function App() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadPhase, setLoadPhase] = useState("connecting"); // connecting | fetching | loading-video | ready
  const [view, setView] = useState("home"); // home|record|calendar|community|live|reader|edit
  const [openEntry, setOpenEntry] = useState(null);
  const [focusDomain, setFocusDomain] = useState(null); // life-section to lead with in the reader
  const [domainData, setDomainData] = useState(null); // { domain, notes } for domain card view
  const [page, setPage] = useState(0); // reader transcript page
  const [vi, setVi] = useState(0); // bg video index
  const [visible, setVisible] = useState(true);
  const [musicGenre, setMusicGenre] = useState(null); // null=off, or "chill"|"dark"|"intense"|"dreamy"
  const [soundReady, setSoundReady] = useState(false); // bg video audio unlocked
  const [vidReady, setVidReady] = useState(false); // bg video loaded enough to play
  const [captionText, setCaptionText] = useState(""); // live subtitle synced to playback
  const [needsTap, setNeedsTap] = useState(() => "ontouchstart" in window && !localStorage.getItem("vspam_tapdone"));
  const [musicOpen, setMusicOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");

  const idleRef = useRef(null);
  const pollRef = useRef(null);
  const bootedRef = useRef(false); // first video has buffered → loading screen gone
  const musicRef = useRef(null);
  const audioFxRef = useRef(null);
  const ctxRef = useRef(null);
  const bgVidRef = useRef(null);

  // Keep the background video playing — resume whenever the tab is visible
  // (Chrome power-pauses muted background video when the tab is hidden).
  useEffect(() => {
    const resume = () => { if (!document.hidden) bgVidRef.current?.play().catch(() => {}); };
    document.addEventListener("visibilitychange", resume);
    const iv = setInterval(resume, 4000);
    return () => { document.removeEventListener("visibilitychange", resume); clearInterval(iv); };
  }, []);

  const playable = entries.filter((e) => e.mediaPath?.startsWith("/media/") && e.analysis);
  const current = playable.length ? playable[vi % playable.length] : null;
  const { domains, avg, topArc, total } = aggregateLife(entries);
  const latest = entries[0];
  const onHome = view === "home";
  // In the reader the background plays the entry being read; elsewhere it cycles.
  const inReader = view === "reader" && openEntry?.mediaPath?.startsWith("/media/");
  const bgEntry = inReader ? openEntry : current;
  // Home + reader share one behaviour: dim (B&W) while the UI is up, clear
  // full-bleed video once idle. Flat panels hide the video entirely.
  // NB: the modifier must not be the literal "reader" — that collides with the
  // .reader panel rules and would shrink the background to the panel width.
  const bgMode = (onHome || inReader) ? (visible ? "dim" : "") : "off";

  async function refresh() {
    if (!bootedRef.current) setLoadPhase((p) => (p === "connecting" ? "fetching" : p));
    try {
      const list = await listEntries();
      setEntries(list);
      setError(null);
      // On first load, hold the loading screen until a video has buffered so
      // playback isn't choppy/cut. No playable video → reveal immediately.
      if (!bootedRef.current) {
        const hasVideo = list.some((e) => e.mediaPath?.startsWith("/media/") && e.analysis);
        if (hasVideo) setLoadPhase("loading-video");
        else { bootedRef.current = true; setLoadPhase("ready"); }
      }
    }
    catch (e) {
      setError(e.message);
      if (!bootedRef.current) { bootedRef.current = true; setLoadPhase("ready"); }
    }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  // Safety net: never get stuck on "pulling in video..." if buffering stalls.
  useEffect(() => {
    if (loadPhase !== "loading-video") return;
    const t = setTimeout(() => { bootedRef.current = true; setLoadPhase("ready"); }, 9000);
    return () => clearTimeout(t);
  }, [loadPhase]);
  useEffect(() => {
    const w = entries.some((e) => WORKING.includes(e.status));
    clearInterval(pollRef.current);
    if (w) pollRef.current = setInterval(refresh, 2000);
    return () => clearInterval(pollRef.current);
  }, [entries]);

  // fetch notes
  const refreshNotes = useCallback(async () => {
    try { setNotes(await listNotes()); } catch {}
  }, []);
  useEffect(() => { refreshNotes(); }, []);

  const submitNote = useCallback(async () => {
    const t = noteText.trim();
    if (!t) return;
    setNoteText("");
    try { await createNote(t); await refreshNotes(); } catch {}
  }, [noteText, refreshNotes]);

  // ── audio ── music sits low under the video's own audio
  const initAudio = useCallback(() => {
    setSoundReady(true); // unlock the background video's audio (after a gesture)
    if (bgVidRef.current) { bgVidRef.current.muted = false; bgVidRef.current.play().catch(() => {}); }
    if (ctxRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current = ctx;
    musicRef.current = createMusicGen(ctx);
    musicRef.current.start();
    musicRef.current.setMood("chill");
    musicRef.current.setVolume(0.08);
    audioFxRef.current = createAudioFX(ctx);
    setMusicGenre("chill");
  }, []);

  const handleTapPlay = useCallback(() => {
    setNeedsTap(false);
    localStorage.setItem("vspam_tapdone", "1");
    if (bgVidRef.current) { bgVidRef.current.muted = false; bgVidRef.current.play().catch(() => {}); }
    setSoundReady(true);
  }, []);
  const cycleMusic = useCallback((target) => {
    if (!ctxRef.current) return initAudio();
    if (target) {
      // Set specific genre from dropdown
      musicRef.current.setMood(target);
      if (!musicGenre) musicRef.current.start();
      musicRef.current.setVolume(0.08);
      setMusicGenre(target);
      return;
    }
    const idx = GENRES.indexOf(musicGenre);
    const next = idx + 1;
    if (next >= GENRES.length) {
      musicRef.current.stop();
      setMusicGenre(null);
    } else {
      const g = GENRES[next];
      musicRef.current.setMood(g);
      if (!musicGenre) musicRef.current.start();
      musicRef.current.setVolume(0.08);
      setMusicGenre(g);
    }
  }, [musicGenre, initAudio]);
  useEffect(() => {
    const go = () => { initAudio(); rm(); };
    const rm = () => ["click", "keydown", "touchstart"].forEach((e) => window.removeEventListener(e, go));
    ["click", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, go));
    return rm;
  }, [initAudio]);

  // ── idle: only auto-hide on the home view ──
  const wake = useCallback(() => {
    setVisible(true);
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setVisible(false), 5000);
  }, []);
  useEffect(() => {
    wake();
    ["mousemove", "click", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, wake));
    return () => { clearTimeout(idleRef.current); ["mousemove", "click", "keydown", "touchstart"].forEach((e) => window.removeEventListener(e, wake)); };
  }, [wake]);
  // Auto-hide the UI on home AND in the reader (mouse-move wakes it); other
  // panels (record/calendar/community) stay visible.
  const uiShown = visible || (!onHome && !inReader);

  // ── open an entry inline as the reader (optionally focused on a domain) ──
  async function onOpen(entry, domain = null) {
    setPage(0);
    setFocusDomain(domain);
    setView("reader");
    window.scrollTo({ top: 0, behavior: "instant" });
    try { setOpenEntry(await getEntry(entry._id)); }
    catch { setOpenEntry(entry); }
  }
  function openDomain(domain, notes) {
    setDomainData({ domain, notes });
    setView("domain");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function go(v) { setView(v); setOpenEntry(null); setFocusDomain(null); setDomainData(null); window.scrollTo({ top: 0, behavior: "instant" }); }

  async function onDelete(id) {
    setEntries((p) => p.filter((e) => e._id !== id));
    if (openEntry?._id === id) go("home");
    try { await deleteEntry(id); } catch { refresh(); }
  }

  // ── reader: pages from segments (fallback: split transcript evenly) ──
  const segments = readerSegments(openEntry);
  const seg = segments[Math.min(page, segments.length - 1)];

  // Live captions: follow the bg video's playback and show the segment whose
  // [startSec, endSec) window contains the current time — i.e. what's being said.
  useEffect(() => {
    const v = bgVidRef.current;
    setCaptionText("");
    if (!v || !bgEntry) return;
    const segs = readerSegments(bgEntry);
    if (!segs.length) return;
    const onTime = () => {
      const t = v.currentTime;
      const hit = segs.find((g) => t >= (g.startSec || 0) && t < (g.endSec ?? Infinity));
      setCaptionText(hit ? hit.text : "");
    };
    v.addEventListener("timeupdate", onTime);
    onTime();
    return () => v.removeEventListener("timeupdate", onTime);
  }, [bgEntry?._id, view]); // eslint-disable-line

  // Jump the background video to a timestamp (used by the reader's transcript logs).
  const seekTo = useCallback((sec) => {
    const v = bgVidRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, sec || 0);
    v.play().catch(() => {});
  }, []);

  return (
    <div className="app" onMouseMove={wake}>
      {/* Loading screen */}
      {loadPhase !== "ready" && (
        <div className="load-screen">
          <p className="load-text">
            {loadPhase === "connecting" && "establishing signal..."}
            {loadPhase === "fetching" && "gathering moments..."}
            {loadPhase === "loading-video" && "pulling in video..."}
          </p>
        </div>
      )}

      {/* persistent video background — present on home AND in the reader */}
      <div className={`bg ${bgMode}`}>
        {bgEntry ? (
          <video ref={bgVidRef} key={bgEntry._id} className="bg-vid" src={playSrc(bgEntry)} poster={bgEntry.posterPath}
            autoPlay muted={!soundReady} loop={!inReader} playsInline preload="auto"
            onCanPlayThrough={() => { setVidReady(true); bootedRef.current = true; setLoadPhase("ready"); }}
            onPause={(e) => { if (!document.hidden) e.currentTarget.play().catch(() => {}); }}
            onEnded={() => { if (!inReader) setVi((i) => (i + 1) % Math.max(1, playable.length)); }} />
        ) : <div className="bg-vid fallback" />}
        {/* Dithering canvas overlay */}
        <canvas ref={(c) => { if (c && !c._drawn) { c._drawn = true; drawDitherCanvas(c); } }} className="dither-canvas" width={320} height={180} />
        {((onHome || inReader) && visible) && <div className="bg-overlay" />}
        <div className="dither-overlay" />
      </div>

      {/* Tap-to-play overlay for mobile */}
      {needsTap && (
        <button className="tap-play" onClick={handleTapPlay}>
          <span className="tap-play-icon">▶</span>
          <span className="tap-play-text">tap to play</span>
        </button>
      )}

      {/* Live video captions — only while the rest of the UI/text is hidden */}
      {captionText && vidReady && !uiShown && (
        <div className="bg-captions show">
          <p>{captionText}</p>
        </div>
      )}
      <div className="grain" />
      <div className="glitch-line" />

      {/* shell — no header; nav lives in a minimal floating dock */}
      <div className={`shell ${uiShown ? "show" : ""}`}>
        {/* inline stage — content changes right here */}
        <main className="stage">
          {view === "home" && (
            <div className="v-home">
              <h1 className="hero" data-text="visualspam">visualspam<span className="dot">.</span></h1>
              {total > 0 && (
                <p className="hero-line">
                  {total} moments logged — feeling {moodLabel(avg).toLowerCase()} — {ARC[topArc] || "→"} {topArc || "steady"}
                </p>
              )}
              {latest?.analysis && (
                <button className="latest-text" onClick={() => onOpen(latest)}>
                  <span className="latest-label">just in</span>
                  <span className="latest-title">{latest.title || "something on my mind"}</span>
                  <span className="latest-arrow">→</span>
                </button>
              )}
              {domains.length > 0 && (
                <div className="dom-text">
                  {domains.map(({ domain, notes }) => (
                    <button key={domain} className="dom-word" onClick={() => openDomain(domain, notes)}>
                      {domain}<sup>{notes.length}</sup>
                    </button>
                  ))}
                </div>
              )}
              {total === 0 && !loading && <p className="hero-line">hit record and tell me what's on your mind.</p>}
            </div>
          )}

          {view === "record" && (
            <div className="v-panel">
              <ViewHead title="Record" onBack={() => go("home")} />
              <Recorder onSaved={() => { refresh(); go("home"); }} />
            </div>
          )}

          {view === "calendar" && (
            <CalendarView entries={entries} onOpen={onOpen} loading={loading} onBack={() => go("home")} />
          )}

          {view === "community" && (
            <div className="v-panel notes-panel">
              <ViewHead title="People" onBack={() => go("home")} />
              <div className="notes-input-row">
                <input
                  className="notes-input"
                  placeholder="say anything..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
                />
                <button className="notes-send" onClick={submitNote}>→</button>
              </div>
              <div className="notes-list">
                {notes.map((n) => (
                  <div key={n._id} className="note-item">
                    <span className="note-text">{n.text}</span>
                    <span className="note-time">{timeAgo(n.createdAt)}</span>
                  </div>
                ))}
                {notes.length === 0 && <p className="notes-empty">nothing yet. be the first.</p>}
              </div>
            </div>
          )}

          {view === "domain" && domainData && (
            <DomainCard domain={domainData.domain} notes={domainData.notes} onOpen={onOpen} onBack={() => go("home")} />
          )}

          {view === "reader" && openEntry && (
            <Reader
              entry={openEntry} seg={seg} segments={segments} page={page}
              focusDomain={focusDomain}
              onPage={setPage} onSeek={seekTo} onBack={() => go("home")}
            />
          )}
        </main>

        {/* nav — redesigned line-icon dock with labels */}
        <nav className="nav-dock">
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${view === n.id ? "on" : ""}`}
              onClick={() => go(n.id)} title={n.label}>
              <NavIcon id={n.id} />
              <span className="nav-label">{n.label}</span>
            </button>
          ))}
        </nav>

        {/* music — fixed top-right corner */}
        <MusicPicker musicGenre={musicGenre} cycleMusic={cycleMusic} musicOpen={musicOpen} setMusicOpen={setMusicOpen} />
      </div>

      {error && <div className="toast">{error}</div>}
    </div>
  );
}

function ViewHead({ title, onBack }) {
  return (
    <div className="view-head2">
      <button className="back-btn" onClick={onBack}>← Back</button>
      <h2>{title}</h2>
    </div>
  );
}

// ── Domain card: focused view of one life domain across all entries ──
function DomainCard({ domain, notes, onOpen, onBack }) {
  const latest = notes[0];
  const a = latest?.entry?.analysis || {};
  // Aggregate emotions across all notes for this domain
  const allEmotions = [...new Set(notes.flatMap((n) => n.entry?.analysis?.emotions || []))];
  const allFollowUps = [...new Set(notes.flatMap((n) => n.entry?.analysis?.followUps || []))];
  const allQuotes = notes.flatMap((n) => (n.entry?.analysis?.quotes || []).map((q) => ({ q, title: n.title, date: n.recordedAt })));
  // Sentiment trend: newest → oldest
  const sentimentTrend = notes.map((n) => n.entry?.analysis?.sentiment).filter((v) => v != null);

  return (
    <div className="v-panel domain-card">
      <ViewHead title={domain} onBack={onBack} />

      {/* Hero: latest standing */}
      {latest && (
        <div className="domain-hero">
          <div className="domain-hero-meta">
            <span className="r-kicker">where you are now</span>
            <span className={`cr-status ${latest.entry?.status}`}>{latest.status}</span>
          </div>
          {a.standing && <p className="domain-standing">{a.standing}</p>}
          <div className="domain-hero-stats">
            <span><b>{moodLabel(a.sentiment)}</b><i>mood</i></span>
            <span><b>{ARC[a.trajectory] || "→"} {a.trajectory}</b><i>arc</i></span>
            <span><b>{a.energy}</b><i>energy</i></span>
          </div>
          {sentimentTrend.length > 1 && (
            <div className="domain-trend">
              <span className="r-kicker">mood trend</span>
              <div className="domain-trend-bar">
                {sentimentTrend.map((s, i) => (
                  <span key={i} className="domain-trend-dot" style={{
                    background: s > 0.25 ? "#22c55e" : s < -0.25 ? "#ef4444" : "#eab308",
                    opacity: 1 - i * 0.12,
                  }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Emotions */}
      {allEmotions.length > 0 && (
        <div className="domain-section">
          <span className="r-kicker">emotions across {notes.length} moments</span>
          <div className="r-tags r-emos">{allEmotions.slice(0, 8).map((e, i) => <span key={i}>{e}</span>)}</div>
        </div>
      )}

      {/* Best quotes */}
      {allQuotes.length > 0 && (
        <div className="domain-section">
          <span className="r-kicker">quotes</span>
          {allQuotes.slice(0, 3).map((item, i) => (
            <div key={i} className="domain-quote-card">
              <p className="r-quote">"{item.q}"</p>
              <span className="domain-quote-src">{item.title || "Untitled"} · {timeAgo(item.date)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Follow-ups / open threads */}
      {allFollowUps.length > 0 && (
        <div className="domain-section">
          <span className="r-kicker">open threads</span>
          {allFollowUps.slice(0, 4).map((f, i) => (
            <p key={i} className="r-follow">? {f}</p>
          ))}
        </div>
      )}

      {/* Timeline */}
      {notes.length > 0 && (
        <div className="domain-section">
          <span className="r-kicker">timeline · {notes.length} mentions</span>
          <div className="domain-timeline">
            {notes.map((n, i) => {
              const ea = n.entry?.analysis || {};
              const s = ea.sentiment;
              return (
                <div key={i} className="domain-note" onClick={() => n.entry?.status === "ready" && onOpen(n.entry)}>
                  <div className="domain-note-head">
                    <span className="domain-note-dot" style={{
                      background: s > 0.25 ? "#22c55e" : s < -0.25 ? "#ef4444" : "#eab308",
                    }} />
                    <span className="domain-note-date">{fmtTime(n.recordedAt)} · {timeAgo(n.recordedAt)}</span>
                    <span className={`cr-status ${n.entry?.status}`}>{n.status}</span>
                  </div>
                  <span className="domain-note-title">{n.title || "Untitled"}</span>
                  <p className="domain-note-text">{n.summary}</p>
                  {ea.quotes?.length > 0 && (
                    <p className="domain-note-quote">"{ea.quotes[0]}"</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Music picker: tap to cycle, long-press for genre dropdown ──
function MusicPicker({ musicGenre, cycleMusic, musicOpen, setMusicOpen }) {
  const timerRef = useRef(null);
  const openRef = useRef(false);

  const start = useCallback(() => {
    openRef.current = false;
    timerRef.current = setTimeout(() => { openRef.current = true; setMusicOpen(true); }, 500);
  }, [setMusicOpen]);

  const end = useCallback(() => {
    clearTimeout(timerRef.current);
    if (!openRef.current) cycleMusic();
  }, [cycleMusic]);

  const selectGenre = useCallback((g) => {
    setMusicOpen(false);
    if (g !== musicGenre) cycleMusic(g);
  }, [musicGenre, cycleMusic, setMusicOpen]);

  // Close on outside tap
  useEffect(() => {
    if (!musicOpen) return;
    const close = (e) => { if (!e.target.closest(".music-picker")) setMusicOpen(false); };
    setTimeout(() => document.addEventListener("click", close), 0);
    return () => document.removeEventListener("click", close);
  }, [musicOpen, setMusicOpen]);

  return (
    <div className="music-picker">
      <button
        className={`music-corner ${musicGenre ? "on" : ""}`}
        data-genre={musicGenre || ""}
        onMouseDown={start} onMouseUp={end} onMouseLeave={() => clearTimeout(timerRef.current)}
        onTouchStart={start} onTouchEnd={(e) => { e.preventDefault(); end(); }}
        title={musicGenre ? GENRE_LABELS[musicGenre] : "sound off"}
      >
        {musicGenre ? "♫" : "♪"}
      </button>
      {musicOpen && (
        <div className="music-dropdown">
          {GENRES.map((g) => (
            <button key={g} className={`music-opt ${musicGenre === g ? "on" : ""}`} onClick={() => selectGenre(g)}>
              {GENRE_LABELS[g]}
            </button>
          ))}
          <button className="music-opt off" onClick={() => { setMusicOpen(false); if (musicGenre) cycleMusic(); }}>
            {musicGenre ? "stop" : "off"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inline reader: live-captioned video + tap-to-seek transcript + insights ──
function Reader({ entry, seg, segments, page, focusDomain, onPage, onSeek, onBack }) {
  const a = entry.analysis || {};
  const jump = (i) => { onPage(i); onSeek(segments[i]?.startSec); };
  // When opened from a home domain word, lead with that life-section so the
  // check-in shows the stuff related to that name first.
  const sections = a.lifeSections || [];
  const orderedSections = focusDomain
    ? [...sections].sort((x, y) => (y.domain === focusDomain) - (x.domain === focusDomain))
    : sections;
  const focusRef = useRef(null);
  useEffect(() => { focusRef.current?.scrollIntoView({ block: "nearest" }); }, [focusDomain, entry._id]);
  return (
    <div className="reader">
      <div className="reader-head">
        <button className="back-btn" onClick={onBack}>← back</button>
      </div>

      <div className="reader-grid">
        <div className="reader-stage">
          {seg && (
            <div className="reader-caption">
              <p>{seg.text}</p>
            </div>
          )}
          {segments.length > 1 && (
            <div className="reader-pager">
              <button onClick={() => jump(Math.max(0, page - 1))} disabled={page === 0}>‹</button>
              <span>{mmss(seg?.startSec || 0)} · {page + 1}/{segments.length}</span>
              <button onClick={() => jump(Math.min(segments.length - 1, page + 1))}
                disabled={page === segments.length - 1}>›</button>
            </div>
          )}
        </div>

        <div className="reader-side">
          <span className="r-kicker">{(entry.source || "entry").replace("_", " ")} · {fmtDate(entry.recordedAt)}</span>
          <h1 className="r-title">{entry.title || "Untitled"}</h1>
          {focusDomain && <span className="r-focus-tag">focused on · {focusDomain}</span>}
          {a.standing && <p className="r-standing">{a.standing}</p>}
          <div className="r-stats">
            <span><b>{moodLabel(a.sentiment)}</b><i>mood</i></span>
            <span><b>{ARC[a.trajectory] || "→"} {a.trajectory}</b><i>arc</i></span>
            <span><b>{a.energy}</b><i>energy</i></span>
          </div>

          {/* transcript logs — tap a line to jump the video to that moment */}
          {segments.length > 0 && (
            <div className="r-section">
              <span className="r-kicker">transcript · tap to jump</span>
              <div className="reader-logs">
                {segments.map((s, i) => (
                  <button key={i} className={`log-line ${i === page ? "on" : ""}`} onClick={() => jump(i)}>
                    <span className="log-time">{mmss(s.startSec)}</span>
                    <span className="log-text">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {orderedSections.length > 0 && (
            <div className="r-sections">
              {orderedSections.map((s, i) => {
                const isFocus = focusDomain && s.domain === focusDomain;
                return (
                  <div key={i} ref={isFocus ? focusRef : null} className={`r-sec ${isFocus ? "focus" : ""}`}>
                    <strong>{s.domain}</strong>
                    <span className="r-sec-st">{s.status}</span>
                    <p>{s.summary}</p>
                  </div>
                );
              })}
            </div>
          )}
          {a.topics?.length > 0 && (
            <div className="r-tags">{a.topics.map((t) => <span key={t}>#{t}</span>)}</div>
          )}
          {a.emotions?.length > 0 && (
            <div className="r-tags r-emos">{a.emotions.map((e, i) => <span key={i}>{e}</span>)}</div>
          )}
          {a.quotes?.length > 0 && (
            <div className="r-section">
              <span className="r-kicker">quotes</span>
              {a.quotes.slice(0, 3).map((q, i) => <p key={i} className="r-quote">“{q}”</p>)}
            </div>
          )}
          {a.ideas?.length > 0 && (
            <div className="r-section">
              <span className="r-kicker">ideas</span>
              {a.ideas.slice(0, 3).map((id, i) => <p key={i} className="r-idea">→ {id?.text || id}</p>)}
            </div>
          )}
          {a.followUps?.length > 0 && (
            <div className="r-section">
              <span className="r-kicker">open threads</span>
              {a.followUps.slice(0, 3).map((f, i) => <p key={i} className="r-follow">? {f}</p>)}
            </div>
          )}
          {a.patterns?.length > 0 && (
            <div className="r-section">
              <span className="r-kicker">recurring themes</span>
              <div className="r-tags">{a.patterns.map((p, i) => <span key={i} className="r-pattern">↳ {p}</span>)}</div>
            </div>
          )}
          {a.growth && (
            <div className="r-section">
              <span className="r-kicker">growth & shift</span>
              <p className="r-standing">{a.growth}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// segments from DB, else split transcript evenly across the duration
function readerSegments(entry) {
  if (!entry) return [];
  if (entry.segments?.length) return entry.segments;
  const text = entry.transcript?.fullText || entry.analysis?.summary || "";
  const sents = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const dur = entry.durationSec || sents.length;
  const slice = dur / Math.max(1, sents.length);
  return sents.map((t, i) => ({ text: t, startSec: i * slice, endSec: (i + 1) * slice }));
}

// ── Calendar grid view ──
function CalendarView({ entries, onOpen, loading, onBack }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDay, setSelectedDay] = useState(null);

  const { year, month: mo } = month;
  const firstDay = new Date(year, mo, 1).getDay();
  const daysInMonth = new Date(year, mo + 1, 0).getDate();
  const today = new Date();

  // Group entries by day
  const byDay = useMemo(() => {
    const map = {};
    for (const e of entries) {
      const d = new Date(e.recordedAt);
      if (d.getFullYear() === year && d.getMonth() === mo) {
        const day = d.getDate();
        (map[day] ||= []).push(e);
      }
    }
    return map;
  }, [entries, year, mo]);

  const selectedEntries = selectedDay ? (byDay[selectedDay] || []) : [];
  const totalThisMonth = Object.values(byDay).reduce((s, arr) => s + arr.length, 0);

  function prevMonth() {
    setSelectedDay(null);
    setMonth(({ year: y, month: m }) => m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 });
  }
  function nextMonth() {
    setSelectedDay(null);
    setMonth(({ year: y, month: m }) => m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 });
  }

  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  return (
    <div className="v-panel">
      <ViewHead title="Calendar" onBack={onBack} />

      <div className="cal-controls">
        <div className="cal-month-nav">
          <button className="cal-month-btn" onClick={prevMonth}>‹</button>
          <span className="cal-month-label">{MONTH_NAMES[mo]} {year}</span>
          <button className="cal-month-btn" onClick={nextMonth}>›</button>
        </div>
        {totalThisMonth > 0 && <span className="cal-count">{totalThisMonth} moment{totalThisMonth !== 1 ? "s" : ""}</span>}
      </div>

      {/* Day-of-week headers */}
      <div className="cal-grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-weekday">{d}</div>
        ))}

        {/* Empty cells before day 1 */}
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`empty-${i}`} className="cal-cell empty" />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dayEntries = byDay[day] || [];
          const isToday = today.getFullYear() === year && today.getMonth() === mo && today.getDate() === day;
          const isSelected = selectedDay === day;
          const hasEntries = dayEntries.length > 0;
          return (
            <button
              key={day}
              className={`cal-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${hasEntries ? "has-entries" : ""}`}
              onClick={() => setSelectedDay(isSelected ? null : day)}
            >
              <span className="cal-day-num">{day}</span>
              {hasEntries && (
                <div className="cal-dots">
                  {dayEntries.slice(0, 3).map((e, j) => (
                    <span key={j} className="cal-dot" style={{ background: e.analysis ? "var(--accent)" : "var(--muted)" }} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day's entries */}
      {selectedDay && (
        <div className="cal-day-detail">
          <h3 className="cal-day-title">{MONTH_NAMES[mo]} {selectedDay}</h3>
          {selectedEntries.length === 0 && <p className="dim">No moments this day.</p>}
          {selectedEntries.map((e) => {
            const a = e.analysis;
            const sections = a?.lifeSections || [];
            const topics = a?.topics || [];
            return (
              <div key={e._id} className="cal-day-entry" onClick={() => e.status === "ready" && a && onOpen(e)}>
                <div className="cal-day-row">
                  <div className="cal-day-info">
                    <span className="cal-day-name">{e.title || "Untitled"}</span>
                    <span className="cal-day-time">{fmtTime(e.recordedAt)} · {e.durationSec ? mmss(e.durationSec) : ""}</span>
                  </div>
                  {a && <span className="cal-day-emoji">{sentimentEmoji(a.sentiment)}</span>}
                  {e.status !== "ready" && <span className={`cr-status ${e.status}`}>{STATUS_LABELS[e.status]}</span>}
                </div>
                {sections.length > 0 && (
                  <div className="cal-day-sections">
                    {sections.map((s, i) => (
                      <span key={i} className="cal-day-section">{s.domain}</span>
                    ))}
                  </div>
                )}
                {topics.length > 0 && (
                  <div className="cal-topics">
                    {topics.slice(0, 4).map((t) => <span key={t} className="cal-topic">#{t}</span>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


