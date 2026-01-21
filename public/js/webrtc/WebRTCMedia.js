// public/js/webrtc/WebRTCMedia.js
// Premium media engine: avatar fallback, local/remote media,
// audio visualization, and speaking detection.

import { rtcState } from "./WebRTCState.js";
import { localVideo, remoteVideo, remoteAudioEl } from "../session.js";

/* -------------------------------------------------------
   Logging Helper
------------------------------------------------------- */
const log = (...args) => console.log("[WebRTCMedia]", ...args);

/* -------------------------------------------------------
   Avatar Path Normalization
------------------------------------------------------- */
function normalizeAvatarPath(path) {
  if (!path) return "/NewApp/img/defaultUser.png";

  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/NewApp/")) return path;
  if (path.startsWith("/uploads/avatars/")) return `/NewApp${path}`;
  if (path.includes("uploads/avatars/"))
    return `/NewApp/${path.replace(/^\//, "")}`;

  return `/NewApp/uploads/avatars/${path}`;
}

/* -------------------------------------------------------
   Remote Avatar Controls
------------------------------------------------------- */
export function setRemoteAvatar(rawUrl) {
  const img = document.getElementById("remoteAvatarImg");
  if (!img) return;

  img.src = normalizeAvatarPath(rawUrl);
}

function toggleRemoteAvatar(show) {
  const avatar = document.getElementById("remoteAvatar");
  const video = document.getElementById("remoteVideo");
  if (!avatar || !video) return;

  avatar.style.display = show ? "flex" : "none";
  video.style.display = show ? "none" : "block";
}

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

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return log("AudioContext not supported");

    const ctx = new AudioCtx();
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
   Remote Speaking Detection
------------------------------------------------------- */
function startRemoteSpeakingDetection(stream, wrapper) {
  const ring = wrapper?.querySelector(".avatar-ring");
  if (!ring) return;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return log("AudioContext not supported");

  const ctx = new AudioCtx();
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

    requestAnimationFrame(loop);
  };

  loop();
}

/* -------------------------------------------------------
   Local Media Acquisition
------------------------------------------------------- */
export async function getLocalMedia(audio = true, video = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("getUserMedia not supported");
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
    rtcState.localStream = stream;

    if (video && localVideo) {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      await localVideo.play().catch(() => {});
    }

    updateLocalAvatarVisibility();

    const wrapper = localVideo?.closest(".local-media-wrapper");
    if (wrapper) attachAudioVisualizer(stream, wrapper);

    return stream;
  } catch (err) {
    log("Local media error:", err);
    rtcState.localStream = null;

    const avatar = document.getElementById("localAvatar");
    if (avatar) avatar.style.display = "flex";

    return null;
  }
}

/* -------------------------------------------------------
   Remote Track Handling
------------------------------------------------------- */
export function attachRemoteTrack(evt) {
  const remoteStream = rtcState.remoteStream || new MediaStream();
  rtcState.remoteStream = remoteStream;

  remoteStream.addTrack(evt.track);

  const wrapper =
    remoteVideo.closest(".remote-media-wrapper") ||
    remoteAudioEl.closest(".remote-media-wrapper");

  toggleRemoteAvatar(true);

  if (evt.track.kind === "video") {
    remoteVideo.srcObject = remoteStream;

    remoteVideo.onloadedmetadata = () => {
      remoteVideo.play().catch(() => {});
      toggleRemoteAvatar(false);
    };

    evt.track.onended = () => toggleRemoteAvatar(true);
  }

  if (evt.track.kind === "audio") {
    remoteAudioEl.srcObject = remoteStream;
    remoteAudioEl.play().catch(() => {});

    if (wrapper) startRemoteSpeakingDetection(remoteStream, wrapper);
  }

  if (wrapper) attachAudioVisualizer(remoteStream, wrapper);
}

/* -------------------------------------------------------
   Public Helper
------------------------------------------------------- */
export function refreshLocalAvatarVisibility() {
  updateLocalAvatarVisibility();
}


