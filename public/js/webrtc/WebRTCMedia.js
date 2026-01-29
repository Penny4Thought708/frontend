// public/js/webrtc/WebRTCMedia.js
// Production‑grade media engine: local/remote media,
// audio visualization, speaking detection, and Safari‑safe playback.

import { rtcState } from "./WebRTCState.js";

/* -------------------------------------------------------
   Shared AudioContext (Safari‑safe, mobile‑safe)
------------------------------------------------------- */
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

/* -------------------------------------------------------
   Logging Helper
------------------------------------------------------- */
const log = (...args) => console.log("[WebRTCMedia]", ...args);

/* -------------------------------------------------------
   Local Avatar Visibility
------------------------------------------------------- */
function updateLocalAvatarVisibility() {
  const avatar = document.getElementById("localAvatar");
  if (!avatar) return;

  const stream = rtcState.localStream;
  if (!stream) {
    avatar.style.display = "flex";
    return;
  }

  const hasVideo = stream.getVideoTracks().some((t) => t.enabled);
  avatar.style.display = hasVideo ? "none" : "flex";
}

/* -------------------------------------------------------
   Audio Visualizer (CSS variable)
------------------------------------------------------- */
function attachAudioVisualizer(stream, target, cssVar = "--audio-level") {
  if (!stream || !target) return;

  const ctx = getAudioCtx();
  if (!ctx) return log("AudioContext not supported");

  try {
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();

    analyser.fftSize = 256;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);

    const tick = () => {
      analyser.getByteTimeDomainData(buf);

      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }

      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 4);

      target.style.setProperty(cssVar, level.toFixed(3));
      requestAnimationFrame(tick);
    };

    tick();
  } catch (err) {
    log("Visualizer error:", err);
  }
}

/* -------------------------------------------------------
   Remote Speaking Detection (with cleanup)
------------------------------------------------------- */
let speakingLoopId = null;

function startRemoteSpeakingDetection(stream, wrapper) {
  const ring = wrapper?.querySelector(".avatar-ring");
  if (!ring) return;

  const ctx = getAudioCtx();
  if (!ctx) return log("AudioContext not supported");

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  const src = ctx.createMediaStreamSource(stream);
  src.connect(analyser);

  const buf = new Uint8Array(analyser.frequencyBinCount);
  let smoothed = 0;

  const loop = () => {
    analyser.getByteFrequencyData(buf);
    const avg = buf.reduce((a, b) => a + b, 0) / buf.length / 255;

    smoothed = smoothed * 0.8 + avg * 0.2;
    ring.classList.toggle("speaking", smoothed > 0.06);

    speakingLoopId = requestAnimationFrame(loop);
  };

  loop();
}

export function stopSpeakingDetection() {
  if (speakingLoopId) {
    cancelAnimationFrame(speakingLoopId);
    speakingLoopId = null;
  }
}

/* -------------------------------------------------------
   Local Media Acquisition
------------------------------------------------------- */
export async function getLocalMedia(audio = true, video = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("getUserMedia not supported");
    return null;
  }

  const constraints = { audio, video };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    log("Got local media with constraints:", constraints);
    rtcState.localStream = stream;

    const localVideo = document.getElementById("localVideo");
    if (video && localVideo) {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      await localVideo.play().catch(() => {});
    }

    updateLocalAvatarVisibility();

    const wrapper =
      localVideo?.closest(".local-media-wrapper") ||
      document.getElementById("localVideoWrapper");
    if (wrapper) attachAudioVisualizer(stream, wrapper);

    return stream;
  } catch (err) {
    log("Local media error:", err.name, err.message);

    // Retry audio-only if video fails
    if (video && audio && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
      log("Retrying getUserMedia with audio-only…");
      try {
        const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        rtcState.localStream = audioOnlyStream;
        updateLocalAvatarVisibility();
        return audioOnlyStream;
      } catch (err2) {
        log("Audio-only also failed:", err2.name, err2.message);
      }
    }

    rtcState.localStream = null;

    const avatar = document.getElementById("localAvatar");
    if (avatar) avatar.style.display = "flex";

    return null;
  }
}

/* -------------------------------------------------------
   Remote Track Handling (UPDATED — FIXED VIDEO)
------------------------------------------------------- */
export function attachRemoteTrack(evt) {
  let remoteStream = rtcState.remoteStream;
  if (!remoteStream) {
    remoteStream = new MediaStream();
    rtcState.remoteStream = remoteStream;
  }

  remoteStream.addTrack(evt.track);

  const remoteVideo = document.getElementById("remoteVideo");
  const remoteAudioEl = document.getElementById("remoteAudio");

  const wrapper =
    remoteVideo?.closest(".remote-media-wrapper") ||
    remoteAudioEl?.closest(".remote-media-wrapper") ||
    document.getElementById("remoteWrapper");

  const remoteAvatar = document.getElementById("remoteAvatar");

  const showAvatar = (show) => {
    if (remoteAvatar) remoteAvatar.style.display = show ? "flex" : "none";
    if (remoteVideo) remoteVideo.style.display = show ? "none" : "block";
  };

  // Track events
  evt.track.onmute = () => showAvatar(true);
  evt.track.onunmute = () => showAvatar(false);
  evt.track.onended = () => showAvatar(true);

  /* -----------------------------
     Remote Video (FIXED)
  ----------------------------- */
  if (evt.track.kind === "video" && remoteVideo) {
    remoteVideo.srcObject = remoteStream;
    remoteVideo.playsInline = true;
    remoteVideo.style.display = "block";
    remoteVideo.style.opacity = "1";

    // FIX: Play immediately — do NOT rely on onloadedmetadata
    remoteVideo
      .play()
      .then(() => {
        showAvatar(false);
        log("Remote VIDEO playing");
      })
      .catch((err) => {
        log("Remote video play blocked or failed:", err?.name || err);
      });
  }

  /* -----------------------------
     Remote Audio
  ----------------------------- */
  if (evt.track.kind === "audio" && remoteAudioEl) {
    remoteAudioEl.srcObject = remoteStream;
    remoteAudioEl.playsInline = true;
    remoteAudioEl.muted = false;

    remoteAudioEl.play().catch(() => {
      log("Remote audio autoplay blocked");
    });

    if (wrapper) startRemoteSpeakingDetection(remoteStream, wrapper);
  }

  /* -----------------------------
     Visualizer (only once)
  ----------------------------- */
  if (wrapper && evt.track.kind === "audio") {
    attachAudioVisualizer(remoteStream, wrapper);
  }
}

/* -------------------------------------------------------
   Cleanup on call end
------------------------------------------------------- */
export function cleanupMedia() {
  stopSpeakingDetection();

  // Stop remote tracks
  if (rtcState.remoteStream) {
    rtcState.remoteStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
    rtcState.remoteStream = null;
  }

  // Stop local tracks
  if (rtcState.localStream) {
    rtcState.localStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
    rtcState.localStream = null;
  }

  // Clear media elements
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");
  const remoteAudioEl = document.getElementById("remoteAudio");

  if (localVideo) {
    localVideo.srcObject = null;
    localVideo.style.display = "none";
    localVideo.style.opacity = "0";
  }
  if (remoteVideo) {
    remoteVideo.srcObject = null;
    remoteVideo.style.display = "none";
    remoteVideo.style.opacity = "0";
  }
  if (remoteAudioEl) {
    remoteAudioEl.srcObject = null;
  }
}

/* -------------------------------------------------------
   Public Helper
------------------------------------------------------- */
export function refreshLocalAvatarVisibility() {
  updateLocalAvatarVisibility();
}














