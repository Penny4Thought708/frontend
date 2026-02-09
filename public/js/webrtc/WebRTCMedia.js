// public/js/webrtc/WebRTCMedia.js
// Production‑grade media engine for the new call window:
// local/remote media, audio visualization, speaking detection,
// voice‑only optimization, and group‑aware layout.

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

/**
 * Create a remote participant tile from the template and
 * append it to #callGrid. Returns the tile element.
 */
function createRemoteParticipant(peerId = "default") {
  const grid = getCallGrid();
  const tpl = getRemoteTemplate();

  if (!grid || !tpl) {
    log("createRemoteParticipant: missing grid or template");
    return null;
  }

  const map = ensureRemoteMap();
  if (map[peerId]) return map[peerId];

  const clone = tpl.content.firstElementChild.cloneNode(true);
  clone.dataset.peerId = peerId;

  const videoEl   = clone.querySelector("video");
  const avatarImg = clone.querySelector(".avatar-img");
  const nameTag   = clone.querySelector(".name-tag");

  if (nameTag) {
    nameTag.textContent = peerId || "Guest";
  }

  if (avatarImg && !avatarImg.src) {
    avatarImg.src = "img/defaultUser.png";
  }

  // Voice‑only: hide video element entirely
  if (rtcState.voiceOnly && videoEl) {
    videoEl.style.display = "none";
    videoEl.removeAttribute("srcObject");
  }

  grid.appendChild(clone);
  map[peerId] = clone;

  log("createRemoteParticipant: created tile for peer:", peerId);
  return clone;
}

function getRemoteParticipant(peerId = "default") {
  const map = ensureRemoteMap();
  return map[peerId] || createRemoteParticipant(peerId);
}

/* -------------------------------------------------------
   Local Avatar Visibility (grid layout)
------------------------------------------------------- */
function updateLocalAvatarVisibility() {
  const localTile = document.getElementById("localParticipant");
  if (!localTile) return;

  const avatarWrapper = localTile.querySelector(".avatar-wrapper");
  if (!avatarWrapper) return;

  const stream = rtcState.localStream;

  // Voice‑only: always show avatar
  if (rtcState.voiceOnly) {
    avatarWrapper.style.display = "flex";
    return;
  }

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
  if (!ctx) {
    log("AudioContext not supported");
    return;
  }

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
  if (!participantEl || !stream) return;

  const ctx = getAudioCtx();
  if (!ctx) {
    log("AudioContext not supported");
    return;
  }

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
    const speaking = smoothed > threshold;

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
   Local Media Acquisition (voice/video aware)
------------------------------------------------------- */
export async function getLocalMedia(audio = true, video = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("getUserMedia not supported");
    return null;
  }

  rtcState.voiceOnly = !!audio && !video;
  log("getLocalMedia requested with:", { audio, video, voiceOnly: rtcState.voiceOnly });

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

    stream.getVideoTracks().forEach((t) => {
      try { t.contentHint = "motion"; } catch {}
    });
    stream.getAudioTracks().forEach((t) => {
      try { t.contentHint = "speech"; } catch {}
    });

    const localVideo = document.getElementById("localVideo");
    const localTile =
      localVideo?.closest(".participant.local") ||
      document.getElementById("localParticipant");

    if (localVideo && video && !rtcState.voiceOnly) {
      log("Attaching local stream to #localVideo");
      localVideo.srcObject = stream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.classList.add("show");

      localVideo
        .play()
        .then(() => log("Local video playing"))
        .catch((err) => log("Local video play blocked:", err?.name || err));
    } else if (!localVideo) {
      log("No #localVideo element found in DOM");
    }

    updateLocalAvatarVisibility();

    if (localTile) {
      attachAudioVisualizer(stream, localTile);
    } else {
      log("No local tile found for audio visualizer");
    }

    return stream;
  } catch (err) {
    log("Local media error:", err.name, err.message);

    // Retry audio‑only if full AV fails
    if (
      video &&
      audio &&
      (err.name === "NotFoundError" || err.name === "OverconstrainedError")
    ) {
      log("Retrying getUserMedia with audio‑only…");
      try {
        const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        rtcState.localStream = audioOnlyStream;
        rtcState.voiceOnly = true;

        updateLocalAvatarVisibility();

        const localTile = document.getElementById("localParticipant");
        if (localTile) attachAudioVisualizer(audioOnlyStream, localTile);

        return audioOnlyStream;
      } catch (err2) {
        log("Audio‑only also failed:", err2.name, err2.message);
      }
    }

    rtcState.localStream = null;
    rtcState.voiceOnly = !!audio && !video;

    const localTile = document.getElementById("localParticipant");
    const avatarWrapper = localTile?.querySelector(".avatar-wrapper");
    if (avatarWrapper) avatarWrapper.style.display = "flex";

    return null;
  }
}

