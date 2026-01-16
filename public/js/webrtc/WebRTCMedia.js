// public/js/webrtc/WebRTCMedia.js
// High‑end media handling: local/remote streams, avatar fallback,
// audio visualization, and speaking detection.

import { rtcState } from "./WebRTCState.js";
import {
  localVideo,
  remoteVideo,
  remoteAudioEl,
} from "../session.js";

/* -------------------------------------------------------
   Path normalization helpers
------------------------------------------------------- */

/**
 * Normalize a backend avatar value into a full, web-accessible URL.
 * Accepts:
 *  - null/undefined → default avatar
 *  - relative filename (e.g. "avatar_x.jpg")
 *  - relative path (e.g. "uploads/avatars/avatar_x.jpg")
 *  - absolute "/NewApp/..." paths
 *  - full http/https URLs
 */
function normalizeAvatarPath(path) {
  if (!path) return "/NewApp/img/defaultUser.png";

  // Full URL
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  // Already app-rooted
  if (path.startsWith("/NewApp/")) {
    return path;
  }

  // Leading slash but missing /NewApp/
  if (path.startsWith("/uploads/avatars/")) {
    return `/NewApp${path}`;
  }

  // Missing slash but includes uploads/avatars
  if (path.includes("uploads/avatars/")) {
    return `/NewApp/${path.replace(/^\//, "")}`;
  }

  // Bare filename
  return `/NewApp/uploads/avatars/${path}`;
}


/* -------------------------------------------------------
   Remote Avatar (Call UI)
------------------------------------------------------- */

/**
 * Update the remote avatar image in the call UI.
 * Falls back to a default placeholder.
 */
export function setRemoteAvatar(rawUrl) {
  const img = document.getElementById("remoteAvatarImg");
  if (!img) return;

  const normalized = normalizeAvatarPath(rawUrl);
  img.src = normalized;
}

/**
 * Toggle visibility between remote avatar and remote video.
 */
function toggleRemoteAvatar(show) {
  const avatar = document.getElementById("remoteAvatar");
  const video = document.getElementById("remoteVideo");
  if (!avatar || !video) return;

  avatar.style.display = show ? "block" : "none";
  video.style.display = show ? "none" : "block";
}

/* -------------------------------------------------------
   Local Avatar Visibility
------------------------------------------------------- */

/**
 * Show local avatar when camera is off or unavailable.
 * Hide it when video is flowing.
 */
function updateLocalAvatarVisibility() {
  const avatar = document.getElementById("localAvatar");
  if (!avatar) return;

  const stream = rtcState.localStream;
  if (!stream) {
    avatar.style.display = "block";
    return;
  }

  const videoTracks = stream.getVideoTracks();
  const hasEnabledVideo = videoTracks.some((t) => t.enabled);

  avatar.style.display = hasEnabledVideo ? "none" : "block";
}

/* -------------------------------------------------------
   Audio Visualizer (CSS variable driven)
------------------------------------------------------- */

/**
 * Attach a real‑time audio visualizer to any element.
 * Updates a CSS variable (--audio-level) for animations.
 */
function attachAudioVisualizer(stream, targetElement, cssVarName = "--audio-level") {
  if (!stream || !targetElement) return;

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      console.warn("[WebRTCMedia] AudioContext not supported");
      return;
    }

    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();

    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }

      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(1, rms * 4);

      targetElement.style.setProperty(cssVarName, level.toString());
      requestAnimationFrame(tick);
    };

    tick();
  } catch (err) {
    console.warn("[WebRTCMedia] Audio visualizer error:", err);
  }
}

/* -------------------------------------------------------
   Remote Speaking Detection (Avatar Ring)
------------------------------------------------------- */

/**
 * Detect remote speaking and toggle a "speaking" class
 * on the avatar ring for visual feedback.
 */
function startRemoteSpeakingDetection(stream, wrapperEl) {
  const ringEl = wrapperEl?.querySelector(".avatar-ring");
  if (!ringEl) return;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    console.warn("[WebRTCMedia] AudioContext not supported for speaking detection");
    return;
  }

  const audioCtx = new AudioCtx();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;

  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let level = 0;

  const loop = () => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;

    level = 0.8 * level + 0.2 * avg;
    ringEl.classList.toggle("speaking", level > 0.06);

    requestAnimationFrame(loop);
  };

  loop();
}

/* -------------------------------------------------------
   Local Media Acquisition
------------------------------------------------------- */

/**
 * Request local audio/video.
 * Handles avatar fallback, video preview, and visualizer.
 */
export async function getLocalMedia(audio = true, video = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn("[WebRTCMedia] getUserMedia not supported");
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
    rtcState.localStream = stream;

    // Attach local video preview
    if (stream.getVideoTracks().length > 0 && localVideo) {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      await localVideo.play().catch(() => {});
    }

    updateLocalAvatarVisibility();

    const wrapper = localVideo?.closest(".local-media-wrapper");
    if (wrapper) attachAudioVisualizer(stream, wrapper);

    return stream;
  } catch (err) {
    console.warn("[WebRTCMedia] Local media error:", err);
    rtcState.localStream = null;

    // Show avatar when no camera/mic available
    const avatar = document.getElementById("localAvatar");
    if (avatar) avatar.style.display = "block";

    return null;
  }
}

/* -------------------------------------------------------
   Remote Track Handling
------------------------------------------------------- */

/**
 * Attach incoming remote audio/video tracks.
 * Handles avatar fallback, speaking detection, and visualizer.
 */
export function attachRemoteTrack(evt) {
  const remoteStream = rtcState.remoteStream || new MediaStream();
  rtcState.remoteStream = remoteStream;
  remoteStream.addTrack(evt.track);

  const wrapper =
    remoteVideo.closest(".remote-media-wrapper") ||
    remoteAudioEl.closest(".remote-media-wrapper");

  // Always show avatar until video is confirmed playing
  toggleRemoteAvatar(true);

  // VIDEO TRACK
  if (evt.track.kind === "video") {
    remoteVideo.srcObject = remoteStream;

    remoteVideo.onloadedmetadata = () => {
      remoteVideo.play().catch(() => {});
      toggleRemoteAvatar(false);
    };

    evt.track.onended = () => {
      toggleRemoteAvatar(true);
    };
  }

  // AUDIO TRACK
  if (evt.track.kind === "audio") {
    remoteAudioEl.srcObject = remoteStream;
    remoteAudioEl.play().catch(() => {});

    if (wrapper) startRemoteSpeakingDetection(remoteStream, wrapper);
  }

  // Audio-reactive border for remote wrapper
  if (wrapper) attachAudioVisualizer(remoteStream, wrapper);
}

/* -------------------------------------------------------
   Public Helper: Refresh Local Avatar
------------------------------------------------------- */
export function refreshLocalAvatarVisibility() {
  updateLocalAvatarVisibility();
}
