// public/js/webrtc/WebRTCMedia.js
// ============================================================
// Media acquisition, local/remote stream routing, PiP wiring,
// speaking detection, screen share, and cleanup.
//
// Layout (who is primary, who is PiP, snap, swap, etc.) is
// owned entirely by CallUI.js. This file ONLY:
//   - gets local media
//   - routes local stream to localVideo + localPipVideo
//   - routes remote streams to tiles + remotePipVideo + remoteAudio
//   - runs speaking detection
//   - handles screen share + upgrade + cleanup
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
   LOCAL MEDIA ACQUISITION
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
          facingMode: "user",
        }
      : false,
  };

  log("Requesting local media with constraints:", constraints);

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    log("Local media acquired:", {
      audio: wantAudio,
      video: wantVideo,
      tracks: stream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
    });
    rtcState.cameraOff = !wantVideo;
    rtcState.micMuted = !wantAudio;
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
      rtcState.cameraOff = true;
      rtcState.micMuted = false;
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
  rtcState.cameraOff = true;
  rtcState.micMuted = true;
  return fakeStream;
}

/* -------------------------------------------------------
   FAKE STREAM (NO DEVICES)
------------------------------------------------------- */
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

/* -------------------------------------------------------
   ATTACH LOCAL STREAM
   - Feeds local grid tile video
   - Feeds local PiP video
   - Layout (which is visible) is handled by CallUI
------------------------------------------------------- */
export function attachLocalStream(stream) {
  rtcState.localStream = stream;

  const localVideo = document.getElementById("localVideo");
  const pipVideo = document.getElementById("localPipVideo");

  if (localVideo) {
    try {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.setAttribute("autoplay", "true");
      const tryPlay = () => {
        localVideo
          .play()
          .catch((err) => {
            log("localVideo play blocked:", err?.name || err);
          });
      };
      if (localVideo.readyState >= 2) {
        tryPlay();
      } else {
        localVideo.onloadedmetadata = () => tryPlay();
      }
    } catch (err) {
      log("attachLocalStream: failed to bind localVideo:", err);
    }
  }

  if (pipVideo) {
    try {
      pipVideo.srcObject = stream;
      pipVideo.muted = true;
      pipVideo.playsInline = true;
      pipVideo.setAttribute("autoplay", "true");
      const tryPlayPip = () => {
        pipVideo
          .play()
          .catch((err) => {
            log("localPipVideo play blocked:", err?.name || err);
          });
      };
      if (pipVideo.readyState >= 2) {
        tryPlayPip();
      } else {
        pipVideo.onloadedmetadata = () => tryPlayPip();
      }
    } catch (err) {
      log("attachLocalStream: failed to bind localPipVideo:", err);
    }
  }
}

/* -------------------------------------------------------
   REMOTE TRACK ROUTING
   - Feeds remote tile
   - Feeds remote PiP
   - Feeds shared remote audio element
------------------------------------------------------- */
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
    label: event.track.label,
    id: event.track.id,
  });

  // Remote audio → shared audio element
  if (event.track.kind === "audio") {
    const audioEl = document.getElementById("remoteAudio");
    if (audioEl) {
      try {
        audioEl.srcObject = stream;
        audioEl.playsInline = true;
        audioEl.removeAttribute("muted");
        const tryPlayAudio = () => {
          audioEl
            .play()
            .catch((err) => {
              log("remoteAudio play blocked:", err?.name || err);
            });
        };
        if (audioEl.readyState >= 2) {
          tryPlayAudio();
        } else {
          audioEl.onloadedmetadata = () => tryPlayAudio();
        }
      } catch (err) {
        log("attachRemoteTrack: failed to bind remoteAudio:", err);
      }
    }
  }

  // Remote video → participant tile
  const entry = attachParticipantStream(peerId, stream);
  if (!entry) return;

  const videoEl = entry.videoEl;
  const avatarEl = entry.avatarEl;

  if (event.track.kind === "video" && videoEl) {
    try {
      videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl.setAttribute("autoplay", "true");
      const tryPlayVideo = () => {
        videoEl
          .play()
          .catch((err) => {
            log("remote video play blocked:", err?.name || err);
          });
      };
      if (videoEl.readyState >= 2) {
        tryPlayVideo();
      } else {
        videoEl.onloadedmetadata = () => tryPlayVideo();
      }
      videoEl.classList.add("show");
      if (avatarEl) avatarEl.classList.add("hidden");
    } catch (err) {
      log("attachRemoteTrack: failed to bind remote video tile:", err);
    }
  }

  // Remote video → remote PiP (CallUI decides when to show/hide)
  if (event.track.kind === "video") {
    const remotePipVideo = document.getElementById("remotePipVideo");
    if (remotePipVideo) {
      try {
        remotePipVideo.srcObject = stream;
        remotePipVideo.playsInline = true;
        remotePipVideo.setAttribute("autoplay", "true");
        const tryPlayPip = () => {
          remotePipVideo
            .play()
            .catch((err) => {
              log("remotePipVideo play blocked:", err?.name || err);
            });
        };
        if (remotePipVideo.readyState >= 2) {
          tryPlayPip();
        } else {
          remotePipVideo.onloadedmetadata = () => tryPlayPip();
        }
      } catch (err) {
        log("attachRemoteTrack: failed to bind remotePipVideo:", err);
      }
    }
  }

  // Speaking detection (remote audio)
  if (event.track.kind === "audio") {
    startSpeakingDetection(peerId, stream);
  }
}

/* -------------------------------------------------------
   SPEAKING DETECTION
------------------------------------------------------- */
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

/* -------------------------------------------------------
   SCREEN SHARE
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
   UPGRADE TO VIDEO
------------------------------------------------------- */
export async function upgradeLocalToVideo() {
  const oldStream = rtcState.localStream;

  const newStream = await getLocalMedia(true, true);
  attachLocalStream(newStream);

  if (oldStream) {
    try {
      oldStream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      log("upgradeLocalToVideo: failed to stop old tracks:", err);
    }
  }

  rtcState.audioOnly = false;
  rtcState.cameraOff = false;
  return newStream;
}

/* -------------------------------------------------------
   CLEANUP
------------------------------------------------------- */
export function cleanupMedia() {
  const stream = rtcState.localStream;
  if (stream) {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      log("cleanupMedia: failed to stop local tracks:", err);
    }
  }

  rtcState.localStream = null;

  ensureRemoteStreams();
  for (const key of Object.keys(rtcState.remoteStreams)) {
    const rs = rtcState.remoteStreams[key];
    if (rs) {
      try {
        rs.getTracks().forEach((t) => t.stop());
      } catch (err) {
        log(`cleanupMedia: failed to stop remote tracks for ${key}:`, err);
      }
    }
  }
  rtcState.remoteStreams = {};
}




