/* -------------------------------------------------------
   Remote Track Handling (GROUP‑AWARE + voice‑only)
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

  if (!rtcState.remoteStreams) {
    rtcState.remoteStreams = {};
  }

  let remoteStream = rtcState.remoteStreams[peerId];
  if (!remoteStream) {
    remoteStream = new MediaStream();
    rtcState.remoteStreams[peerId] = remoteStream;
  }
  remoteStream.addTrack(evt.track);

  log("attachRemoteTrack:", {
    peerId,
    kind: evt.track.kind,
    readyState: evt.track.readyState,
  });

  const participantEl = getRemoteParticipant(peerId);
  if (!participantEl) {
    log("No participant element for peer:", peerId);
    return;
  }

  const videoEl       = participantEl.querySelector("video");
  const avatarWrapper = participantEl.querySelector(".avatar-wrapper");

  const showAvatar = (show) => {
    if (avatarWrapper) avatarWrapper.style.display = show ? "flex" : "none";
    if (videoEl && !rtcState.voiceOnly) {
      videoEl.style.display = show ? "none" : "block";
    }
  };

  evt.track.onmute   = () => { log("Remote track muted:", peerId, evt.track.kind); showAvatar(true); };
  evt.track.onunmute = () => { log("Remote track unmuted:", peerId, evt.track.kind); showAvatar(false); };
  evt.track.onended  = () => { log("Remote track ended:", peerId, evt.track.kind); showAvatar(true); };

  /* -----------------------------
     Remote Video
  ----------------------------- */
  if (!rtcState.voiceOnly && evt.track.kind === "video" && videoEl) {
    log("Attaching remote VIDEO to participant:", peerId);
    videoEl.srcObject = remoteStream;
    videoEl.playsInline = true;
    videoEl.style.display = "block";
    videoEl.style.opacity = "1";
    videoEl.classList.add("show");

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
    log("Attaching remote AUDIO to #remoteAudio for peer:", peerId);
    remoteAudioEl.srcObject = remoteStream;
    remoteAudioEl.playsInline = true;
    remoteAudioEl.muted = false;
    remoteAudioEl.volume = 1;

    remoteAudioEl
      .play()
      .then(() => log("Remote audio playing"))
      .catch(() => log("Remote audio autoplay blocked"));

    startRemoteSpeakingDetection(remoteStream, participantEl);
    attachAudioVisualizer(remoteStream, participantEl);
  }
}

/* -------------------------------------------------------
   Cleanup on call end
------------------------------------------------------- */
export function cleanupMedia() {
  stopSpeakingDetection();

  if (rtcState.remoteStreams) {
    Object.values(rtcState.remoteStreams).forEach((stream) => {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
    });
    rtcState.remoteStreams = {};
  }

  if (rtcState.localStream) {
    rtcState.localStream.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    rtcState.localStream = null;
  }

  rtcState.voiceOnly = false;

  const localVideo = document.getElementById("localVideo");
  if (localVideo) {
    localVideo.srcObject = null;
    localVideo.style.display = "none";
    localVideo.style.opacity = "0";
    localVideo.classList.remove("show");
  }

  const map = rtcState.remoteParticipants || {};
  Object.values(map).forEach((participantEl) => {
    const videoEl = participantEl.querySelector("video");
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.style.display = "none";
      videoEl.style.opacity = "0";
      videoEl.classList.remove("show");
    }
    const avatarWrapper = participantEl.querySelector(".avatar-wrapper");
    if (avatarWrapper) avatarWrapper.style.display = "flex";
    participantEl.classList.remove("video-active", "speaking");
  });

  const remoteAudioEl = document.getElementById("remoteAudio");
  if (remoteAudioEl) {
    remoteAudioEl.srcObject = null;
  }

  updateLocalAvatarVisibility();
}

/* -------------------------------------------------------
   Public Helper
------------------------------------------------------- */
export function refreshLocalAvatarVisibility() {
  updateLocalAvatarVisibility();
}












