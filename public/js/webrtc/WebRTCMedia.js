// public/js/webrtc/WebRTCMedia.js
// Production‑grade media engine for the new call window:
//  - Local/remote media wiring
//  - Audio visualization + speaking detection
//  - Voice‑only + camera‑off avatar behavior
//  - Fake tracks when devices are missing (stable PC, avatar‑only)
//
// Layout is owned by CallUI.js. This file NEVER changes layout structure.

import { rtcState } from "./WebRTCState.js";
import {
  attachStream as attachParticipantStream,
} from "./RemoteParticipants.js";

/* -------------------------------------------------------
   Shared AudioContext (Safari‑safe, mobile‑safe)
------------------------------------------------------- */
let sharedAudioCtx = null;

function getAudioCtx() {
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      sharedAudioCtx = new Ctx();
    } catch {
      sharedAudioCtx = null;
    }
  }
  return sharedAudioCtx;
}

/* -------------------------------------------------------
   Logging Helper
------------------------------------------------------- */
const log = (...args) => console.log("[WebRTCMedia]", ...args);

/* -------------------------------------------------------
   Local Avatar Visibility (class-based, no layout logic)
------------------------------------------------------- */
function updateLocalAvatarVisibility() {
  const localTile = document.getElementById("localParticipant");
  if (!localTile) return;

  const avatarWrapper = localTile.querySelector(".avatar-wrapper");
  const videoEl = localTile.querySelector("video");
  if (!avatarWrapper) return;

  const stream = rtcState.localStream;

  if (rtcState.voiceOnly || rtcState.audioOnly || !stream) {
    avatarWrapper.classList.remove("hidden");
    if (videoEl) videoEl.classList.remove("show");
    return;
  }

  const hasVideoTrack =
    stream.getVideoTracks &&
    stream.getVideoTracks().some(
      (t) => t.enabled && t.readyState === "live"
    );

  avatarWrapper.classList.toggle("hidden", !!hasVideoTrack);
  if (videoEl) videoEl.classList.toggle("show", !!hasVideoTrack);
}

/* -------------------------------------------------------
   Audio Visualizer (CSS variable --audio-level)
------------------------------------------------------- */
function attachAudioVisualizer(stream, target, cssVar = "--audio-level") {
  if (!stream || !target) return;

  const ctx = getAudioCtx();
  if (!ctx) {
    log("AudioContext not supported for visualizer");
    return;
  }

  let src;
  try {
    src = ctx.createMediaStreamSource(stream);
  } catch (err) {
    log("Visualizer source error:", err);
    return;
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;

  const buf = new Uint8Array(analyser.frequencyBinCount);
  src.connect(analyser);

  let stopped = false;

  const tick = () => {
    if (stopped) return;

    try {
      analyser.getByteTimeDomainData(buf);
    } catch (err) {
      log("Visualizer analyser error:", err);
      return;
    }

    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }

    const rms = Math.sqrt(sum / buf.length);
    const factor = rtcState.voiceOnly ? 5 : 4;
    const level = Math.min(1, rms * factor);

    try {
      target.style.setProperty(cssVar, level.toFixed(3));
    } catch {}

    requestAnimationFrame(tick);
  };

  tick();

  stream.getTracks().forEach((t) => {
    t.addEventListener("ended", () => {
      stopped = true;
      try {
        target.style.removeProperty(cssVar);
      } catch {}
    });
  });
}

/* -------------------------------------------------------
   Remote Speaking Detection (no layout, just .speaking)
------------------------------------------------------- */
const speakingLoops = new Map(); // key: participantEl -> rAF id

