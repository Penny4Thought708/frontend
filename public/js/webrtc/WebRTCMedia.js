// public/js/webrtc/WebRTCMedia.js
// ============================================================
// Modernized Media Engine for the new CallUI
// - Local media acquisition (audio/video)
// - Full-screen local preview support (mobile upgrade flow)
// - Remote track routing into new participant tiles
// - PiP wiring (local + remote)
// - Speaking detection
// - Screen share
// - Cleanup
// ============================================================

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

function ensureRemoteStreams() {
  if (!rtcState.remoteStreams) rtcState.remoteStreams = {};
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

  // Fallback: audio-only
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

  // Final fallback: fake stream (avatar-only mode)
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

  const localVideo = document.getElementById("localVideo");
  const pipVideo = document.getElementById("localPipVideo");
  const localAvatarWrapper = document
    .getElementById("localAvatarImg")
    ?.closest(".avatar-wrapper");

  const bind = (el) => {
    if (!el) return;
    try {
      el.srcObject = stream;
      el.muted = true;
      el.playsInline = true;
      el.setAttribute("autoplay", "true");

      // Make sure CSS knows this video should be visible
      el.classList.add("show");

      const tryPlay = () => el.play().catch(() => {});
      if (el.readyState >= 2) tryPlay();
      else el.onloadedmetadata = tryPlay;
    } catch (err) {
      log("attachLocalStream error:", err);
    }
  };

  bind(localVideo);
  bind(pipVideo);

  // Hide local avatar when we have a real video track
  try {
    const hasVideo =
      stream &&
      stream.getVideoTracks &&
      stream.getVideoTracks().length > 0 &&
      stream.getVideoTracks()[0].readyState === "live";

    if (hasVideo && localAvatarWrapper) {
      localAvatarWrapper.classList.add("hidden");
    }
  } catch (e) {
    // non-fatal
  }
}

// ============================================================
// REMOTE TRACK ROUTING
// ============================================================
export function attachRemoteTrack(peerId, event) {
  if (!event || !event.track) return;

  peerId = String(peerId);
  ensureRemoteStreams();

  if (!rtcState.remoteStreams[peerId]) {
    rtcState.remoteStreams[peerId] = new MediaStream();
  }

  const stream = rtcState.remoteStreams[peerId];
  if (!stream.getTracks().includes(event.track)) {
    stream.addTrack(event.track);
  }

  log("attachRemoteTrack:", {
    peerId,
    kind: event.track.kind,
    id: event.track.id,
  });

  // Remote audio → shared audio element
  if (event.track.kind === "audio") {
    const audioEl = document.getElementById("remoteAudio");
    if (audioEl) {
      audioEl.srcObject = stream;
      audioEl.playsInline = true;
      audioEl.removeAttribute("muted");
      const tryPlay = () => audioEl.play().catch(() => {});
      if (audioEl.readyState >= 2) tryPlay();
      else audioEl.onloadedmetadata = tryPlay;
    }
  }

  // Remote video → participant tile
  const entry = attachParticipantStream(peerId, stream);
  if (!entry) return;

  const videoEl = entry.videoEl;
  const avatarEl = entry.avatarEl;

  if (event.track.kind === "video" && videoEl) {
    videoEl.srcObject = stream;
    videoEl.playsInline = true;
    videoEl.setAttribute("autoplay", "true");
    const tryPlay = () => videoEl.play().catch(() => {});
    if (videoEl.readyState >= 2) tryPlay();
    else videoEl.onloadedmetadata = tryPlay;

    videoEl.classList.add("show");
    if (avatarEl) avatarEl.classList.add("hidden");
  }

  // Remote video → PiP
  if (event.track.kind === "video") {
    const pip = document.getElementById("remotePipVideo");
    if (pip) {
      pip.srcObject = stream;
      pip.playsInline = true;
      pip.setAttribute("autoplay", "true");
      const tryPlay = () => pip.play().catch(() => {});
      if (pip.readyState >= 2) tryPlay();
      else pip.onloadedmetadata = tryPlay;
    }
  }

  // Speaking detection
  if (event.track.kind === "audio") {
    startSpeakingDetection(peerId, stream);
  }
}

// ============================================================
// SPEAKING DETECTION
// ============================================================
function startSpeakingDetection(peerId, stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;

    const src = audioCtx.createMediaStreamSource(stream);
    src.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      const volume = data.reduce((a, b) => a + b, 0) / data.length;
      const speaking = volume > 28;
      setParticipantSpeaking(peerId, speaking);
      requestAnimationFrame(tick);
    }
    tick();
  } catch (err) {
    log("Speaking detection failed:", err);
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

  // Acquire new audio+video stream
  const newStream = await getLocalMedia(true, true);
  attachLocalStream(newStream);

  // Stop old tracks
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
}
























