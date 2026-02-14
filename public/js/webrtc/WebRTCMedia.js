// public/js/webrtc/WebRTCMedia.js
import { rtcState } from "./WebRTCState.js";
import {
  attachStream as attachParticipantStream,
  setSpeaking,
} from "./RemoteParticipants.js";

function log(...args) {
  console.log("[WebRTCMedia]", ...args);
}

/* -------------------------------------------------------
   LOCAL MEDIA ACQUISITION
------------------------------------------------------- */
export async function getLocalMedia(wantAudio = true, wantVideo = true) {
  log("getLocalMedia requested with:", { wantAudio, wantVideo });

  const constraints = {
    audio: wantAudio ? { echoCancellation: true, noiseSuppression: true } : false,
    video: wantVideo
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        }
      : false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    log("Local media acquired:", stream);
    return stream;
  } catch (err) {
    log("Local media error:", err);
  }

  // Retry audio-only
  if (wantAudio) {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      log("Audio-only fallback succeeded");
      return audioStream;
    } catch (err) {
      log("Audio-only also failed:", err);
    }
  }

  // Final fallback: fake stream
  log("Falling back to fake MediaStream (avatar-only mode)");
  const fakeStream = createFakeStream();
  fakeStream._isFake = true;
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
------------------------------------------------------- */
export function attachLocalStream(stream) {
  rtcState.localStream = stream;

  const localVideo = document.getElementById("localVideo");
  const pipVideo = document.getElementById("localPipVideo");

  if (localVideo) {
    localVideo.srcObject = stream;
    localVideo.muted = true;
    localVideo.play().catch(() => {});
  }

  if (pipVideo) {
    pipVideo.srcObject = stream;
    pipVideo.muted = true;
    pipVideo.play().catch(() => {});
  }
}

/* -------------------------------------------------------
   REMOTE TRACK ROUTING (CALLED BY WebRTCController)
------------------------------------------------------- */
export function attachRemoteTrack(peerId, event) {
  if (!event || !event.track) {
    log("attachRemoteTrack called without track");
    return;
  }

  peerId = String(peerId);

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
  });

  // AUDIO → attach to #remoteAudio
  if (event.track.kind === "audio") {
    const audioEl = document.getElementById("remoteAudio");
    if (audioEl) {
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {});
    }
  }

  // VIDEO → create/update remote tile
  const entry = attachParticipantStream(peerId, stream);
  if (!entry) {
    log("No participant entry for peer:", peerId);
    return;
  }

  const videoEl = entry.videoEl;
  const avatarEl = entry.avatarEl;

  if (event.track.kind === "video" && videoEl) {
    videoEl.srcObject = stream;
    videoEl.classList.add("show");
    videoEl.play().catch(() => {});
    if (avatarEl) avatarEl.classList.add("hidden");
  }

  // Speaking detection for remote audio
  if (event.track.kind === "audio") {
    startSpeakingDetection(peerId, stream);
  }
}

/* -------------------------------------------------------
   SPEAKING DETECTION
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

      const speaking = volume > 28; // threshold
      setSpeaking(peerId, speaking);

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
        width: { ideal: 1920 },
        height: { ideal: 1080 },
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

/* -------------------------------------------------------
   CLEANUP
------------------------------------------------------- */
export function cleanupMedia() {
  const stream = rtcState.localStream;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }

  rtcState.localStream = null;
  rtcState.remoteStreams = {};
}






















