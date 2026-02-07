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
   DOM Helpers for Group Layout
------------------------------------------------------- */
function getCallGrid() {
  return document.getElementById("callGrid");
}

function getRemoteTemplate() {
  return document.getElementById("remoteParticipantTemplate");
}

function ensureRemoteMap() {
  if (!rtcState.remoteParticipants) {
    rtcState.remoteParticipants = {};
  }
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

  const videoEl = clone.querySelector("video");
  const avatarImg = clone.querySelector(".avatar-img");
  const nameTag = clone.querySelector(".name-tag");

  if (nameTag) nameTag.textContent = peerId || "Guest";
  if (avatarImg && !avatarImg.src) {
    avatarImg.src = "img/defaultUser.png";
  }

  grid.appendChild(clone);
  map[peerId] = clone;
  return clone;
}

function getRemoteParticipant(peerId = "default") {
  const map = ensureRemoteMap();
  return map[peerId] || createRemoteParticipant(peerId);
}

/* -------------------------------------------------------
   Local Avatar Visibility (new grid layout)
------------------------------------------------------- */
function updateLocalAvatarVisibility() {
  const localTile = document.getElementById("localParticipant");
  if (!localTile) return;

  const avatarWrapper = localTile.querySelector(".avatar-wrapper");
  if (!avatarWrapper) return;

  const stream = rtcState.localStream;
  if (!stream) {
    avatarWrapper.style.display = "flex";
    return;
  }

  const hasVideo = stream.getVideoTracks().some((t) => t.enabled);
  avatarWrapper.style.display = hasVideo ? "none" : "flex";
}

/* -------------------------------------------------------
   Audio Visualizer (CSS variable --audio-level)
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
   Remote Speaking Detection (per participant)
------------------------------------------------------- */
const speakingLoops = new Map();

function startRemoteSpeakingDetection(stream, participantEl) {
  if (!participantEl) return;

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
    const speaking = smoothed > 0.06;

    participantEl.classList.toggle("speaking", speaking);

    const id = requestAnimationFrame(loop);
    speakingLoops.set(participantEl, id);
  };

  loop();
}

export function stopSpeakingDetection() {
  for (const [el, id] of speakingLoops.entries()) {
    cancelAnimationFrame(id);
    el.classList.remove("speaking");
  }
  speakingLoops.clear();
}

/* -------------------------------------------------------
   Local Media Acquisition (premium constraints)
------------------------------------------------------- */
export async function getLocalMedia(audio = true, video = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("getUserMedia not supported");
    return null;
  }

  const constraints = {
    audio: audio
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        }
      : false,
    video: video
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        }
      : false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    log("Got local media with constraints:", constraints);
    rtcState.localStream = stream;

    // Content hints for better encoding
    stream.getVideoTracks().forEach((t) => {
      try {
        t.contentHint = "motion";
      } catch {}
    });
    stream.getAudioTracks().forEach((t) => {
      try {
        t.contentHint = "speech";
      } catch {}
    });

    const localVideo = document.getElementById("localVideo");
    if (video && localVideo) {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      await localVideo.play().catch(() => {});
    }

    updateLocalAvatarVisibility();

    const localTile =
      localVideo?.closest(".participant.local") ||
      document.getElementById("localParticipant");
    if (localTile) attachAudioVisualizer(stream, localTile);

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

        const localTile = document.getElementById("localParticipant");
        if (localTile) attachAudioVisualizer(audioOnlyStream, localTile);

        return audioOnlyStream;
      } catch (err2) {
        log("Audio-only also failed:", err2.name, err2.message);
      }
    }

    rtcState.localStream = null;

    const localTile = document.getElementById("localParticipant");
    const avatarWrapper = localTile?.querySelector(".avatar-wrapper");
    if (avatarWrapper) avatarWrapper.style.display = "flex";

    return null;
  }
}

/* -------------------------------------------------------
   Remote Track Handling (GROUP-AWARE)
------------------------------------------------------- */
export function attachRemoteTrack(peerOrEvt, maybeEvt) {
  let peerId;
  let evt;

  if (maybeEvt) {
    peerId = peerOrEvt || "default";
    evt = maybeEvt;
  } else {
    peerId = "default";
    evt = peerOrEvt;
  }

  if (!evt || !evt.track) {
    log("attachRemoteTrack called without track");
    return;
  }

  // Per-peer remote stream
  if (!rtcState.remoteStreams) {
    rtcState.remoteStreams = {};
  }
  let remoteStream = rtcState.remoteStreams[peerId];
  if (!remoteStream) {
    remoteStream = new MediaStream();
    rtcState.remoteStreams[peerId] = remoteStream;
  }
  remoteStream.addTrack(evt.track);

  const participantEl = getRemoteParticipant(peerId);
  if (!participantEl) {
    log("No participant element for peer:", peerId);
    return;
  }

  const videoEl = participantEl.querySelector("video");
  const avatarWrapper = participantEl.querySelector(".avatar-wrapper");

  const showAvatar = (show) => {
    if (avatarWrapper) avatarWrapper.style.display = show ? "flex" : "none";
    if (videoEl) videoEl.style.display = show ? "none" : "block";
  };

  // Track events
  evt.track.onmute = () => showAvatar(true);
  evt.track.onunmute = () => showAvatar(false);
  evt.track.onended = () => showAvatar(true);

  /* -----------------------------
     Remote Video
  ----------------------------- */
  if (evt.track.kind === "video" && videoEl) {
    videoEl.srcObject = remoteStream;
    videoEl.playsInline = true;
    videoEl.style.display = "block";
    videoEl.style.opacity = "1";

    videoEl
      .play()
      .then(() => {
        showAvatar(false);
        participantEl.classList.add("video-active");
        log("Remote VIDEO playing for peer:", peerId);
      })
      .catch((err) => {
        log("Remote video play blocked or failed:", err?.name || err);
      });
  }

  /* -----------------------------
     Remote Audio (shared element)
  ----------------------------- */
  const remoteAudioEl = document.getElementById("remoteAudio");
  if (evt.track.kind === "audio" && remoteAudioEl) {
    remoteAudioEl.srcObject = remoteStream;
    remoteAudioEl.playsInline = true;
    remoteAudioEl.muted = false;

    remoteAudioEl.play().catch(() => {
      log("Remote audio autoplay blocked");
    });

    startRemoteSpeakingDetection(remoteStream, participantEl);
    attachAudioVisualizer(remoteStream, participantEl);
  }
}

/* -------------------------------------------------------
   Cleanup on call end
------------------------------------------------------- */
export function cleanupMedia() {
  stopSpeakingDetection();

  // Stop per-peer remote streams
  if (rtcState.remoteStreams) {
    Object.values(rtcState.remoteStreams).forEach((stream) => {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    });
    rtcState.remoteStreams = {};
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

  // Clear local video
  const localVideo = document.getElementById("localVideo");
  if (localVideo) {
    localVideo.srcObject = null;
    localVideo.style.display = "none";
    localVideo.style.opacity = "0";
  }

  // Clear remote videos (all participants)
  const map = rtcState.remoteParticipants || {};
  Object.values(map).forEach((participantEl) => {
    const videoEl = participantEl.querySelector("video");
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.style.display = "none";
      videoEl.style.opacity = "0";
    }
    const avatarWrapper = participantEl.querySelector(".avatar-wrapper");
    if (avatarWrapper) avatarWrapper.style.display = "flex";
    participantEl.classList.remove("video-active", "speaking");
  });

  // Clear shared remote audio element
  const remoteAudioEl = document.getElementById("remoteAudio");
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












