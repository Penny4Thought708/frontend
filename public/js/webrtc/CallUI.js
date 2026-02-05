// public/js/webrtc/CallUI.js
// Aurora‑Prime Call UI — full modern rewrite

export function initCallUI(rtc) {
  if (!rtc) {
    console.warn("[CallUI] No RTC controller provided");
    return;
  }

  /* -------------------------------------------------------
     DOM ELEMENTS
  ------------------------------------------------------- */

  const container        = document.getElementById("video-container");
  const remoteWrapper    = document.getElementById("remoteWrapper");
  const localWrapper     = document.getElementById("localVideoWrapper");

  const voiceBtn         = document.getElementById("voiceBtn");
  const videoBtn         = document.getElementById("videoBtn");

  const declineBtn       = document.getElementById("decline-call");
  const answerBtn        = document.getElementById("answer-call");
  const muteBtn          = document.getElementById("mute-call");
  const cameraToggle     = document.getElementById("camera-toggle");
  const endCallBtn       = document.getElementById("end-call");

  const callStatus       = document.getElementById("call-status");
  const callerOverlay    = document.getElementById("callerOverlay");
  const callTimerEl      = document.getElementById("call-timer");

  const localVideo       = document.getElementById("localVideo");
  const remoteVideo      = document.getElementById("remoteVideo");
  const remoteAudio      = document.getElementById("remoteAudio");

  const screenShareInd   = remoteWrapper?.querySelector(".screen-share-indicator");
  const aiNoiseInd       = remoteWrapper?.querySelector(".ai-noise-indicator");
  const networkInd       = remoteWrapper?.querySelector(".network-indicator");
  const micMutedBadge    = remoteWrapper?.querySelector(".badge-mic-muted");
  const camOffBadge      = remoteWrapper?.querySelector(".badge-camera-off");
  const camOffPlaceholder= remoteWrapper?.querySelector(".camera-off-placeholder");
  const voiceGlow        = remoteWrapper?.querySelector(".voice-glow");
  const micLevelRing     = remoteWrapper?.querySelector(".mic-level-ring");

  const qualityEl        = document.getElementById("call-quality-indicator");
  const debugToggle      = document.getElementById("call-debug-toggle");
  const shareScreenBtn    = document.getElementById("share-screen");
  const aiNoiseToggleBtn  = document.getElementById("ai-noise-toggle");
  const recordCallBtn     = document.getElementById("record-call");
  const callHistoryBtn    = document.getElementById("call-history-toggle");

  rtc.attachMediaElements?.({ localVideo, remoteVideo, remoteAudio });

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
      callTimerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    callTimerEl.textContent = "00:00";
  }

  /* -------------------------------------------------------
     STATUS + QUALITY
  ------------------------------------------------------- */

  function setStatus(text) {
    callStatus.textContent = text || "";
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
    qualityEl.dataset.level = level;
    qualityEl.title = info || "";
  }

  /* -------------------------------------------------------
     CSS MODE TOGGLES
  ------------------------------------------------------- */

  function toggleClass(flag, cls) {
    container.classList.toggle(cls, !!flag);
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
    camOffPlaceholder.style.display = on ? "flex" : "none";
    camOffBadge.style.display = on ? "flex" : "none";
    remoteVideo.style.display = on ? "none" : "block";
  }

  function setAINoiseSuppression(on) {
    toggleClass(on, "ai-noise");
    aiNoiseInd.style.display = on ? "flex" : "none";
  }

  function setNetworkQuality(level, info) {
    setQuality(level, info);

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
    micMutedBadge.style.display = on ? "flex" : "none";
  }

  function setRemoteSpeaking(on) {
    voiceGlow.style.opacity = on ? "1" : "0";
    micLevelRing.style.display = on ? "block" : "none";
  }

  /* -------------------------------------------------------
     OVERLAYS
  ------------------------------------------------------- */

  function showIncoming(name) {
    callerOverlay.style.display = "flex";
    callerOverlay.textContent = name
      ? `Incoming call from ${name}…`
      : "Incoming call…";
  }

  function showConnecting(name) {
    callerOverlay.style.display = "flex";
    callerOverlay.textContent = name
      ? `Connecting to ${name}…`
      : "Connecting…";
    toggleClass(true, "connecting");
  }

  function showVoicemailPrompt() {
    callerOverlay.style.display = "flex";
    callerOverlay.textContent = "Leave a voicemail…";
  }

  function hideOverlay() {
    callerOverlay.style.display = "none";
    callerOverlay.textContent = "";
    toggleClass(false, "connecting");
  }

  /* -------------------------------------------------------
     DEBUG PANEL
  ------------------------------------------------------- */

  const debugPanel = (() => {
    const existing = document.getElementById("call-debug-overlay");
    if (existing) return existing;

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
    el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
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
  rtc.startVideoCall?.();
});

