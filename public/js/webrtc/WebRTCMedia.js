// public/js/webrtc/WebRTCMedia.js
// PURE MEDIA ENGINE — no UI, no tile creation, no stage mode.
// CallUI owns the window. RemoteParticipants owns tiles.
// This file handles ONLY:
// - local media acquisition
// - remote track aggregation per peer
// - speaking detection
// - audio visualization
// - cleanup

import { rtcState } from "./WebRTCState.js";

const log = (...args) => console.log("[WebRTCMedia]", ...args);

/* -------------------------------------------------------
   Shared AudioContext
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
   Audio Visualizer (CSS variable --audio-level)
------------------------------------------------------- */
export function attachAudioVisualizer(stream, target, cssVar = "--audio-level") {
  if (!stream || !target) return;

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
   Speaking Detection (remote, DOM-agnostic)
   - caller passes the participant tile element
   - we only toggle .speaking and CSS var
------------------------------------------------------- */
const speakingLoops = new Map();

export function startRemoteSpeakingDetection(stream, participantEl) {
  if (!stream || !participantEl) return;

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
    const speaking = smoothed > 0.055;

    participantEl.classList.toggle("speaking", speaking);
    participantEl.style.setProperty(
      "--audio-level",
      speaking ? smoothed.toFixed(3) : "0"
    );

    const id = requestAnimationFrame(loop);
    speakingLoops.set(participantEl, id);
  };

  loop();
}

export function stopSpeakingDetection() {
  for (const [el, id] of speakingLoops.entries()) {
    cancelAnimationFrame(id);
    el.classList.remove("speaking");
    el.style.removeProperty("--audio-level");
  }
  speakingLoops.clear();
}

/* -------------------------------------------------------
   Local Media Acquisition
   - audio: echoCancellation + NS + AGC
   - video: 1280x720@30 ideal
------------------------------------------------------- */
export async function getLocalMedia(audio = true, video = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("getUserMedia not supported");
    const empty = new MediaStream();
    rtcState.localStream = empty;
    return empty;
  }

  const constraints = {
    audio: audio
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      : false,
    video: video
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        }
      : false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    rtcState.localStream = stream;
    return stream;
  } catch (err) {
    log("Local media error:", err);

    // Fallback: audio-only if full A/V fails
    if (video && audio) {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        rtcState.localStream = audioOnly;
        return audioOnly;
      } catch (err2) {
        log("Audio-only fallback failed:", err2);
      }
    }

    const empty = new MediaStream();
    rtcState.localStream = empty;
    return empty;
  }
}

/* -------------------------------------------------------
   Remote Track Handling (NO UI)
   - Aggregates tracks per peer into rtcState.remoteStreams[peerId]
   - Returns the MediaStream for controller / tiles to bind
------------------------------------------------------- */
export function attachRemoteTrack(peerId = "default", evt) {
  if (!evt || !evt.track) return null;

  if (!rtcState.remoteStreams) rtcState.remoteStreams = {};
  let remoteStream = rtcState.remoteStreams[peerId];

  if (!remoteStream) {
    remoteStream = new MediaStream();
    rtcState.remoteStreams[peerId] = remoteStream;
  }

  remoteStream.addTrack(evt.track);

  log("Remote track attached:", {
    peerId,
    kind: evt.track.kind,
    label: evt.track.label,
    readyState: evt.track.readyState,
  });

  return remoteStream;
}

/* -------------------------------------------------------
   Cleanup (on call end)
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

  log("Media cleaned up");
}

