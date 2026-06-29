/**
 * Audio distortion processor using Web Audio API.
 * Takes a video/audio source and applies heavy FX: pitch shift, bitcrush,
 * distortion, volume boost, LFO modulation, and reverb.
 */

export function createAudioFX(audioCtx) {
  let active = null;
  let playing = false;

  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioCtx.destination);

  // ── Waveshaper (distortion) ──
  function makeDistortion(amount) {
    const ws = audioCtx.createWaveShaper();
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    ws.curve = curve;
    ws.oversample = "4x";
    return ws;
  }

  // ── Bitcrusher (via ScriptProcessor replacement using gain reduction) ──
  function makeBitcrusher(bits) {
    const ws = audioCtx.createWaveShaper();
    const levels = Math.pow(2, bits);
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    ws.curve = curve;
    ws.oversample = "none";
    return ws;
  }

  // ── Noise generator ──
  function createNoise(duration) {
    const len = audioCtx.sampleRate * duration;
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function loadSource(url) {
    return new Promise((resolve, reject) => {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => audioCtx.decodeAudioData(buf))
        .then(resolve)
        .catch(reject);
    });
  }

  async function start(url) {
    if (playing) stop();

    const buffer = await loadSource(url);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // ── Chain: source → pitch → dist → bitcrush → filter → volume ──

    // Pitch shift via playback rate
    source.playbackRate.value = 0.75;

    // Heavy distortion
    const dist = makeDistortion(80);

    // Bitcrusher
    const crush = makeBitcrusher(4);

    // Filter sweep
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2000;
    filter.Q.value = 8;

    // LFO on filter frequency
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.3;
    lfoGain.gain.value = 1500;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    // Volume boost
    const vol = audioCtx.createGain();
    vol.gain.value = 2.5;

    // Reverb
    const convolver = audioCtx.createConvolver();
    const irLen = audioCtx.sampleRate * 1.5;
    const irBuf = audioCtx.createBuffer(2, irLen, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3);
    }
    convolver.buffer = irBuf;

    const dryGain = audioCtx.createGain();
    dryGain.gain.value = 0.6;
    const wetGain = audioCtx.createGain();
    wetGain.gain.value = 0.4;

    // Connect chain
    source.connect(dist);
    dist.connect(crush);
    crush.connect(filter);
    filter.connect(vol);
    vol.connect(dryGain);
    vol.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(masterGain);
    wetGain.connect(masterGain);

    source.start();

    active = { source, lfo, lfoGain, dist, crush, filter, vol, dryGain, wetGain, convolver };
    playing = true;

    masterGain.gain.setTargetAtTime(0.6, audioCtx.currentTime, 0.3);
  }

  function stop() {
    if (!playing || !active) return;
    masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.2);
    setTimeout(() => {
      try { active.source.stop(); } catch {}
      try { active.lfo.stop(); } catch {}
      active = null;
    }, 300);
    playing = false;
  }

  function setMode(mode) {
    if (!active) return;
    const t = audioCtx.currentTime;
    if (mode === "slow") {
      active.source.playbackRate.setTargetAtTime(0.4, t, 0.1);
      active.vol.gain.setTargetAtTime(3.0, t, 0.1);
      active.filter.frequency.setTargetAtTime(800, t, 0.1);
    } else if (mode === "fast") {
      active.source.playbackRate.setTargetAtTime(1.8, t, 0.1);
      active.vol.gain.setTargetAtTime(1.5, t, 0.1);
      active.filter.frequency.setTargetAtTime(4000, t, 0.1);
    } else if (mode === "deep") {
      active.source.playbackRate.setTargetAtTime(0.25, t, 0.1);
      active.vol.gain.setTargetAtTime(4.0, t, 0.1);
      active.filter.frequency.setTargetAtTime(400, t, 0.1);
    } else {
      active.source.playbackRate.setTargetAtTime(0.75, t, 0.1);
      active.vol.gain.setTargetAtTime(2.5, t, 0.1);
      active.filter.frequency.setTargetAtTime(2000, t, 0.1);
    }
  }

  function isPlaying() { return playing; }

  return { start, stop, setMode, isPlaying };
}
