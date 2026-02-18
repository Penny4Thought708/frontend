// public/js/webrtc/WebRTCMedia.js
// High-performance media engine for FaceTime-style mobile + Google Meet / Discord web

import { rtcState } from "./WebRTCState.js";
import {
  attachParticipantStream,
  setParticipantSpeaking,
} from "./RemoteParticipants.js";

function log(...args) {
  console.log("[WebRTCMedia]", ...args);
}

const isMobile =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

// ============================================================
// VIDEO PROFILES (mobile vs desktop)
// ============================================================
const VIDEO_PROFILES = {
  mobile: {
    width: { ideal: 960, max: 1280 },
    height: { ideal: 540, max: 720 },
    frameRate: { ideal: 24, max: 30 },
    advanced: [{ width: 960, height: 540 }, { frameRate: 24 }],
  },
  desktop: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 60 },
    advanced: [{ width: 1280, height: 720 }, { frameRate: 30 }],
  },
};

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// ============================================================
// DOM ACCESS (lazy lookups so late-injected UI works)
// ============================================================
function getDom() {
  return {
    localVideo: document.getElementById("localVideo"),
    localPipVideo: document.getElementById("localPipVideo"),
    localAvatarWrapper: document
      .getElementById("localAvatarImg")
      ?.closest(".avatar-wrapper"),
    remoteAudio: document.getElementById("remoteAudio"),
    remotePipVideo: document.getElementById("remotePipVideo"),
  };
}

function ensureRemoteStreams() {
  if (!rtcState.remoteStreams) rtcState.remoteStreams = {};
}

// ============================================================
// SHARED AUDIO CONTEXT + SPEAKING DETECTION
// ============================================================
let sharedAudioCtx = null;
const speakingAnalysers = new Map(); // peerId -> { analyser, data, source }
let speakingLoopRunning = false;

function getSharedAudioContext() {
  if (sharedAudioCtx) return sharedAudioCtx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    log("AudioContext not supported");
    return null;
  }
  sharedAudioCtx = new AudioCtx();
  return sharedAudioCtx;
}

function ensureSpeakingLoop() {
  if (speakingLoopRunning) return;
  speakingLoopRunning = true;

  const tick = () => {
    if (!speakingAnalysers.size) {
      speakingLoopRunning = false;
      return;
    }

    for (const [peerId, entry] of speakingAnalysers.entries()) {
      const { analyser, data } = entry;
      analyser.getByteFrequencyData(data);
      const volume = data.reduce((a, b) => a + b, 0) / data.length;
      const speaking = volume > 28;
      setParticipantSpeaking(peerId, speaking);
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

function startSpeakingDetection(peerId, stream) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (!stream || !stream.getAudioTracks().length) return;

    if (speakingAnalysers.has(peerId)) return;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    speakingAnalysers.set(peerId, { analyser, data, source: src });

    ensureSpeakingLoop();
  } catch (err) {
    log("Speaking detection failed:", err);
  }
}

function stopAllSpeakingDetection() {
  for (const [, entry] of speakingAnalysers.entries()) {
    try {
      entry.source.disconnect();
    } catch (_) {}
  }
  speakingAnalysers.clear();
  if (sharedAudioCtx) {
    try {
      sharedAudioCtx.close();
    } catch (_) {}
  }
  sharedAudioCtx = null;
  speakingLoopRunning = false;
}

// ============================================================
// LOCAL MEDIA ACQUISITION
// ============================================================
export async function getLocalMedia(wantAudio = true, wantVideo = true) {
  rtcState.audioOnly = wantAudio && !wantVideo;

  const profile = isMobile ? VIDEO_PROFILES.mobile : VIDEO_PROFILES.desktop;

  const constraints = {
    audio: wantAudio ? { ...AUDIO_CONSTRAINTS } : false,
    video: wantVideo
      ? {
          width: profile.width,
          height: profile.height,
          frameRate: profile.frameRate,
          advanced: profile.advanced,
          facingMode: "user",
        }
      : false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    log("Local media acquired:", {
      audio: wantAudio,
      video: wantVideo,
      tracks: stream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
    });
    return stream;
  } catch (err) {
    log("Local media error:", err);
  }

  if (wantAudio) {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { ...AUDIO_CONSTRAINTS },
        video: false,
      });
      log("Audio-only fallback succeeded");
      rtcState.audioOnly = true;
      return audioStream;
    } catch (err) {
      log("Audio-only fallback failed:", err);
    }
  }

  log("Falling back to fake MediaStream (avatar-only mode)");
  const fakeStream = createFakeStream();
  fakeStream._isFake = true;
  rtcState.audioOnly = true;
  return fakeStream;
}

// ============================================================
// FAKE STREAM (avatar-only mode)
// ============================================================
function createFakeStream() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const oscillator = audioCtx.createOscillator();
  const dst = audioCtx.createMediaStreamDestination();
  oscillator.connect(dst);
  oscillator.frequency.value = 0;
  oscillator.start();

  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fakeVideoTrack = canvas.captureStream(1).getVideoTracks()[0];

  const fakeAudioTrack = dst.stream.getAudioTracks()[0];

  return new MediaStream([fakeAudioTrack, fakeVideoTrack]);
}

