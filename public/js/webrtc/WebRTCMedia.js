// public/js/webrtc/WebRTCMedia.js
// Fully working media engine for 1:1 + group calls.
// Handles: local media, remote media, avatars, speaking detection,
// audio visualization, voice-only mode, and CSS-aware video visibility.

import { rtcState } from "./WebRTCState.js";

/* -------------------------------------------------------
   Shared AudioContext (Safari-safe)
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

const log = (...args) => console.log("[WebRTCMedia]", ...args);

/* -------------------------------------------------------
   DOM Helpers
------------------------------------------------------- */
function getCallGrid() {
  return document.getElementById("callGrid");
}

function getRemoteTemplate() {
  return document.getElementById("remoteParticipantTemplate");
}

function ensureRemoteMap() {
  if (!rtcState.remoteParticipants) rtcState.remoteParticipants = {};
  return rtcState.remoteParticipants;
}

function createRemoteParticipant(peerId = "default") {
  const grid = getCallGrid();
  const tpl = getRemoteTemplate();
  if (!grid || !tpl) return null;

  const map = ensureRemoteMap();
  if (map[peerId]) return map[peerId];

  const clone = tpl.content.firstElementChild.cloneNode(true);
  clone.dataset.peerId = peerId;

  const nameTag = clone.querySelector(".name-tag");
  if (nameTag) nameTag.textContent = peerId;

  grid.appendChild(clone);
  map[peerId] = clone;
  return clone;
}

function getRemoteParticipant(peerId = "default") {
  const map = ensureRemoteMap();
  return map[peerId] || createRemoteParticipant(peerId);
}

/* -------------------------------------------------------
   Local Avatar Visibility
------------------------------------------------------- */
function updateLocalAvatarVisibility() {
  const tile = document.getElementById("localParticipant");
  if (!tile) return;

  const avatar = tile.querySelector(".avatar-wrapper");
  if (!avatar) return;

  const stream = rtcState.localStream;

  if (rtcState.voiceOnly || !stream) {
    avatar.style.display = "flex";
    return;
  }

  const hasVideo = stream.getVideoTracks().some(t => t.enabled);
  avatar.style.display = hasVideo ? "none" : "flex";
}

/* -------------------------------------------------------
   Audio Visualizer
------------------------------------------------------- */
function attachAudioVisualizer(stream, tile) {
  if (!stream || !tile) return;

  const ctx = getAudioCtx();
  if (!ctx) return;

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
      const factor = rtcState.voiceOnly ? 5 : 4;
      const level = Math.min(1, rms * factor);

      tile.style.setProperty("--audio-level", level.toFixed(3));
      requestAnimationFrame(tick);
    };

    tick();
  } catch (err) {
    log("Visualizer error:", err);
  }
}

/* -------------------------------------------------------
   Speaking Detection
------------------------------------------------------- */
const speakingLoops = new Map();

function startRemoteSpeakingDetection(stream, tile) {
  const ctx = getAudioCtx();
  if (!ctx) return;

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
    const threshold = rtcState.voiceOnly ? 0.045 : 0.06;

    tile.classList.toggle("speaking", smoothed > threshold);

    const id = requestAnimationFrame(loop);
    speakingLoops.set(tile, id);
  };

  loop();
}

export function stopSpeakingDetection() {
  for (const [tile, id] of speakingLoops.entries()) {
    cancelAnimationFrame(id);
    tile.classList.remove("speaking");
  }
  speakingLoops.clear();
}

/* -------------------------------------------------------
   Local Media
------------------------------------------------------- */
export async function getLocalMedia(audio = true, video = true) {
  rtcState.voiceOnly = !!audio && !video;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audio ? { echoCancellation: true, noiseSuppression: true } : false,
      video: video ? { width: 1280, height: 720 } : false
    });

    rtcState.localStream = stream;

    const localVideo = document.getElementById("localVideo");
    if (localVideo && video && !rtcState.voiceOnly) {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      await localVideo.play().catch(() => {});
      localVideo.classList.add("show");
    }

    updateLocalAvatarVisibility();

    const tile = document.getElementById("localParticipant");
    if (tile) attachAudioVisualizer(stream, tile);

    return stream;
  } catch (err) {
    log("Local media error:", err);
    rtcState.localStream = null;
    updateLocalAvatarVisibility();
    return null;
  }
}

