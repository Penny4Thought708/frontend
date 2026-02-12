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

/* -------------------------------------------------------
   Create Remote Participant Tile (Meet‑style)
------------------------------------------------------- */
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

  // Match CallUI mobile behavior: use both peerId and id
  clone.dataset.peerId = peerId;
  clone.dataset.id = peerId;

  const videoEl   = clone.querySelector("video");
  const avatarImg = clone.querySelector(".avatar-img");
  const nameTag   = clone.querySelector(".name-tag");

  if (nameTag) nameTag.textContent = peerId || "Guest";

  if (avatarImg && !avatarImg.src) {
    avatarImg.src = "img/defaultUser.png";
  }

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
   Local Avatar Visibility
------------------------------------------------------- */
function updateLocalAvatarVisibility() {
  const localTile = document.getElementById("localParticipant");
  if (!localTile) return;

  const avatarWrapper = localTile.querySelector(".avatar-wrapper");
  if (!avatarWrapper) return;

  const stream = rtcState.localStream;

  if (rtcState.voiceOnly || rtcState.audioOnly || !stream) {
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
   Remote Speaking Detection
------------------------------------------------------- */
const speakingLoops = new Map(); // key: participantEl

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

    const threshold = rtcState.voiceOnly ? 0.035 : 0.055;
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
   Local Media Acquisition (Meet+Discord tuned + avatar fallback)
------------------------------------------------------- */
export async function getLocalMedia(audio = true, video = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("getUserMedia not supported — using empty stream fallback");
    const empty = new MediaStream();
    rtcState.localStream = empty;
    rtcState.voiceOnly = true;
    rtcState.audioOnly = true;
    updateLocalAvatarVisibility();
    return empty;
  }

  rtcState.voiceOnly = !!audio && !video;
  rtcState.audioOnly = !!audio && !video;

  log("getLocalMedia requested with:", {
    audio,
    video,
    voiceOnly: rtcState.voiceOnly,
  });

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
          frameRate: { ideal: 30, max: 30 },
        }
      : false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    log("Got local media with constraints:", constraints);

    rtcState.localStream = stream;

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
    const localTile =
      localVideo?.closest(".participant.local") ||
      document.getElementById("localParticipant");

    if (localVideo && video && !rtcState.voiceOnly) {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.classList.add("show");

      localVideo.play().catch((err) =>
        log("Local video play blocked:", err?.name || err)
      );
    }

    updateLocalAvatarVisibility();

    if (localTile) attachAudioVisualizer(stream, localTile);

    return stream;
  } catch (err) {
    log("Local media error:", err.name, err.message);

    if (video && audio && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
      log("Retrying getUserMedia with audio-only…");
      try {
        const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });

        rtcState.localStream = audioOnlyStream;
        rtcState.voiceOnly = true;
        rtcState.audioOnly = true;

        updateLocalAvatarVisibility();

        const localTile = document.getElementById("localParticipant");
        if (localTile) attachAudioVisualizer(audioOnlyStream, localTile);

        return audioOnlyStream;
      } catch (err2) {
        log("Audio-only also failed:", err2.name, err2.message);
      }
    }

    log("Falling back to empty MediaStream (avatar-only mode)");
    const empty = new MediaStream();
    rtcState.localStream = empty;
    rtcState.voiceOnly = true;
    rtcState.audioOnly = true;

    updateLocalAvatarVisibility();
    return empty;
  }
}

/* -------------------------------------------------------
   CAMERA FLIP SUPPORT (front/back) — used by CallUI rtc.switchCamera
------------------------------------------------------- */
rtcState.cameraFacing = rtcState.cameraFacing || "user"; // "user" | "environment"

