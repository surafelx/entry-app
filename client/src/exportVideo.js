// Video export pipeline: renders effects to Canvas + processes audio via Web Audio API.
// Returns a Blob of the edited video.

import { processFrame } from "./videoFx.js";

function pickMime() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
}

export async function exportVideo({
  sourceUrl,
  trimStart = 0,
  trimEnd = Infinity,
  volume = 1,
  speed = 1,
  noiseReduction = false,
  brightness = 1,
  contrast = 1,
  saturation = 1,
  blur = 0,
  grayscale = 0,
  sepia = 0,
  hueRotate = 0,
  overlayText = "",
  overlaySize = 48,
  overlayColor = "#ffffff",
  overlayPosition = "bottom",
  // stylize + compress
  pixelSize = 1,
  posterize = 0,
  dither = "none",
  duotone = null,
  grain = 0.08,
  vignette = true,
  maxHeight = 720, // downscale-for-upload cap
  onProgress,
}) {
  return new Promise(async (resolve, reject) => {
    try {
      // Set up hidden video element
      const video = document.createElement("video");
      video.src = sourceUrl;
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";

      await new Promise((res, rej) => {
        video.onloadedmetadata = res;
        video.onerror = rej;
      });

      const duration = video.duration;
      const end = Math.min(trimEnd, duration);
      const startTime = trimStart;
      const totalDuration = end - startTime;

      if (totalDuration <= 0) {
        reject(new Error("Invalid trim range"));
        return;
      }

      // Canvas, downscaled to maxHeight for a lighter upload.
      const srcW = video.videoWidth || 1280;
      const srcH = video.videoHeight || 720;
      const scale = maxHeight && srcH > maxHeight ? maxHeight / srcH : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(srcW * scale);
      canvas.height = Math.round(srcH * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const fxOpts = {
        brightness, contrast, saturation, blur, grayscale, sepia, hueRotate,
        pixelSize, posterize, dither, duotone, grain, vignette,
        overlayText, overlaySize, overlayColor, overlayPosition,
      };
      const stylized = pixelSize > 1 || posterize > 1 || (dither && dither !== "none") || duotone;

      // Set up audio processing
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const sourceNode = audioCtx.createMediaElementSource(video);

      // Volume control
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = volume;

      // Noise reduction (lowpass filter to cut high-freq noise)
      let lastNode = sourceNode;
      sourceNode.connect(gainNode);
      lastNode = gainNode;

      if (noiseReduction) {
        const lowpass = audioCtx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 3500;
        lowpass.Q.value = 0.7;
        lastNode.connect(lowpass);
        lastNode = lowpass;

        const highpass = audioCtx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 200;
        highpass.Q.value = 0.5;
        lastNode.connect(highpass);
        lastNode = highpass;
      }

      // Master output for speaker preview
      const masterGain = audioCtx.createGain();
      masterGain.gain.value = 0; // silent during export
      lastNode.connect(masterGain);
      masterGain.connect(audioCtx.destination);

      // Recording destination
      const audioDest = audioCtx.createMediaStreamDestination();
      lastNode.connect(audioDest);

      // Combine video + audio streams
      const canvasStream = canvas.captureStream(30);
      const mimeType = pickMime();
      const recorderOptions = { mimeType };
      // Stylized/pixelated frames compress hard, so spend far fewer bits.
      recorderOptions.videoBitsPerSecond = stylized ? 1_200_000 : 2_500_000;
      recorderOptions.audioBitsPerSecond = 128_000;
      const recorder = new MediaRecorder(
        new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioDest.stream.getAudioTracks(),
        ]),
        recorderOptions
      );

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        audioCtx.close().catch(() => {});
        resolve(blob);
      };

      recorder.onerror = (e) => {
        audioCtx.close().catch(() => {});
        reject(e.error || new Error("Recording failed"));
      };

      // Seek to start position
      video.currentTime = startTime;
      video.playbackRate = speed;

      video.onseeked = async () => {
        try {
          await audioCtx.resume();
          recorder.start(100);

          const renderFrame = () => {
            if (video.paused || video.ended || video.currentTime >= end) {
              video.pause();
              if (recorder.state === "recording") {
                recorder.stop();
              }
              return;
            }

            // Render the frame with the shared FX pipeline (pixelate, posterize,
            // dither, duotone, color grade, overlays) — identical to the preview.
            processFrame(video, canvas, ctx, fxOpts);

            // Progress callback
            const progress = (video.currentTime - startTime) / totalDuration;
            onProgress?.(Math.min(progress, 1));

            requestAnimationFrame(renderFrame);
          };

          video.play();
          renderFrame();
        } catch (err) {
          audioCtx.close().catch(() => {});
          reject(err);
        }
      };
    } catch (err) {
      reject(err);
    }
  });
}