// ============================================================
// ATTACH LOCAL STREAM (primary + PiP)
// ============================================================
export function attachLocalStream(stream) {
  rtcState.localStream = stream;

  const {
    localVideo,
    localPipVideo,
    localAvatarWrapper,
  } = getDom();

  const hasVideo =
    stream &&
    stream.getVideoTracks &&
    stream.getVideoTracks().length > 0 &&
    stream.getVideoTracks()[0].readyState === "live";

  const bind = (el, muted = true) => {
    if (!el) return;
    try {
      el.srcObject = stream;
      el.muted = muted;
      el.playsInline = true;
      el.setAttribute("autoplay", "true");
      el.classList.add("show");

      const tryPlay = () => el.play().catch(() => {});
      if (el.readyState >= 2) tryPlay();
      else el.onloadedmetadata = tryPlay;
    } catch (err) {
      log("attachLocalStream error:", err);
    }
  };

  if (hasVideo) {
    bind(localVideo, true);
  } else if (localVideo) {
    localVideo.srcObject = null;
    localVideo.classList.remove("show");
  }

  if (hasVideo) {
    bind(localPipVideo, true);
  } else if (localPipVideo) {
    localPipVideo.srcObject = null;
    localPipVideo.classList.remove("show");
  }

  try {
    if (localAvatarWrapper) {
      if (hasVideo) {
        localAvatarWrapper.classList.add("hidden");
      } else {
        localAvatarWrapper.classList.remove("hidden");
      }
    }
  } catch (_) {}
}

// ============================================================
// REMOTE TRACK ROUTING
// ============================================================
export function attachRemoteTrack(peerId, event) {
  if (!event || !event.track) return;

  peerId = String(peerId);
  ensureRemoteStreams();

  // 🔥 Always create or reuse the canonical remote stream FIRST
  let stream = rtcState.remoteStreams[peerId];
  if (!stream) {
    stream = new MediaStream();
    rtcState.remoteStreams[peerId] = stream;
  }

  // 🔥 Ensure the track is added to the canonical stream
  if (!stream.getTracks().includes(event.track)) {
    stream.addTrack(event.track);
  }

  log("attachRemoteTrack:", {
    peerId,
    kind: event.track.kind,
    id: event.track.id,
  });

  const { remoteAudio, remotePipVideo } = getDom();

  // AUDIO
  if (event.track.kind === "audio" && remoteAudio) {
    remoteAudio.srcObject = stream;
    remoteAudio.playsInline = true;
    remoteAudio.removeAttribute("muted");
    remoteAudio.play?.().catch(() => {});
  }

  // 🔥 Attach to RemoteParticipants tile using the SAME stream
  const entry = attachParticipantStream(peerId, stream);
  if (!entry) return;

  const videoEl = entry.videoEl;
  const avatarEl = entry.avatarEl;

  // VIDEO
  if (event.track.kind === "video" && videoEl) {
    videoEl.srcObject = stream;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.play?.().catch(() => {});
    videoEl.classList.add("show");
    avatarEl?.classList.add("hidden");
  }

  // PiP
  if (event.track.kind === "video" && remotePipVideo) {
    remotePipVideo.srcObject = stream;
    remotePipVideo.playsInline = true;
    remotePipVideo.autoplay = true;
    remotePipVideo.play?.().catch(() => {});
  }

  // Speaking detection
  if (event.track.kind === "audio") {
    startSpeakingDetection(peerId, stream);
  }
}


// ============================================================
// SCREEN SHARE
// ============================================================
export async function startScreenShare() {
  if (!navigator.mediaDevices.getDisplayMedia) {
    log("Screen share not supported");
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 2560 },
        height: { ideal: 1080, max: 1440 },
        frameRate: { ideal: 15, max: 30 },
      },
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    return { stream, track };
  } catch (err) {
    log("Screen share error:", err);
    return null;
  }
}

// ============================================================
// UPGRADE TO VIDEO (local)
// ============================================================
export async function upgradeLocalToVideo() {
  const oldStream = rtcState.localStream;

  const newStream = await getLocalMedia(true, true);
  attachLocalStream(newStream);

  if (oldStream) {
    oldStream.getTracks().forEach((t) => t.stop());
  }

  rtcState.audioOnly = false;
  return newStream;
}

// ============================================================
// CLEANUP
// ============================================================
export function cleanupMedia() {
  const stream = rtcState.localStream;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  rtcState.localStream = null;

  ensureRemoteStreams();
  for (const key of Object.keys(rtcState.remoteStreams)) {
    const rs = rtcState.remoteStreams[key];
    if (rs) {
      rs.getTracks().forEach((t) => t.stop());
    }
  }
  rtcState.remoteStreams = {};

  stopAllSpeakingDetection();

  const {
    localVideo,
    localPipVideo,
    remotePipVideo,
    remoteAudio,
  } = getDom();

  if (localVideo) {
    localVideo.srcObject = null;
    localVideo.classList.remove("show");
  }
  if (localPipVideo) {
    localPipVideo.srcObject = null;
    localPipVideo.classList.remove("show");
  }
  if (remotePipVideo) {
    remotePipVideo.srcObject = null;
  }
  if (remoteAudio) {
    remoteAudio.srcObject = null;
  }
}



