export async function flipLocalCamera(rtc) {
  try {
    if (!rtc) {
      log("flipLocalCamera: rtc not provided");
      return false;
    }

    rtcState.cameraFacing =
      rtcState.cameraFacing === "user" ? "environment" : "user";

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: rtcState.cameraFacing,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    const newTrack = newStream.getVideoTracks()[0];
    if (!newTrack) {
      log("flipLocalCamera: no video track in new stream");
      return false;
    }

    const pc =
      (typeof rtc._getPrimaryPC === "function" && rtc._getPrimaryPC()) ||
      (rtc.pcMap && rtc.pcMap.size
        ? [...rtc.pcMap.values()][0]
        : rtc.peerConnection || null);

    const senders = pc?.getSenders() || [];
    const videoSender = senders.find(
      (s) => s.track && s.track.kind === "video"
    );
    if (videoSender) {
      await videoSender.replaceTrack(newTrack);
    }

    rtcState.localStream?.getVideoTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });

    if (rtcState.localStream) {
      const oldVideo = rtcState.localStream.getVideoTracks()[0];
      if (oldVideo) rtcState.localStream.removeTrack(oldVideo);
      rtcState.localStream.addTrack(newTrack);
    } else {
      rtcState.localStream = newStream;
    }

    const localVideo = document.getElementById("localVideo");
    if (localVideo) {
      localVideo.srcObject = rtcState.localStream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.classList.add("show");
      localVideo.play().catch((err) =>
        log("flipLocalCamera: local video play blocked:", err?.name || err)
      );
    }

    updateLocalAvatarVisibility();
    return true;
  } catch (err) {
    log("flipLocalCamera failed:", err);
    return false;
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
    label: evt.track.label,
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
    if (videoEl && !rtcState.voiceOnly && !rtcState.audioOnly) {
      videoEl.style.display = show ? "none" : "block";
    }
  };

  evt.track.onmute   = () => showAvatar(true);
  evt.track.onunmute = () => showAvatar(false);
  evt.track.onended  = () => {
    showAvatar(true);

    if (evt.track.label && evt.track.label.toLowerCase().includes("screen")) {
      log("Screen share track ended — exiting stage mode");
      exitScreenShareMode();
      hideLocalPip();
    }
  };

  const isScreenShare =
    evt.track.kind === "video" &&
    evt.track.label &&
    evt.track.label.toLowerCase().includes("screen");

  if (isScreenShare) {
    log("Detected SCREEN SHARE track — promoting to stage:", peerId);
    enterScreenShareMode(peerId);

    if (peerId === rtcState.peerId) {
      showLocalPip();
    }
  } else {
    const someoneSharing = Object.values(rtcState.remoteStreams).some((s) =>
      s.getVideoTracks().some(
        (t) => t.label && t.label.toLowerCase().includes("screen")
      )
    );

    if (!someoneSharing) {
      exitScreenShareMode();
      hideLocalPip();
    }
  }

  if (evt.track.kind === "video" && videoEl) {
    log("Attaching remote VIDEO to participant:", peerId);

    videoEl.srcObject = remoteStream;
    videoEl.playsInline = true;
    videoEl.muted = true; // keep muted for autoplay

    videoEl.style.display = "block";
    videoEl.style.opacity = "1";
    videoEl.classList.add("show");

    videoEl.play()
      .then(() => {
        showAvatar(false);
        participantEl.classList.add("video-active");
      })
      .catch((err) => {
        log("Remote video play blocked or failed:", err?.name || err);
      });
  }

  const remoteAudioEl = document.getElementById("remoteAudio");
  if (evt.track.kind === "audio" && remoteAudioEl) {
    log("Attaching remote AUDIO to #remoteAudio for peer:", peerId);

    remoteAudioEl.srcObject = remoteStream;
    remoteAudioEl.playsInline = true;
    remoteAudioEl.muted = false;
    remoteAudioEl.volume = 1;

    remoteAudioEl.play().catch((err) =>
      log("Remote audio autoplay blocked:", err?.name || err)
    );

    startRemoteSpeakingDetection(remoteStream, participantEl);
    attachAudioVisualizer(remoteStream, participantEl);
  }
}