function startRemoteSpeakingDetection(stream, participantEl) {
  if (!participantEl || !stream) return;

  const ctx = getAudioCtx();
  if (!ctx) {
    log("AudioContext not supported for speaking detection");
    return;
  }

  let src;
  try {
    src = ctx.createMediaStreamSource(stream);
  } catch (err) {
    log("Speaking detection source error:", err);
    return;
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  src.connect(analyser);

  const buf = new Uint8Array(analyser.frequencyBinCount);
  let smoothed = 0;
  let stopped = false;

  const loop = () => {
    if (stopped) return;

    try {
      analyser.getByteFrequencyData(buf);
    } catch (err) {
      log("Speaking detection analyser error:", err);
      return;
    }

    const avg = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
    smoothed = smoothed * 0.8 + avg * 0.2;

    const threshold = rtcState.voiceOnly ? 0.035 : 0.055;
    const speaking = smoothed > threshold;

    participantEl.classList.toggle("speaking", speaking);

    const id = requestAnimationFrame(loop);
    speakingLoops.set(participantEl, id);
  };

  loop();

  stream.getTracks().forEach((t) => {
    t.addEventListener("ended", () => {
      stopped = true;
      participantEl.classList.remove("speaking");
      const id = speakingLoops.get(participantEl);
      if (id) cancelAnimationFrame(id);
      speakingLoops.delete(participantEl);
    });
  });
}

export function stopSpeakingDetection() {
  for (const [el, id] of speakingLoops.entries()) {
    cancelAnimationFrame(id);
    el.classList.remove("speaking");
  }
  speakingLoops.clear();
}

/* -------------------------------------------------------
   Fake MediaStream (when devices are missing)
------------------------------------------------------- */
function createFakeMediaStream() {
  const stream = new MediaStream();

  try {
    const ctx = getAudioCtx();
    if (ctx) {
      const osc = ctx.createOscillator();
      const dst = ctx.createMediaStreamDestination();
      osc.frequency.value = 0;
      osc.connect(dst);
      osc.start();
      const audioTrack = dst.stream.getAudioTracks()[0];
      if (audioTrack) {
        stream.addTrack(audioTrack);
      }
    }
  } catch (err) {
    log("Fake audio track creation failed:", err);
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx2d = canvas.getContext("2d");
    if (ctx2d) {
      ctx2d.fillStyle = "#000000";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    }
    const vStream = canvas.captureStream(1);
    const videoTrack = vStream.getVideoTracks()[0];
    if (videoTrack) {
      stream.addTrack(videoTrack);
    }
  } catch (err) {
    log("Fake video track creation failed:", err);
  }

  const audioCount = stream.getAudioTracks().length;
  const videoCount = stream.getVideoTracks().length;

  log("Created fake media stream with tracks:", {
    audio: audioCount,
    video: videoCount,
  });

  stream._isFake = true;

  return stream;
}

/* -------------------------------------------------------
   Local Media Acquisition
------------------------------------------------------- */
export async function getLocalMedia(audio = true, video = true) {
  audio = !!audio;
  video = !!video;

  if (!navigator.mediaDevices?.getUserMedia) {
    log("getUserMedia not supported — using fake stream fallback");
    const fake = createFakeMediaStream();
    rtcState.localStream = fake;
    rtcState.voiceOnly = audio && !video;
    rtcState.audioOnly = audio && !video;
    updateLocalAvatarVisibility();
    return fake;
  }

  rtcState.voiceOnly = audio && !video;
  rtcState.audioOnly = audio && !video;

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

    if (
      video &&
      audio &&
      (err.name === "NotFoundError" || err.name === "OverconstrainedError")
    ) {
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

    log("Falling back to fake MediaStream (avatar-only mode, but stable PC)");
    const fake = createFakeMediaStream();
    rtcState.localStream = fake;
    rtcState.voiceOnly = true;
    rtcState.audioOnly = true;

    updateLocalAvatarVisibility();
    return fake;
  }
}

/* -------------------------------------------------------
   CAMERA FLIP SUPPORT (front/back)
------------------------------------------------------- */
rtcState.cameraFacing = rtcState.cameraFacing || "user"; // "user" | "environment"

export async function flipLocalCamera(rtc) {
  try {
    if (!rtc) {
      log("flipLocalCamera: rtc not provided");
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      log("flipLocalCamera: getUserMedia not supported");
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
   Remote Track Handling
------------------------------------------------------- */
export function attachRemoteTrack(peerOrEvt, maybeEvt) {
  console.log("[attachRemoteTrack] called with", { peerOrEvt, maybeEvt });
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

  if (!remoteStream.getTracks().includes(evt.track)) {
    remoteStream.addTrack(evt.track);
  }

  log("attachRemoteTrack:", {
    peerId,
    kind: evt.track.kind,
    label: evt.track.label,
    readyState: evt.track.readyState,
  });

  const remoteAudioEl = document.getElementById("remoteAudio");

  if (evt.track.kind === "audio" && remoteAudioEl) {
    log("Attaching remote AUDIO to #remoteAudio for peer:", peerId);

    remoteAudioEl.srcObject = remoteStream;
    remoteAudioEl.playsInline = true;
    remoteAudioEl.muted = false;
    remoteAudioEl.volume = 1;

    remoteAudioEl.play().catch(() => {
      log("Remote audio autoplay blocked — waiting for user gesture");

      const unlock = () => {
        remoteAudioEl.play().catch(() => {});
        window.removeEventListener("click", unlock);
        window.removeEventListener("touchstart", unlock);
      };

      window.addEventListener("click", unlock, { once: true });
      window.addEventListener("touchstart", unlock, { once: true });
    });
  }

  const entry = attachParticipantStream(peerId, remoteStream);
  if (!entry || !entry.el) {
    log("No participant entry for peer:", peerId);
    return;
  }

  const participantEl = entry.el;
  const videoEl = entry.videoEl;
  const avatarWrapper = entry.avatarEl;

  if (evt.track.kind === "video" && videoEl) {
    videoEl.srcObject = remoteStream;
    videoEl.play().catch(() => {});
  }

  const showAvatar = (show) => {
    if (avatarWrapper) avatarWrapper.classList.toggle("hidden", !show);
    if (videoEl) videoEl.classList.toggle("show", !show);
  };

  evt.track.onmute = () => showAvatar(true);
  evt.track.onunmute = () => showAvatar(false);
  evt.track.onended = () => showAvatar(true);

  if (evt.track.kind === "audio" && remoteAudioEl) {
    startRemoteSpeakingDetection(remoteStream, participantEl);
    attachAudioVisualizer(remoteStream, participantEl);
  }
}

/* -------------------------------------------------------
   Helper: resume remote media after user gesture
------------------------------------------------------- */
export function resumeRemoteMediaPlayback(retries = 10) {
  const remoteAudioEl = document.getElementById("remoteAudio");

  if (!remoteAudioEl) return;
  if (!remoteAudioEl.srcObject) {
    if (retries > 0) {
      setTimeout(() => resumeRemoteMediaPlayback(retries - 1), 150);
    }
    return;
  }

  try {
    remoteAudioEl.muted = false;
    if (remoteAudioEl.volume === 0) remoteAudioEl.volume = 1;
    remoteAudioEl.playsInline = true;

    remoteAudioEl
      .play()
      .catch((err) =>
        console.warn("[resumeRemoteMediaPlayback] audio play blocked:", err)
      );
  } catch (err) {
    console.warn("[resumeRemoteMediaPlayback] audio error:", err);
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
    localVideo.classList.remove("show");
  }

  const grid = document.getElementById("callGrid");
  if (grid) {
    const participants = grid.querySelectorAll(".participant");
    participants.forEach((p) => {
      const videoEl = p.querySelector("video");
      const avatarWrapper = p.querySelector(".avatar-wrapper");
      if (videoEl) {
        videoEl.srcObject = null;
        videoEl.classList.remove("show");
      }
      if (avatarWrapper) {
        avatarWrapper.classList.remove("hidden");
      }
      p.classList.remove("speaking");
      p.style.removeProperty("--audio-level");
    });
  }

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
















