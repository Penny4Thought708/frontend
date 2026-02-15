// public/js/webrtc/WebRTCMedia.js
// ============================================================
// WebRTCMedia: local media acquisition, attachment, remote routing,
// speaking detection, screen share, and upgrade-to-video helpers.
// Tuned for high quality, mobile-aware constraints, and bitrate hints.
// Group-call ready and aligned with RemoteParticipants + WebRTCController.
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

// Profiles for different device classes / use cases
const VIDEO_PROFILES = {
  mobile: {
    width: { ideal: 960, max: 1280 },
    height: { ideal: 540, max: 720 },
    frameRate: { ideal: 24, max: 30 },
    advanced: [
      { width: 960, height: 540 },
      { frameRate: 24 },
    ],
  },
  desktop: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 60 },
    advanced: [
      { width: 1280, height: 720 },
      { frameRate: 30 },
    ],
  },
};

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function ensureRemoteStreams() {
  if (!rtcState.remoteStreams) {
    rtcState.remoteStreams = {};
  }
}

/* -------------------------------------------------------
   LOCAL MEDIA ACQUISITION (VOICE / VIDEO)
   - Mobile-aware
   - Bitrate-friendly constraints
   - Robust fallbacks
------------------------------------------------------- */
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
        }
      : false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    log("Local media acquired:", {
      audio: wantAudio,
      video: wantVideo,
      tracks: stream.getTracks().map((t) => t.kind),
    });
    return stream;
  } catch (err) {
    log("Local media error (A/V):", err);
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

/* -------------------------------------------------------
   FAKE STREAM (NO DEVICES)
------------------------------------------------------- */
function createFakeStream() {
  const audioCtx = new AudioContext();
  const oscillator = audioCtx.createOscillator();
  const dst = audioCtx.createMediaStreamDestination();
  oscillator.connect(dst);
  oscillator.frequency.value = 0; // effectively silence
  oscillator.start();

  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fakeVideoTrack = canvas.captureStream(1).getVideoTracks()[0];

  const fakeAudioTrack = dst.stream.getAudioTracks()[0];

  const stream = new MediaStream([fakeAudioTrack, fakeVideoTrack]);
  return stream;
}

/* -------------------------------------------------------
   ATTACH LOCAL STREAM TO DOM
   - Main tile + PiP
   - Audio-only vs video state
------------------------------------------------------- */
export function attachLocalStream(stream) {
  rtcState.localStream = stream;

  const localVideo = document.getElementById("localVideo");
  const pipVideo = document.getElementById("localPipVideo");

  if (localVideo) {
    localVideo.srcObject = stream;
    localVideo.muted = true;
    localVideo.playsInline = true;
    localVideo
      .play()
      .catch(() => {
        log("localVideo play blocked (autoplay policy)");
      });

    if (rtcState.audioOnly) {
      localVideo.classList.remove("show");
    } else {
      localVideo.classList.add("show");
    }
  }

  if (pipVideo) {
    pipVideo.srcObject = stream;
    pipVideo.muted = true;
    pipVideo.playsInline = true;
    pipVideo
      .play()
      .catch(() => {
        log("localPipVideo play blocked (autoplay policy)");
      });

    if (rtcState.audioOnly) {
      pipVideo.classList.remove("show");
    } else {
      pipVideo.classList.add("show");
    }
  }
}

/* -------------------------------------------------------
   REMOTE TRACK ROUTING (CALLED BY WebRTCController)
   - Maintains per-peer MediaStream
   - Routes audio to <audio id="remoteAudio">
   - Routes video to RemoteParticipants tiles
   - Starts speaking detection
------------------------------------------------------- */
export function attachRemoteTrack(peerId, event) {
  if (!event || !event.track) {
    log("attachRemoteTrack called without track");
    return;
  }

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
    label: event.track.label,
    id: event.track.id,
  });

  // Remote audio → shared audio element
  if (event.track.kind === "audio") {
    const audioEl = document.getElementById("remoteAudio");
    if (audioEl) {
      audioEl.srcObject = stream;
      audioEl.playsInline = true;
      audioEl
        .play()
        .catch(() => {
          log("remoteAudio play blocked (autoplay policy)");
        });
    }
  }

  // Remote video → participant tile
  const entry = attachParticipantStream(peerId, stream);
  if (!entry) {
    log("No participant entry for peer:", peerId);
    return;
  }

  const videoEl = entry.videoEl;
  const avatarEl = entry.avatarEl;

  if (event.track.kind === "video" && videoEl) {
    videoEl.srcObject = stream;
    videoEl.playsInline = true;
    videoEl
      .play()
      .catch(() => {
        log("remote video play blocked (autoplay policy)");
      });

    videoEl.classList.add("show");
    if (avatarEl) avatarEl.classList.add("hidden");
  }

  if (event.track.kind === "audio") {
    startSpeakingDetection(peerId, stream);
  }
}

/* -------------------------------------------------------
   SPEAKING DETECTION
   - Lightweight analyser
   - Drives voice pulse / active speaker UI
------------------------------------------------------- */
function startSpeakingDetection(peerId, stream) {
  try {
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;

    const src = audioCtx.createMediaStreamSource(stream);
    src.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      const volume = data.reduce((a, b) => a + b, 0) / data.length;

      // Threshold tuned for typical WebRTC levels
      const speaking = volume > 28;
      setParticipantSpeaking(peerId, speaking);

      requestAnimationFrame(tick);
    }
    tick();
  } catch (err) {
    log("Speaking detection failed:", err);
  }
}

/* -------------------------------------------------------
   SCREEN SHARE (simple track replace)
   - High-res desktop, modest frame rate
   - Mobile-safe (if supported)
------------------------------------------------------- */
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
        displaySurface: "monitor",
      },
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    log("Screen share started:", {
      trackId: track?.id,
      settings: track?.getSettings?.(),
    });

    return { stream, track };
  } catch (err) {
    log("Screen share error:", err);
    return null;
  }
}

/* -------------------------------------------------------
   UPGRADE TO VIDEO (LOCAL)
   - Replaces audio-only local stream with A/V
   - Stops old tracks
------------------------------------------------------- */
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

/* -------------------------------------------------------
   CLEANUP
------------------------------------------------------- */
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


















