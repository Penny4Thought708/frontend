// public/js/webrtc/CallUI.js
// Aurora‑Prime Call UI — rewritten for updated WebRTCController + WebRTCMedia

import { openVoicemailRecorder } from "../voicemail-recorder.js";

export function initCallUI(rtc) {
  if (!rtc) {
    console.warn("[CallUI] No RTC controller provided");
    return;
  }

  /* -------------------------------------------------------
     DOM ELEMENTS
  ------------------------------------------------------- */

  const container         = document.getElementById("videoCallWindow");

  const remoteWrapper     = document.getElementById("remoteWrapper");
  const localWrapper      = document.getElementById("localVideoWrapper");

  const voiceBtn          = document.getElementById("voiceBtn");
  const videoBtn          = document.getElementById("videoBtn");

  const declineBtn        = document.getElementById("decline-call");
  const answerBtn         = document.getElementById("answer-call");
  const muteBtn           = document.getElementById("mute-call");
  const cameraToggle      = document.getElementById("camera-toggle");
  const endCallBtn        = document.getElementById("end-call");

  const callStatus        = document.getElementById("call-status");
  const callTimerEl       = document.getElementById("call-timer");

  const localVideo        = document.getElementById("localVideo");
  const remoteAudio       = document.getElementById("remoteAudio");

  const screenShareInd    = remoteWrapper?.querySelector(".screen-share-indicator");
  const aiNoiseInd        = remoteWrapper?.querySelector(".ai-noise-indicator");
  const networkInd        = remoteWrapper?.querySelector(".network-indicator");
  const micMutedBadge     = remoteWrapper?.querySelector(".badge-mic-muted");
  const camOffBadge       = remoteWrapper?.querySelector(".badge-camera-off");
  const camOffPlaceholder = remoteWrapper?.querySelector(".camera-off-placeholder");
  const voiceGlow         = remoteWrapper?.querySelector(".voice-glow");
  const micLevelRing      = remoteWrapper?.querySelector(".mic-level-ring");

  const qualityEl         = document.getElementById("call-quality-indicator");
  const debugToggle       = document.getElementById("call-debug-toggle");
  const shareScreenBtn    = document.getElementById("share-screen");
  const aiNoiseToggleBtn  = document.getElementById("ai-noise-toggle");
  const recordCallBtn     = document.getElementById("record-call");
  const callHistoryBtn    = document.getElementById("call-history-toggle");

  const moreBtn           = document.getElementById("more-controls-btn");
  const moreMenu          = document.getElementById("more-controls-menu");

  if (!container) {
    console.warn("[CallUI] videoCallWindow not found; aborting init");
    return;
  }

  rtc.attachMediaElements?.({ localVideo, remoteVideo: null, remoteAudio });

  /* -------------------------------------------------------
     TIMER
  ------------------------------------------------------- */

  let timerId = null;
  let callStart = null;

  function startTimer() {
    callStart = Date.now();
    if (timerId) clearInterval(timerId);

    timerId = setInterval(() => {
      const diff = Math.floor((Date.now() - callStart) / 1000);
      const m = String(Math.floor(diff / 60)).padStart(2, "0");
      const s = String(diff % 60).padStart(2, "0");
      if (callTimerEl) callTimerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    if (callTimerEl) callTimerEl.textContent = "00:00";
  }

  /* -------------------------------------------------------
     STATUS + QUALITY
  ------------------------------------------------------- */

  function setStatus(text) {
    if (callStatus) callStatus.textContent = text || "";
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
     CSS MODE TOGGLES
  ------------------------------------------------------- */

  function toggleClass(flag, cls) {
    container.classList.toggle(cls, !!flag);
  }

  function setCallMode(mode) {
    container.classList.remove("inbound-mode", "active-mode");
    if (mode === "inbound") container.classList.add("inbound-mode");
    if (mode === "active")  container.classList.add("active-mode");
  }

  function setVoiceOnlyMode(on) {
    toggleClass(on, "voice-only");
  }

  function setScreenShareMode(on) {
    toggleClass(on, "screen-share");
    if (screenShareInd) screenShareInd.style.display = on ? "flex" : "none";
  }

  function setCameraOff(on) {
    toggleClass(on, "camera-off");
    if (camOffPlaceholder) camOffPlaceholder.style.display = on ? "flex" : "none";
    if (camOffBadge) camOffBadge.style.display = on ? "flex" : "none";
  }

  function setAINoiseSuppression(on) {
    toggleClass(on, "ai-noise");
    if (aiNoiseInd) aiNoiseInd.style.display = on ? "flex" : "none";
  }

  function setNetworkQuality(level, info) {
    setQuality(level, info);
    if (!networkInd) return;

    networkInd.classList.remove("network-good", "network-medium", "network-poor");

    if (level === "excellent" || level === "good") {
      networkInd.classList.add("network-good");
      networkInd.textContent = "Good Connection";
    } else if (level === "fair") {
      networkInd.classList.add("network-medium");
      networkInd.textContent = "Fair Connection";
    } else if (level === "poor" || level === "bad") {
      networkInd.classList.add("network-poor");
      networkInd.textContent = "Poor Connection";
    } else {
      networkInd.textContent = "Unknown";
    }

    container.classList.add("show-network");
  }

  function setRemoteMuted(on) {
    if (micMutedBadge) micMutedBadge.style.display = on ? "flex" : "none";
  }

  function setRemoteSpeaking(on) {
    if (voiceGlow) voiceGlow.style.opacity = on ? "1" : "0";
    if (micLevelRing) micLevelRing.style.display = on ? "block" : "none";
  }

  /* -------------------------------------------------------
     SIMPLE OVERLAY
  ------------------------------------------------------- */

  function showIncoming(name) {
    setStatus(name ? `Incoming call from ${name}…` : "Incoming call…");
  }

  function showConnecting(name) {
    setStatus(name ? `Connecting to ${name}…` : "Connecting…");
  }

  /* -------------------------------------------------------
     DEBUG PANEL
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

  function logDebug(msg) {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.textContent = `[${time}] ${msg}`;
    debugPanel.appendChild(line);
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }

  debugToggle?.addEventListener("click", () => {
    debugPanel.style.display =
      debugPanel.style.display === "none" ? "block" : "none";
  });

  /* -------------------------------------------------------
     DRAGGABLE LOCAL PREVIEW
  ------------------------------------------------------- */

  if (localWrapper) {
    let dragging = false;
    let startX = 0;
    let startY = 0;

    const onDown = (e) => {
      dragging = true;
      localWrapper.classList.add("dragging");
      const rect = localWrapper.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX - rect.left;
      startY = clientY - rect.top;
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const x = clientX - startX;
      const y = clientY - startY;
      localWrapper.style.left = `${x}px`;
      localWrapper.style.top = `${y}px`;
      localWrapper.style.right = "auto";
      localWrapper.style.bottom = "auto";
    };

    const onUp = () => {
      dragging = false;
      localWrapper.classList.remove("dragging");
    };

    localWrapper.addEventListener("mousedown", onDown);
    localWrapper.addEventListener("touchstart", onDown, { passive: false });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
  }

  /* -------------------------------------------------------
     AUTO-HIDE CONTROLS
  ------------------------------------------------------- */

  let controlsTimeout = null;

  function scheduleHideControls() {
    if (!container.classList.contains("auto-hide")) return;
    container.classList.add("active-controls");
    if (controlsTimeout) clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      container.classList.remove("active-controls");
    }, 2500);
  }

  container.addEventListener("mousemove", scheduleHideControls);
  container.addEventListener("touchstart", scheduleHideControls);

  /* -------------------------------------------------------
     DROPDOWN MENU
  ------------------------------------------------------- */

  if (moreBtn && moreMenu) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      moreMenu.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!moreMenu.contains(e.target) && e.target !== moreBtn) {
        moreMenu.classList.add("hidden");
      }
    });
  }

  /* -------------------------------------------------------
     BUTTON BINDINGS
  ------------------------------------------------------- */

  voiceBtn?.addEventListener("click", () => {
    setStatus("Starting voice call…");
    logDebug("Voice call clicked");
    setVoiceOnlyMode(true);
    setScreenShareMode(false);
    rtc.startVoiceCall?.();
  });

  videoBtn?.addEventListener("click", () => {
    setStatus("Starting video call…");
    logDebug("Video call clicked");
    setVoiceOnlyMode(false);
    setScreenShareMode(false);
    rtc.startVideoCall?.();
  });

  answerBtn?.addEventListener("click", () => {
    setStatus("Answering call…");
    logDebug("Answer clicked");
    setCallMode("active");
    rtc.answerIncomingCall?.();
  });

  declineBtn?.addEventListener("click", () => {
    setStatus("Declining call…");
    logDebug("Decline clicked");
    setCallMode(null);
    rtc.declineIncomingCall?.();
  });

  endCallBtn?.addEventListener("click", () => {
    setStatus("Call ended");
    logDebug("End call clicked");
    stopTimer();
    setCallMode(null);
    rtc.endCall?.(true);
  });

  muteBtn?.addEventListener("click", () => {
    const muted = rtc.toggleMute?.();
    if (muteBtn && typeof muted === "boolean") {
      muteBtn.innerHTML = muted
        ? `<span class="material-symbols-outlined">mic_off</span>`
        : `<span class="material-symbols-outlined">mic</span>`;
      muteBtn.dataset.muted = String(muted);
    }
    logDebug(`Mute toggled: ${muted}`);
  });

  cameraToggle?.addEventListener("click", () => {
    const off = rtc.toggleCamera?.();
    if (typeof off === "boolean") {
      cameraToggle.classList.toggle("flipped", !!off);
      cameraToggle.innerHTML = off
        ? `<span class="material-symbols-outlined">videocam_off</span>`
        : `<span class="material-symbols-outlined">videocam</span>`;
      setCameraOff(off);
    }
    logDebug("Camera toggle clicked");
  });

  shareScreenBtn?.addEventListener("click", () => {
    logDebug("Share screen clicked");
    rtc.startScreenShare?.();
  });

  aiNoiseToggleBtn?.addEventListener("click", () => {
    logDebug("AI noise toggle clicked");
    const enabled = rtc.toggleNoiseSuppression?.();
    setAINoiseSuppression(enabled);
  });

  recordCallBtn?.addEventListener("click", () => {
    logDebug("Record call clicked");
    const active = rtc.toggleRecording?.();
    recordCallBtn?.classList.toggle("active", !!active);
  });

  callHistoryBtn?.addEventListener("click", () => {
    logDebug("Call history toggle clicked");
    window.toggleCallHistoryPanel?.();
  });

  /* -------------------------------------------------------
     RTC EVENT WIRING
  ------------------------------------------------------- */

  rtc.onIncomingCall = ({ fromName, audioOnly }) => {
    logDebug(`Incoming call from ${fromName}`);
    setStatus("Incoming call…");
    showIncoming(fromName);
    setVoiceOnlyMode(!!audioOnly);
    setScreenShareMode(false);
    setCallMode("inbound");
    container.classList.remove("hidden");
  };

  rtc.onOutgoingCall = ({ targetName, video, voiceOnly }) => {
    logDebug(`Outgoing call to ${targetName}`);
    setStatus("Calling…");
    showConnecting(targetName);
    setVoiceOnlyMode(!!voiceOnly);
    setScreenShareMode(false);
    setCallMode("active");
    container.classList.remove("hidden");
  };

  rtc.onCallConnected = () => {
    logDebug("Call connected");
    setStatus("In call");
    startTimer();
    setCallMode("active");
    container.classList.remove("hidden");
  };

  rtc.onCallEnded = () => {
    logDebug("Call ended");
    setStatus("Call ended");
    stopTimer();
    setRemoteMuted(false);
    setRemoteSpeaking(false);
    setScreenShareMode(false);
    setCameraOff(false);
    setAINoiseSuppression(false);
    setCallMode(null);
    container.classList.add("hidden");
  };

  rtc.onCallFailed = (reason) => {
    logDebug(`Call failed: ${reason}`);
    setStatus(`Call failed: ${reason}`);
    stopTimer();
    setCallMode(null);
    container.classList.add("hidden");
  };

  rtc.onRemoteMuted = () => {
    logDebug("Remote muted");
    setRemoteMuted(true);
  };

  rtc.onRemoteUnmuted = () => {
    logDebug("Remote unmuted");
    setRemoteMuted(false);
  };

  rtc.onRemoteCameraOff = () => {
    logDebug("Remote camera off");
    setCameraOff(true);
  };

  rtc.onRemoteCameraOn = () => {
    logDebug("Remote camera on");
    setCameraOff(false);
  };

  rtc.onRemoteSpeaking = (active) => {
    setRemoteSpeaking(!!active);
  };

  rtc.onNetworkQuality = (level, info) => {
    logDebug(`Network quality: ${level} (${info || ""})`);
    setNetworkQuality(level, info);
  };

  rtc.onScreenShareStarted = () => {
    logDebug("Screen share started");
    setScreenShareMode(true);
  };

  rtc.onScreenShareStopped = () => {
    logDebug("Screen share stopped");
    setScreenShareMode(false);
  };

  rtc.onNoiseSuppressionChanged = (enabled) => {
    logDebug(`AI noise suppression: ${enabled}`);
    setAINoiseSuppression(!!enabled);
  };

  rtc.onRecordingChanged = ({ active }) => {
    logDebug(`Recording state changed: ${active}`);
    recordCallBtn?.classList.toggle("active", !!active);
  };

  rtc.onVoicemailPrompt = ({ peerId, message } = {}) => {
    logDebug(`Voicemail prompt: ${message || ""}`);
    container.classList.add("hidden");
    showUnavailableToast({ peerId, message });
  };

  rtc.onSecondaryIncomingCall = ({ fromName, audioOnly }) => {
    logDebug(`Secondary incoming call from ${fromName}`);
    showSecondaryIncomingToast(fromName, audioOnly);
  };

  logDebug("CallUI initialized");
}

