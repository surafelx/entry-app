/**
 * Algorithmic music generator using Web Audio API.
 * Generates ambient / drone / lo-fi music procedurally.
 */

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randRange(a, b) {
  return a + Math.random() * (b - a);
}

/**
 * Creates a music generator attached to an AudioContext.
 * Returns { start, stop, setMood }.
 */
export function createMusicGen(audioCtx) {
  let playing = false;
  let nodes = [];
  let intervals = [];
  let masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioCtx.destination);

  // Compressor for polish
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.connect(masterGain);

  // Reverb via convolver
  const reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.3;
  reverbGain.connect(compressor);

  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.7;
  dryGain.connect(compressor);

  // Simple impulse response
  function makeImpulse(duration, decay) {
    const len = audioCtx.sampleRate * duration;
    const buf = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  const convolver = audioCtx.createConvolver();
  convolver.buffer = makeImpulse(2.5, 2.5);
  convolver.connect(reverbGain);

  let mood = "chill";
  let rootNote = 48; // C3
  let scale = SCALES.minor;

  // Per-genre configs
  const GENRE_CONFIG = {
    chill:   { root: 48, scale: SCALES.minor,      bpmBase: 70,  arpBpm: 140, filterFreq: 500,  reverbMix: 0.35, droneGain: 0.06, padGain: 0.03, percGain: 0.03, bassDur: 0.8, arpWave: ["triangle","sine"], lfoRate: 0.06 },
    dark:    { root: 43, scale: SCALES.phrygian,    bpmBase: 55,  arpBpm: 110, filterFreq: 300,  reverbMix: 0.5,  droneGain: 0.08, padGain: 0.02, percGain: 0.02, bassDur: 1.2, arpWave: ["sawtooth","triangle"], lfoRate: 0.04 },
    intense: { root: 50, scale: SCALES.blues,       bpmBase: 90,  arpBpm: 180, filterFreq: 1200, reverbMix: 0.2,  droneGain: 0.05, padGain: 0.04, percGain: 0.05, bassDur: 0.4, arpWave: ["square","sawtooth"], lfoRate: 0.12 },
    dreamy:  { root: 48, scale: SCALES.lydian,      bpmBase: 45,  arpBpm: 90,  filterFreq: 600,  reverbMix: 0.6,  droneGain: 0.04, padGain: 0.035, percGain: 0.015, bassDur: 1.6, arpWave: ["sine","triangle"], lfoRate: 0.03 },
  };

  function applyGenre(m) {
    const g = GENRE_CONFIG[m] || GENRE_CONFIG.chill;
    mood = m;
    rootNote = g.root;
    scale = g.scale;
    // Update reverb mix live
    reverbGain.gain.setTargetAtTime(g.reverbMix, audioCtx.currentTime, 0.3);
    dryGain.gain.setTargetAtTime(1 - g.reverbMix, audioCtx.currentTime, 0.3);
  }

  function getNotesInScale(root, octaves) {
    const notes = [];
    for (let oct = 0; oct < octaves; oct++) {
      for (const interval of scale) {
        notes.push(root + interval + oct * 12);
      }
    }
    return notes;
  }

  // ── Drone pad ──
  function createDrone() {
    const g = GENRE_CONFIG[mood] || GENRE_CONFIG.chill;
    const notes = [rootNote, rootNote + 7, rootNote + 12]; // root, fifth, octave
    const voices = [];

    notes.forEach((midi, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();

      osc.type = i === 0 ? "sawtooth" : "sine";
      osc.frequency.value = midiToFreq(midi + (i === 2 ? 0.05 : 0));

      filter.type = "lowpass";
      filter.frequency.value = g.filterFreq + Math.random() * 200;
      filter.Q.value = 1;

      gain.gain.value = g.droneGain / (i + 1);

      // Slow LFO on filter
      const lfo = audioCtx.createOscillator();
      const lfoGain = audioCtx.createGain();
      lfo.frequency.value = g.lfoRate + Math.random() * g.lfoRate;
      lfoGain.gain.value = 100;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(dryGain);
      gain.connect(convolver);
      osc.start();

      voices.push({ osc, gain, filter, lfo, lfoGain });
    });

    return voices;
  }

  // ── Arpeggio / melody line ──
  function startArp() {
    const g = GENRE_CONFIG[mood] || GENRE_CONFIG.chill;
    const notes = getNotesInScale(rootNote, 3);
    let step = 0;

    const tick = () => {
      if (!playing) return;

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();

      osc.type = pick(g.arpWave);
      const note = pick(notes);
      osc.frequency.value = midiToFreq(note);

      filter.type = "lowpass";
      filter.frequency.value = g.filterFreq + Math.random() * g.filterFreq;
      filter.Q.value = 2;

      const now = audioCtx.currentTime;
      const dur = mood === "intense" ? randRange(0.1, 0.3) : mood === "dark" ? randRange(0.3, 0.8) : randRange(0.2, 0.6);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(dryGain);
      gain.connect(convolver);
      osc.start(now);
      osc.stop(now + dur + 0.05);

      step++;
    };

    const id = setInterval(tick, (60 / g.arpBpm) * 1000 / 2);
    intervals.push(id);
    tick();
  }

  // ── Sub bass pulse ──
  function startBass() {
    const g = GENRE_CONFIG[mood] || GENRE_CONFIG.chill;
    const tick = () => {
      if (!playing) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.value = midiToFreq(rootNote - 12);

      const now = audioCtx.currentTime;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + g.bassDur);

      osc.connect(gain);
      gain.connect(dryGain);
      osc.start(now);
      osc.stop(now + g.bassDur + 0.05);
    };

    const id = setInterval(tick, (60 / g.bpmBase) * 1000);
    intervals.push(id);
  }

  // ── Hi-hat / noise percussion ──
  function startPerc() {
    const g = GENRE_CONFIG[mood] || GENRE_CONFIG.chill;
    const tick = () => {
      if (!playing) return;
      const bufferSize = audioCtx.sampleRate * 0.05;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const src = audioCtx.createBufferSource();
      src.buffer = buffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 6000 + Math.random() * 4000;

      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      gain.gain.setValueAtTime(g.percGain, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(dryGain);
      src.start(now);
    };

    const id = setInterval(tick, (60 / (g.arpBpm * 2)) * 1000);
    intervals.push(id);
  }

  // ── Chord pad (slow changes) ──
  function startChordPad() {
    const g = GENRE_CONFIG[mood] || GENRE_CONFIG.chill;
    const chords = [
      [0, 3, 7],      // i
      [5, 8, 0 + 12], // iv
      [7, 10, 2 + 12],// V
      [3, 7, 10],     // III
    ];

    let chordIdx = 0;

    const tick = () => {
      if (!playing) return;
      const chord = chords[chordIdx % chords.length];
      chordIdx++;

      chord.forEach((interval) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        osc.type = "sine";
        osc.frequency.value = midiToFreq(rootNote + 12 + interval);

        filter.type = "lowpass";
        filter.frequency.value = g.filterFreq;

        const now = audioCtx.currentTime;
        const dur = mood === "intense" ? 2 : mood === "dark" ? 5 : 4;

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(g.padGain, now + 0.5);
        gain.gain.setValueAtTime(g.padGain, now + dur - 1);
        gain.gain.linearRampToValueAtTime(0, now + dur);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(dryGain);
        gain.connect(convolver);
        osc.start(now);
        osc.stop(now + dur + 0.1);
      });
    };

    const id = setInterval(tick, (mood === "intense" ? 2000 : mood === "dark" ? 6000 : 4000));
    intervals.push(id);
    tick();
  }

  function start() {
    if (playing) return;
    playing = true;
    masterGain.gain.setTargetAtTime(0.5, audioCtx.currentTime, 0.5);

    createDrone();
    startArp();
    startBass();
    startPerc();
    startChordPad();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.3);
    intervals.forEach(clearInterval);
    intervals = [];
    setTimeout(() => {
      nodes.forEach((n) => {
        try { n.osc?.stop(); } catch {}
        try { n.lfo?.stop(); } catch {}
      });
      nodes = [];
    }, 500);
  }

  function setMood(m) {
    mood = m;
    if (m === "dark") { rootNote = 45; scale = SCALES.phrygian; }
    else if (m === "intense") { rootNote = 50; scale = SCALES.blues; }
    else if (m === "dreamy") { rootNote = 48; scale = SCALES.lydian; }
    else { rootNote = 48; scale = SCALES.minor; }
  }

  function setVolume(v) {
    masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), audioCtx.currentTime, 0.1);
  }

  return { start, stop, setMood, setVolume };
}