/* -------------------------------------------------------
   Remote Track Handling (CSS-aware)
------------------------------------------------------- */
export function attachRemoteTrack(peerOrEvt, maybeEvt) {
  let peerId, evt;

  if (maybeEvt) {
    peerId = peerOrEvt || "default";
    evt = maybeEvt;
  } else {
    peerId = "default";
    evt = peerOrEvt;
  }

  if (!evt?.track) return;

  if (!rtcState.remoteStreams) rtcState.remoteStreams = {};
  let stream = rtcState.remoteStreams[peerId];
  if (!stream) {
    stream = new MediaStream();
    rtcState.remoteStreams[peerId] = stream;
  }
  stream.addTrack(evt.track);

  const tile = getRemoteParticipant(peerId);
  if (!tile) return;

  const videoEl = tile.querySelector("video");
  const avatar = tile.querySelector(".avatar-wrapper");

  const showAvatar = show => {
    if (!avatar) return;
    avatar.classList.toggle("hidden", !show);
  };

  /* -----------------------------
     VIDEO TRACK
  ----------------------------- */
  if (evt.track.kind === "video" && videoEl && !rtcState.voiceOnly) {
    videoEl.srcObject = stream;
    videoEl.playsInline = true;
    videoEl.classList.add("show");

    videoEl.play()
      .then(() => {
        showAvatar(false);
        tile.classList.add("video-active");
      })
      .catch(err => log("Remote video play blocked:", err));
  }

  /* -----------------------------
     AUDIO TRACK
  ----------------------------- */
  const remoteAudio = document.getElementById("remoteAudio");
  if (evt.track.kind === "audio" && remoteAudio) {
    remoteAudio.srcObject = stream;
    remoteAudio.playsInline = true;
    remoteAudio.muted = false;

    remoteAudio.play().catch(() => {
      log("Remote audio autoplay blocked");
    });

    startRemoteSpeakingDetection(stream, tile);
    attachAudioVisualizer(stream, tile);
  }

  /* -----------------------------
     MUTE / UNMUTE HANDLERS
  ----------------------------- */
  evt.track.onmute = () => {
    if (videoEl) videoEl.classList.remove("show");
    showAvatar(true);
  };

  evt.track.onunmute = () => {
    if (videoEl && !rtcState.voiceOnly) videoEl.classList.add("show");
    showAvatar(false);
  };

  evt.track.onended = () => {
    if (videoEl) videoEl.classList.remove("show");
    showAvatar(true);
  };
}

/* -------------------------------------------------------
   Cleanup
------------------------------------------------------- */
export function cleanupMedia() {
  stopSpeakingDetection();

  if (rtcState.remoteStreams) {
    Object.values(rtcState.remoteStreams).forEach(s =>
      s.getTracks().forEach(t => t.stop())
    );
    rtcState.remoteStreams = {};
  }

  if (rtcState.localStream) {
    rtcState.localStream.getTracks().forEach(t => t.stop());
    rtcState.localStream = null;
  }

  const localVideo = document.getElementById("localVideo");
  if (localVideo) localVideo.classList.remove("show");

  const map = rtcState.remoteParticipants || {};
  Object.values(map).forEach(tile => {
    const videoEl = tile.querySelector("video");
    if (videoEl) videoEl.classList.remove("show");

    const avatar = tile.querySelector(".avatar-wrapper");
    if (avatar) avatar.classList.remove("hidden");

    tile.classList.remove("video-active", "speaking");
  });

  const remoteAudio = document.getElementById("remoteAudio");
  if (remoteAudio) remoteAudio.srcObject = null;

  updateLocalAvatarVisibility();
}

/* -------------------------------------------------------
   Public Helper
------------------------------------------------------- */
export function refreshLocalAvatarVisibility() {
  updateLocalAvatarVisibility();
}