/* -------------------------------------------------------
   UNAVAILABLE TOAST
------------------------------------------------------- */

export function showUnavailableToast({ peerId, message }) {
  const toast    = document.getElementById("unavailableToast");
  const voiceBtn = document.getElementById("utVoiceBtn");
  const videoBtn = document.getElementById("utVideoBtn");
  const textBtn  = document.getElementById("utTextBtn");

  if (!toast || !voiceBtn || !videoBtn || !textBtn) {
    console.warn("[CallUI] Unavailable toast elements missing");
    return;
  }

  if (message) {
    const msgEl = toast.querySelector(".ut-message");
    if (msgEl) msgEl.textContent = message;
  }

  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("open"), 10);

  const closeToast = () => {
    toast.classList.remove("open");
    setTimeout(() => toast.classList.add("hidden"), 300);
  };

  voiceBtn.onclick = () => {
    closeToast();
    openVoicemailRecorder?.(peerId);
  };

  videoBtn.onclick = () => {
    closeToast();
    // openVideoMessageRecorder(peerId); // future hook
  };

  textBtn.onclick = () => {
    closeToast();
    if (window.showMessageWindow) {
      window.showMessageWindow();
    } else {
      console.warn("[CallUI] showMessageWindow is not defined on window");
    }
  };
}

// ------------------------------------------------------
// WebRTC Debug Overlay
// ------------------------------------------------------

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















