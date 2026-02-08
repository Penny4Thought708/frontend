// public/js/webrtc/CallUI.js
// Aurora‑Orbit Call UI — modern, modular, multi‑party ready

import { openVoicemailRecorder } from "../voicemail-recorder.js";

import {
  initRemoteParticipants,
  clearAllParticipants,
  setParticipantSpeaking,
  setParticipantCameraOff,
  promoteToStage,
  demoteStage,
} from "./RemoteParticipants.js";

export function initCallUI(rtc) {
  if (!rtc) {
    console.warn("[CallUI] No RTC controller provided");
    return;
  }

  /* -------------------------------------------------------
     DOM ELEMENTS
  ------------------------------------------------------- */

  const win              = document.getElementById("videoCallWindow");
  const grid             = document.getElementById("callGrid");

  const localVideo       = document.getElementById("localVideo");
  const remoteAudio      = document.getElementById("remoteAudio");

  const callStatus       = document.getElementById("call-status");
  const callTimerEl      = document.getElementById("call-timer");

  const declineBtn       = document.getElementById("decline-call");
  const answerBtn        = document.getElementById("answer-call");
  const muteBtn          = document.getElementById("mute-call");
  const cameraBtn        = document.getElementById("camera-toggle");
  const endBtn           = document.getElementById("end-call");

  const shareBtn         = document.getElementById("share-screen");
  const noiseBtn         = document.getElementById("ai-noise-toggle");
  const recordBtn        = document.getElementById("record-call");
  const historyBtn       = document.getElementById("call-history-toggle");

  const moreBtn          = document.getElementById("more-controls-btn");
  const moreMenu         = document.getElementById("more-controls-menu");

  const qualityEl        = document.getElementById("call-quality-indicator");
  const debugToggle      = document.getElementById("call-debug-toggle");

  const toastSecondary   = document.getElementById("secondaryIncomingToast");
  const toastUnavailable = document.getElementById("unavailableToast");

  if (!win || !grid) {
    console.warn("[CallUI] Missing core call window elements");
  }

  /* -------------------------------------------------------
     INITIALIZE REMOTE PARTICIPANT SYSTEM
  ------------------------------------------------------- */

  initRemoteParticipants();

  /* -------------------------------------------------------
     WIRE MEDIA ELEMENTS INTO CONTROLLER
  ------------------------------------------------------- */

  rtc.attachMediaElements?.({
    localVideo,
    remoteVideo: null, // remote videos handled per‑participant
    remoteAudio,
  });

  /* -------------------------------------------------------
     TIMER
  ------------------------------------------------------- */

  let timerId = null;
  let callStart = null;

  function startTimer() {
    if (!callTimerEl) return;
    callStart = Date.now();
    if (timerId) clearInterval(timerId);

    timerId = setInterval(() => {
      const diff = Math.floor((Date.now() - callStart) / 1000);
      const m = String(Math.floor(diff / 60)).padStart(2, "0");
      const s = String(diff % 60).padStart(2, "0");
      callTimerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    if (callTimerEl) callTimerEl.textContent = "00:00";
  }

  /* -------------------------------------------------------
     UI MODE HELPERS
  ------------------------------------------------------- */

  function setMode(mode) {
    if (!win) return;
    win.classList.remove("inbound-mode", "active-mode");
    if (mode === "inbound") win.classList.add("inbound-mode");
    if (mode === "active")  win.classList.add("active-mode");
  }

  function setStatus(text) {
    if (!callStatus) return;
    callStatus.textContent = text || "";
  }

  function setVoiceOnly(on) {
    if (!win) return;
    const isOn = !!on;
    win.classList.toggle("voice-only", isOn);

    // In voice mode, visually de‑emphasize camera/screen share
    if (cameraBtn) {
      cameraBtn.classList.toggle("hidden-soft", isOn);
    }
    if (shareBtn) {
      shareBtn.classList.toggle("hidden-soft", isOn);
    }
  }

  function setCameraOff(on) {
    if (!win) return;
    win.classList.toggle("camera-off", !!on);
  }

  function setScreenShare(on) {
    if (!win) return;
    win.classList.toggle("screen-share", !!on);
  }

  function setNoiseSuppression(on) {
    if (!noiseBtn) return;
    noiseBtn.classList.toggle("active", !!on);
  }

  function setQuality(level, info) {
    if (!qualityEl) return;
    const labels = {
      excellent: "Excellent",
      good:      "Good",
      fair:      "Fair",
      poor:      "Poor",
      bad:       "Bad",
      unknown:   "Unknown",
    };
    qualityEl.textContent = labels[level] || "Unknown";
    qualityEl.dataset.level = level || "unknown";
    qualityEl.title = info || "";
  }

  /* -------------------------------------------------------
     TOAST HELPERS
  ------------------------------------------------------- */

  function showToast(el) {
    if (!el) return;
    el.classList.remove("hidden");
    requestAnimationFrame(() => el.classList.add("open"));
  }

  function hideToast(el) {
    if (!el) return;
    el.classList.remove("open");
    setTimeout(() => el.classList.add("hidden"), 250);
  }

  function showSecondaryIncomingToastInternal({ fromName, audioOnly }) {
    if (!toastSecondary) return;

    const msg    = toastSecondary.querySelector(".sit-message");
    const ignore = toastSecondary.querySelector(".sit-ignore");
    const sw     = toastSecondary.querySelector(".sit-switch");

    if (msg) {
      msg.textContent = `${fromName} is calling you (${audioOnly ? "voice" : "video"})`;
    }

    if (ignore) {
      ignore.onclick = () => hideToast(toastSecondary);
    }

    if (sw) {
      sw.onclick = () => {
        hideToast(toastSecondary);
        rtc.endCall?.(true);
      };
    }

    showToast(toastSecondary);
  }

  function showUnavailableToastInternal({ peerId, message }) {
    if (!toastUnavailable) return;

    const msgEl   = toastUnavailable.querySelector(".ut-message");
    const voice   = document.getElementById("utVoiceBtn");
    const video   = document.getElementById("utVideoBtn");
    const textBtn = document.getElementById("utTextBtn");

    if (msgEl) {
      msgEl.textContent = message || "User unavailable";
    }

    if (voice) {
      voice.onclick = () => {
        hideToast(toastUnavailable);
        openVoicemailRecorder?.(peerId);
      };
    }

    if (video) {
      video.onclick = () => hideToast(toastUnavailable);
    }

    if (textBtn) {
      textBtn.onclick = () => {
        hideToast(toastUnavailable);
        window.showMessageWindow?.();
      };
    }

    showToast(toastUnavailable);
  }

  /* -------------------------------------------------------
     DEBUG PANEL (CALL LOG)
  ------------------------------------------------------- */

  const debugPanel = (() => {
    const el = document.createElement("div");
    el.id = "call-debug-overlay";
    el.style.position = "fixed";
    el.style.bottom = "10px";
    el.style.right = "10px";
    el.style.width = "280px";
    el.style.maxHeight = "220px";
    el.style.overflowY = "auto";
    el.style.background = "rgba(0,0,0,0.85)";
    el.style.color = "#fff";
    el.style.fontSize = "11px";
    el.style.padding = "8px";
    el.style.borderRadius = "6px";
    el.style.zIndex = "9999";
    el.style.display = "none";
    el.innerHTML = "<strong>Call Debug</strong><br/>";
    document.body.appendChild(el);
    return el;
  })();

  if (debugToggle) {
    debugToggle.onclick = () => {
      debugPanel.style.display =
        debugPanel.style.display === "none" ? "block" : "none";
    };
  }

  function debug(msg) {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.textContent = `[${time}] ${msg}`;
    debugPanel.appendChild(line);
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }

  /* -------------------------------------------------------
     BUTTON BINDINGS
  ------------------------------------------------------- */

  if (declineBtn) {
    declineBtn.onclick = () => {
      setStatus("Declining…");
      rtc.declineIncomingCall?.();
    };
  }

  if (answerBtn) {
    answerBtn.onclick = () => {
      setStatus("Answering…");
      setMode("active");
      rtc.answerIncomingCall?.();
    };
  }

  if (endBtn) {
    endBtn.onclick = () => {
      setStatus("Call ended");
      rtc.endCall?.(true);
    };
  }

  if (muteBtn) {
    muteBtn.onclick = () => {
      const muted = rtc.toggleMute?.();
      muteBtn.innerHTML = muted
        ? `<span class="material-symbols-outlined">mic_off</span>`
        : `<span class="material-symbols-outlined">mic</span>`;
    };
  }

  if (cameraBtn) {
    cameraBtn.onclick = () => {
      // Controller exposes switchCamera() in your current code
      const off = rtc.switchCamera?.();
      cameraBtn.classList.toggle("flipped", !!off);
      cameraBtn.innerHTML = off
        ? `<span class="material-symbols-outlined">videocam_off</span>`
        : `<span class="material-symbols-outlined">videocam</span>`;
      setCameraOff(off);
    };
  }

  if (shareBtn) {
    shareBtn.onclick = () => rtc.startScreenShare?.();
  }

  if (noiseBtn) {
    noiseBtn.onclick = () => {
      const enabled = rtc.toggleNoiseSuppression?.();
      setNoiseSuppression(enabled);
    };
  }

  if (recordBtn) {
    recordBtn.onclick = () => {
      const active = rtc.toggleRecording?.();
      recordBtn.classList.toggle("active", !!active);
    };
  }

  if (historyBtn) {
    historyBtn.onclick = () => window.toggleCallHistoryPanel?.();
  }

  if (moreBtn && moreMenu) {
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      moreMenu.classList.toggle("hidden");
    };

    document.addEventListener("click", (e) => {
      if (!moreMenu.contains(e.target) && e.target !== moreBtn) {
        moreMenu.classList.add("hidden");
      }
    });
  }

  /* -------------------------------------------------------
     RTC EVENT WIRING (GROUP‑READY)
  ------------------------------------------------------- */

  rtc.onIncomingCall = ({ fromName, audioOnly }) => {
    const kind = audioOnly ? "voice" : "video";

    debug(`Incoming ${kind} call from ${fromName}`);

    setStatus(`Incoming ${kind} call…`);
    setVoiceOnly(audioOnly);
    setMode("inbound");

    win?.classList.remove("hidden");
  };

  rtc.onOutgoingCall = ({ targetName, voiceOnly }) => {
    const kind = voiceOnly ? "voice" : "video";

    debug(`Placing ${kind} call to ${targetName || "user"}`);

    setStatus(`Calling (${kind})…`);
    setVoiceOnly(voiceOnly);
    setMode("active");

    win?.classList.remove("hidden");
  };

  rtc.onCallConnected = () => {
    debug("Call connected");
    setStatus("In call");
    startTimer();
    setMode("active");
  };

  rtc.onCallEnded = () => {
    debug("Call ended");
    stopTimer();
    setStatus("Call ended");
    setMode(null);
    clearAllParticipants();
    demoteStage();
    win?.classList.add("hidden");
  };

  rtc.onCallFailed = (reason) => {
    debug(`Call failed: ${reason}`);
    stopTimer();
    setStatus(`Call failed: ${reason}`);
    setMode(null);
    clearAllParticipants();
    demoteStage();
    win?.classList.add("hidden");
  };

  rtc.onRemoteMuted = () => debug("Remote muted");
  rtc.onRemoteUnmuted = () => debug("Remote unmuted");

  rtc.onRemoteCameraOff = (peerId) => setParticipantCameraOff(peerId, true);
  rtc.onRemoteCameraOn  = (peerId) => setParticipantCameraOff(peerId, false);

  rtc.onRemoteSpeaking = ({ peerId, active, level }) => {
    setParticipantSpeaking(peerId, active, level);
  };

  rtc.onNetworkQuality = (level, info) => {
    debug(`Network: ${level} (${info})`);
    setQuality(level, info);
  };

  rtc.onScreenShareStarted = (peerId) => {
    setScreenShare(true);
    promoteToStage?.(peerId);
  };

  rtc.onScreenShareStopped = (peerId) => {
    setScreenShare(false);
    demoteStage?.(peerId);
  };

  rtc.onNoiseSuppressionChanged = (enabled) =>
    setNoiseSuppression(enabled);

  rtc.onRecordingChanged = ({ active }) =>
    recordBtn?.classList.toggle("active", !!active);

  rtc.onVoicemailPrompt = (data) =>
    showUnavailableToastInternal(data);

  rtc.onSecondaryIncomingCall = (data) =>
    showSecondaryIncomingToastInternal(data);

  console.log("[CallUI] Initialized");
}

/* -------------------------------------------------------
   WebRTC Debug Overlay (stats from controller)
------------------------------------------------------- */

(function createWebRTCDebugOverlay() {
  const panel = document.createElement("div");
  panel.id = "webrtc-debug-overlay";
  panel.style.position = "fixed";
  panel.style.bottom = "20px";
  panel.style.right = "20px";
  panel.style.width = "260px";
  panel.style.maxHeight = "60vh";
  panel.style.overflowY = "auto";
  panel.style.background = "rgba(0,0,0,0.75)";
  panel.style.color = "#0f0";
  panel.style.fontFamily = "monospace";
  panel.style.fontSize = "12px";
  panel.style.padding = "10px 12px";
  panel.style.borderRadius = "8px";
  panel.style.zIndex = "999999";
  panel.style.whiteSpace = "pre-line";
  panel.style.pointerEvents = "auto";
  panel.style.userSelect = "text";
  panel.style.backdropFilter = "blur(6px)";
  panel.style.border = "1px solid rgba(0,255,0,0.3)";
  panel.style.boxShadow = "0 0 12px rgba(0,255,0,0.2)";
  panel.innerHTML = "WebRTC Debug Overlay\n----------------------\nInitializing…";

  document.body.appendChild(panel);

  window._webrtcDebugUpdate = function (data) {
    const {
      iceState,
      connState,
      signalingState,
      bitrate,
      codec,
      localVideo,
      remoteVideo,
      screenShare,
      muted,
      cameraOff,
      sessionId,
    } = data;

    panel.innerHTML =
      `WebRTC Debug Overlay\n` +
      `----------------------\n` +
      `Session: ${sessionId || "none"}\n\n` +
      `ICE State: ${iceState}\n` +
      `Conn State: ${connState}\n` +
      `Signal State: ${signalingState}\n\n` +
      `Bitrate: ${bitrate || "?"} kbps\n` +
      `Codec: ${codec || "?"}\n\n` +
      `Local Video: ${localVideo ? "ON" : "OFF"}\n` +
      `Remote Video: ${remoteVideo ? "ON" : "OFF"}\n` +
      `Screen Share: ${screenShare ? "ACTIVE" : "OFF"}\n` +
      `Muted: ${muted ? "YES" : "NO"}\n` +
      `Camera Off: ${cameraOff ? "YES" : "NO"}\n`;
  };
})();


























