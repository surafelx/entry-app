const TICKER = [
  "CHECK-IN",
  "STREAM",
  "UPLOAD",
  "TRANSCRIBE",
  "ANALYZE",
  "WORK & CRAFT",
  "RELATIONSHIPS",
  "HEALTH",
  "MIND & GROWTH",
  "WHERE YOU ARE",
];

const FEATURES = [
  { n: "01", t: "Record or stream", d: "Hit record. Live camera, real-time waveform, in-browser — no app, no upload dance." },
  { n: "02", t: "Live transcription", d: "Your words become text as you speak, captioned on screen and saved with the clip." },
  { n: "03", t: "It drafts your life", d: "Claude reads the moment and writes the sections of your life — and where you stand in each." },
  { n: "04", t: "Magazine reader", d: "Open any moment as a full-screen editorial spread. Your week, set in type." },
  { n: "05", t: "Calendar & streaks", d: "An activity heatmap of every moment. Watch the habit build, day by day." },
  { n: "06", t: "Community", d: "Follow other people journaling out loud. Mood, streaks, the section they're in." },
];

const VOICES = [
  { i: "MO", c: "#FF4D2E", q: "I finally see the throughline of my weeks.", n: "Maya O." },
  { i: "LV", c: "#111111", q: "It's the only journal I've ever kept past February.", n: "Lena V." },
  { i: "SR", c: "#4D5DFF", q: "The magazine view makes my life feel like a story.", n: "Sam R." },
];

export default function Landing({ onEnter }) {
  return (
    <div className="lp">
      {/* top bar */}
      <header className="lp-top">
        <div className="brand">
          <span className="logo">◼</span>
          <span className="brand-name">VISUALSPAM</span>
        </div>
        <button className="btn ghost" onClick={() => onEnter("dashboard")}>
          Enter →
        </button>
      </header>

      {/* hero */}
      <section className="lp-hero">
        <span className="lp-eyebrow">◆ Voice journal · life analysis</span>
        <h1 className="lp-title">
          Record your life.
          <br />
          Read it <mark>back.</mark>
        </h1>
        <p className="lp-sub">
          Speak for two minutes. Entry transcribes it, drafts the sections of
          your life, and reads them back like a magazine.
        </p>
        <div className="lp-cta">
          <button className="btn accent big" onClick={() => onEnter("recordings")}>
            ● Start recording
          </button>
          <button className="btn ghost big" onClick={() => onEnter("dashboard")}>
            See the dashboard
          </button>
        </div>

        {/* product deck */}
        <div className="lp-deck">
          <div className="lp-card deck-wave">
            <span className="lp-card-tag live">● LIVE</span>
            <div className="lp-eq" aria-hidden>
              {Array.from({ length: 16 }).map((_, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.07}s` }} />
              ))}
            </div>
            <span className="lp-card-cap">Recording &amp; transcribing…</span>
          </div>

          <div className="lp-card deck-mag">
            <span className="lp-sticker">REC ●</span>
            <div className="lp-mag-line">CHECK-IN · MON · 9:17 AM</div>
            <h3 className="lp-mag-title">TUESDAY MORNING</h3>
            <p className="lp-mag-stand">“Honestly, I feel really good today.”</p>
            <div className="lp-mag-row">
              <span className="lp-mag-tag">WORK &amp; CRAFT</span>
              <span className="lp-mag-badge">MOMENTUM</span>
            </div>
            <div className="lp-mag-row">
              <span className="lp-mag-tag">RELATIONSHIPS</span>
              <span className="lp-mag-badge alt">STEADY</span>
            </div>
          </div>

          <div className="lp-card deck-cal">
            <span className="lp-card-tag">STREAK</span>
            <div className="lp-heat" aria-hidden>
              {[2, 0, 3, 1, 0, 2, 3, 1, 2, 0, 1, 3, 2, 1, 0, 3, 2, 2, 1, 3, 0, 1, 2, 3, 1, 2, 3, 2].map(
                (v, i) => (
                  <span key={i} data-v={v} />
                )
              )}
            </div>
            <span className="lp-card-cap">14-day streak · 4 sections rising</span>
          </div>
        </div>
      </section>

      {/* scrolling ticker */}
      <div className="lp-ticker">
        <div className="lp-ticker-track">
          {[...TICKER, ...TICKER].map((w, i) => (
            <span key={i}>
              {w} <em>✳</em>
            </span>
          ))}
        </div>
      </div>

      {/* features */}
      <section className="lp-section">
        <h2 className="lp-h2">
          Everything in <mark>one studio</mark>
        </h2>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <article key={f.n} className="lp-feature">
              <span className="lp-feature-n">{f.n}</span>
              <h3>{f.t}</h3>
              <p>{f.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="lp-steps">
        <h2 className="lp-h2 light">
          Three steps. <mark>Then read.</mark>
        </h2>
        <div className="lp-steps-row">
          <div className="lp-step">
            <span className="lp-step-n">1</span>
            <h3>Speak</h3>
            <p>Two minutes, off the top of your head.</p>
          </div>
          <span className="lp-arrow">→</span>
          <div className="lp-step">
            <span className="lp-step-n">2</span>
            <h3>We analyze</h3>
            <p>Transcribed, then drafted into life sections.</p>
          </div>
          <span className="lp-arrow">→</span>
          <div className="lp-step">
            <span className="lp-step-n">3</span>
            <h3>You read</h3>
            <p>A magazine of where you are, updated daily.</p>
          </div>
        </div>
      </section>

      {/* voices */}
      <section className="lp-section">
        <h2 className="lp-h2">
          People journaling <mark>out loud</mark>
        </h2>
        <div className="lp-voices">
          {VOICES.map((v) => (
            <figure key={v.i} className="lp-voice">
              <blockquote>“{v.q}”</blockquote>
              <figcaption>
                <span className="avatar" style={{ background: v.c }}>
                  {v.i}
                </span>
                {v.n}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* big CTA */}
      <section className="lp-final">
        <h2>
          YOUR LIFE,
          <br />
          <mark>ON THE RECORD.</mark>
        </h2>
        <button className="btn accent big" onClick={() => onEnter("recordings")}>
          ● Start your first moment
        </button>
      </section>

      <footer className="lp-foot">
        <span className="logo">◼</span> visualspam — record · transcribe · analyze ·
        read.
      </footer>
    </div>
  );
}
