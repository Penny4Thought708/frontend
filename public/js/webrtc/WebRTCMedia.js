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

// public/js/webrtc/WebRTCMedia.js
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

const VIDEO_PROFILES = {
  mobile: {
    width: { ideal: 960, max: 1280 },
    height: { ideal: 540, max: 720 },
    frameRate: { ideal: 24, max: 30 },
  },
  desktop: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 60 },
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
          facingMode: "user",
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

function createFakeStream() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

export function attachLocalStream(stream) {
  rtcState.localStream = stream;

  const localVideo = document.getElementById("localVideo");
  const pipVideo = document.getElementById("localPipVideo");

  if (localVideo) {
    try {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo
        .play()
        .catch((err) => {
          log("localVideo play blocked:", err?.name || err);
        });
    } catch (err) {
      log("attachLocalStream: failed to bind localVideo:", err);
    }
  }

  if (pipVideo) {
    try {
      pipVideo.srcObject = stream;
      pipVideo.muted = true;
      pipVideo.playsInline = true;
      pipVideo
        .play()
        .catch((err) => {
          log("localPipVideo play blocked:", err?.name || err);
        });
    } catch (err) {
      log("attachLocalStream: failed to bind localPipVideo:", err);
    }
  }
}

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

  if (event.track.kind === "audio") {
    const audioEl = document.getElementById("remoteAudio");
    if (audioEl) {
      try {
        audioEl.srcObject = stream;
        audioEl
          .play()
          .catch((err) => {
            log("remoteAudio play blocked:", err?.name || err);
          });
      } catch (err) {
        log("attachRemoteTrack: failed to bind remoteAudio:", err);
      }
    }
  }

  const entry = attachParticipantStream(peerId, stream);
  if (!entry) return;

  const videoEl = entry.videoEl;
  const avatarEl = entry.avatarEl;

  if (event.track.kind === "video" && videoEl) {
    try {
      videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl
        .play()
        .catch((err) => {
          log("remote video play blocked:", err?.name || err);
        });
      videoEl.classList.add("show");
      if (avatarEl) avatarEl.classList.add("hidden");
    } catch (err) {
      log("attachRemoteTrack: failed to bind remote video tile:", err);
    }
  }

  if (event.track.kind === "video") {
    const remotePipVideo = document.getElementById("remotePipVideo");
    if (remotePipVideo) {
      try {
        remotePipVideo.srcObject = stream;
        remotePipVideo.playsInline = true;
        remotePipVideo
          .play()
          .catch((err) => {
            log("remotePipVideo play blocked:", err?.name || err);
          });
      } catch (err) {
        log("attachRemoteTrack: failed to bind remotePipVideo:", err);
      }
    }
  }

  if (event.track.kind === "audio") {
    startSpeakingDetection(peerId, stream);
  }
}

function startSpeakingDetection(peerId, stream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

export function cleanupMedia() {
  const stream = rtcState.localStream;
  if (stream) {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {}
  }

  rtcState.localStream = null;

  ensureRemoteStreams();
  for (const key of Object.keys(rtcState.remoteStreams)) {
    const rs = rtcState.remoteStreams[key];
    if (rs) {
      try {
        rs.getTracks().forEach((t) => t.stop());
      } catch {}
    }
  }
  rtcState.remoteStreams = {};
}



