answerBtn?.addEventListener("click", () => {
  setStatus("Answering call…");
  logDebug("Answer clicked");
  hideOverlay();
  rtc.answerIncomingCall?.();
});

declineBtn?.addEventListener("click", () => {
  setStatus("Declining call…");
  logDebug("Decline clicked");
  hideOverlay();
  rtc.declineIncomingCall?.();
});

endCallBtn?.addEventListener("click", () => {
  setStatus("Call ended");
  logDebug("End call clicked");
  stopTimer();
  rtc.endCall?.(true);
});

muteBtn?.addEventListener("click", () => {
  const muted = rtc.toggleMute?.();
  muteBtn.textContent = muted ? "🔈 Unmute" : "🔇 Mute";
  muteBtn.dataset.muted = String(muted);
  logDebug(`Mute toggled: ${muted}`);
});

cameraToggle?.addEventListener("click", () => {
  rtc.switchCamera?.();
  logDebug("Camera toggle clicked");
});

// Share screen
shareScreenBtn?.addEventListener("click", () => {
  logDebug("Share screen clicked");
  rtc.startScreenShare?.();
});

// AI noise suppression
aiNoiseToggleBtn?.addEventListener("click", () => {
  logDebug("AI noise toggle clicked");
  rtc.toggleNoiseSuppression?.();
});

// Recording
recordCallBtn?.addEventListener("click", () => {
  logDebug("Record call clicked");
  const active = rtc.toggleRecording?.();
  recordCallBtn.classList.toggle("active", !!active);
});

// Call history
callHistoryBtn?.addEventListener("click", () => {
  logDebug("Call history toggle clicked");
  if (window.toggleCallHistoryPanel) {
    window.toggleCallHistoryPanel();
  }
});


/* -------------------------------------------------------
   RTC EVENT WIRING
------------------------------------------------------- */

rtc.onIncomingCall = ({ fromName, audioOnly }) => {
  logDebug(`Incoming call from ${fromName}`);
  setStatus("Incoming call…");
  showIncoming(fromName);
  setVoiceOnlyMode(audioOnly);
  setScreenShareMode(false);
  container.classList.remove("hidden");
};

rtc.onOutgoingCall = ({ targetName, video, voiceOnly }) => {
  logDebug(`Outgoing call to ${targetName}`);
  setStatus("Calling…");
  showConnecting(targetName);
  setVoiceOnlyMode(voiceOnly);
  setScreenShareMode(false);
  container.classList.remove("hidden");
};

rtc.onCallConnected = () => {
  logDebug("Call connected");
  hideOverlay();
  setStatus("In call");
  startTimer();
  container.classList.remove("hidden");
};

rtc.onCallEnded = () => {
  logDebug("Call ended");
  hideOverlay();
  setStatus("Call ended");
  stopTimer();
  setRemoteMuted(false);
  setRemoteSpeaking(false);
  setScreenShareMode(false);
  setCameraOff(false);
  setAINoiseSuppression(false);
  container.classList.add("hidden");
};

rtc.onCallFailed = (reason) => {
  logDebug(`Call failed: ${reason}`);
  hideOverlay();
  setStatus(`Call failed: ${reason}`);
  stopTimer();
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
  setRemoteSpeaking(active);
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
  setAINoiseSuppression(enabled);
};

rtc.onRecordingChanged = (active) => {
  logDebug(`Recording state changed: ${active}`);
  recordCallBtn.classList.toggle("active", !!active);
};

rtc.onVoicemailPrompt = ({ peerId, message } = {}) => {
  logDebug(`Voicemail prompt: ${message}`);

  // Hide the call container immediately
  container.classList.add("hidden");

  // Show the new toast instead of the old voicemail prompt
  showUnavailableToast({
    peerId,
    message
  });
};




  logDebug("CallUI initialized");
}
export function showUnavailableToast({ peerId }) {
  const toast = document.getElementById("unavailableToast");
  const voiceBtn = document.getElementById("utVoiceBtn");
  const videoBtn = document.getElementById("utVideoBtn");
  const textBtn = document.getElementById("utTextBtn");

  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("open"), 10);

  // Voice message
  voiceBtn.onclick = () => {
    toast.classList.remove("open");
    setTimeout(() => toast.classList.add("hidden"), 300);
    openVoicemailRecorder(peerId);
  };

  // Video message (you can wire this later)
  videoBtn.onclick = () => {
    toast.classList.remove("open");
    setTimeout(() => toast.classList.add("hidden"), 300);
    // openVideoMessageRecorder(peerId);
  };

  // Text message
  textBtn.onclick = () => {
    toast.classList.remove("open");
    setTimeout(() => toast.classList.add("hidden"), 300);
    showMessageWindow(); // your existing function
  };
}