/* -------------------------------------------------------
   Helper: resume remote media after user gesture
------------------------------------------------------- */
export function resumeRemoteMediaPlayback() {
  const remoteAudioEl = document.getElementById("remoteAudio");
  if (remoteAudioEl && remoteAudioEl.srcObject) {
    remoteAudioEl.play().catch(() => {});
  }

  const grid = document.getElementById("callGrid");
  if (!grid) return;

  const videos = grid.querySelectorAll(".participant video");
  videos.forEach((v) => {
    if (v.srcObject) {
      v.play().catch(() => {});
    }
  });
}

/* -------------------------------------------------------
   Cleanup on call end
------------------------------------------------------- */
export function cleanupMedia() {
  stopSpeakingDetection();

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

  if (rtcState.localStream) {
    rtcState.localStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
    rtcState.localStream = null;
  }

  rtcState.voiceOnly = false;
  rtcState.audioOnly = false;

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
   Screen Share Tile Logic (Meet-style stage mode + animation)
------------------------------------------------------- */
export function enterScreenShareMode(peerId = "local") {
  const grid = document.getElementById("callGrid");
  if (!grid) return;

  grid.classList.add("screen-share-mode");

  const tiles = grid.querySelectorAll(".participant");
  tiles.forEach((tile) => {
    const isSharer =
      tile.dataset.peerId === peerId || tile.dataset.id === peerId;

    tile.classList.remove("filmstrip", "stage", "presenting");

    if (isSharer) {
      tile.classList.add("stage", "presenting", "animate-stage-in");
      setTimeout(() => tile.classList.remove("animate-stage-in"), 350);
    } else {
      tile.classList.add("filmstrip", "animate-filmstrip-in");
      setTimeout(() => tile.classList.remove("animate-filmstrip-in"), 350);
    }
  });
}

export function exitScreenShareMode() {
  const grid = document.getElementById("callGrid");
  if (!grid) return;

  grid.classList.remove("screen-share-mode");

  const tiles = grid.querySelectorAll(".participant");
  tiles.forEach((tile) => {
    tile.classList.remove("stage", "filmstrip", "presenting");
    tile.classList.add("animate-stage-out");
    setTimeout(() => tile.classList.remove("animate-stage-out"), 350);
  });
}

/* -------------------------------------------------------
   Local PIP helpers
------------------------------------------------------- */
function showLocalPip() {
  const pip = document.getElementById("localPip");
  const pipVideo = document.getElementById("localPipVideo");

  if (!pip || !pipVideo) return;

  pipVideo.srcObject = rtcState.localStream;
  pipVideo.play().catch(() => {});
  pip.classList.remove("hidden");
  pip.classList.add("show");
}

function hideLocalPip() {
  const pip = document.getElementById("localPip");
  if (!pip) return;

  pip.classList.remove("show");
  setTimeout(() => pip.classList.add("hidden"), 250);
}

/* -------------------------------------------------------
   Active Speaker Helper (Meet-style auto-focus)
------------------------------------------------------- */
export function setActiveSpeaker(peerId) {
  const grid = document.getElementById("callGrid");
  if (!grid) return;

  const participants = Array.from(grid.querySelectorAll(".participant"));
  const index = participants.findIndex(
    (p) => p.dataset.peerId === peerId || p.dataset.id === peerId
  );

  participants.forEach((p) =>
    p.classList.toggle(
      "active",
      p.dataset.peerId === peerId || p.dataset.id === peerId
    )
  );

  if (index >= 0) {
    grid.scrollTo({
      left: index * grid.clientWidth,
      behavior: "smooth",
    });
  }
}

/* -------------------------------------------------------
   Public Helper
------------------------------------------------------- */
export function refreshLocalAvatarVisibility() {
  updateLocalAvatarVisibility();
}



