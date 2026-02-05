// public/js/webrtc/CallUI.js
// Premium call UI wiring: buttons, status, overlays, quality, and advanced visual states.

export function initCallUI(rtc) {
  if (!rtc) {
    console.warn("[CallUI] No RTC controller provided");
    return;
  }

  /* -------------------------------------------------------
     Core elements
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

  // Optional external quality indicator element
  const qualityEl        = document.getElementById("call-quality-indicator");
  const debugToggle      = document.getElementById("call-debug-toggle");

  // Attach media to controller (safe even if some are null)
  rtc.attachMediaElements?.({ localVideo, remoteVideo, remoteAudio });

  /* -------------------------------------------------------
     Call timer
  ------------------------------------------------------- */

  let callStart = null;
  let timerId   = null;

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
     Status / quality helpers
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

  setStatus("Ready");
  setQuality("unknown", "No active call");

  /* -------------------------------------------------------
     Container mode helpers (CSS class toggles)
  ------------------------------------------------------- */

  function setContainerClass(flag, className) {
    if (!container) return;
    container.classList.toggle(className, !!flag);
  }

  function setVoiceOnlyMode(on) {
    setContainerClass(on, "voice-only");
  }

  function setScreenShareMode(on) {
    setContainerClass(on, "screen-share");
    if (screenShareInd) screenShareInd.style.display = on ? "flex" : "none";
  }

  function setBlurBgMode(on) {
    setContainerClass(on, "blur-bg");
  }

  function setCameraOff(on) {
    setContainerClass(on, "camera-off");
    if (camOffPlaceholder) camOffPlaceholder.style.display = on ? "flex" : "none";
    if (camOffBadge) camOffBadge.style.display = on ? "flex" : "none";
    if (remoteVideo) remoteVideo.style.display = on ? "none" : "block";
  }

  function setAINoiseSuppression(on) {
    setContainerClass(on, "ai-noise");
    if (aiNoiseInd) aiNoiseInd.style.display = on ? "flex" : "none";
  }

  function setNetworkQuality(level, info) {
    setQuality(level || "unknown", info);
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
    container?.classList.add("show-network");
  }

  function setRemoteMuted(on) {
    if (micMutedBadge) micMutedBadge.style.display = on ? "flex" : "none";
  }

  function setRemoteSpeaking(on) {
    if (voiceGlow) voiceGlow.style.opacity = on ? "1" : "0";
    if (micLevelRing) micLevelRing.style.display = on ? "block" : "none";
  }

  /* -------------------------------------------------------
     Incoming overlay helpers
  ------------------------------------------------------- */

  function showIncoming(fromName) {
    if (!callerOverlay) return;
    callerOverlay.style.display = "flex";
    callerOverlay.textContent = fromName
      ? `Incoming call from ${fromName}…`
      : "Incoming call…";
  }

  function showConnecting(targetName) {
    if (!callerOverlay) return;
    callerOverlay.style.display = "flex";
    callerOverlay.textContent = targetName
      ? `Connecting to ${targetName}…`
      : "Connecting…";
    setContainerClass(true, "connecting");
  }

  function showVoicemailPrompt() {
    if (!callerOverlay) return;
    callerOverlay.style.display = "flex";
    callerOverlay.textContent = "Leave a voicemail…";
  }

  function hideOverlay() {
    if (!callerOverlay) return;
    callerOverlay.style.display = "none";
    callerOverlay.textContent = "";
    setContainerClass(false, "connecting");
  }

  /* -------------------------------------------------------
     Debug overlay
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
    if (!debugPanel) return;
    const time = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.textContent = `[${time}] ${msg}`;
    debugPanel.appendChild(line);
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }

  debugToggle?.addEventListener("click", () => {
    if (!debugPanel) return;
    debugPanel.style.display =
      debugPanel.style.display === "none" ? "block" : "none";
  });

  /* -------------------------------------------------------
     Draggable local preview
  ------------------------------------------------------- */

  if (localWrapper) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;

    const onDown = (e) => {
      dragging = true;
      localWrapper.classList.add("dragging");
      const rect = localWrapper.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX - rect.left;
      startY = clientY - rect.top;
      offsetX = rect.left;
      offsetY = rect.top;
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
      if (!dragging) return;
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
     Auto-hide controls
  ------------------------------------------------------- */

  let controlsTimeout = null;

  function scheduleHideControls() {
    if (!container) return;
    if (!container.classList.contains("auto-hide")) return;
    container.classList.add("active-controls");
    if (controlsTimeout) clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      container.classList.remove("active-controls");
    }, 2500);
  }

  container?.addEventListener("mousemove", scheduleHideControls);
  container?.addEventListener("touchstart", scheduleHideControls);

  /* -------------------------------------------------------
     Button bindings
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
    if (typeof rtc.toggleMute !== "function") {
      logDebug("toggleMute() not implemented on rtc");
      return;
    }
    const muted = rtc.toggleMute();
    muteBtn.textContent = muted ? "🔈 Unmute" : "🔇 Mute";
    muteBtn.dataset.muted = String(muted);
    logDebug(`Mute toggled: ${muted}`);
  });

  cameraToggle?.addEventListener("click", () => {
    if (typeof rtc.switchCamera === "function") {
      rtc.switchCamera();
      logDebug("Camera toggle clicked");
    } else {
      logDebug("switchCamera() not implemented on rtc");
    }
  });

  /* -------------------------------------------------------
     Hook into rtc events (optional, if provided)
  ------------------------------------------------------- */

  // Incoming call
  rtc.onIncomingCall?.(({ fromName, video, voiceOnly } = {}) => {
    logDebug(`Incoming call from ${fromName || "Unknown"}`);
    setStatus("Incoming call…");
    showIncoming(fromName);
    setVoiceOnlyMode(!!voiceOnly && !video);
    setScreenShareMode(false);
  });

  // Outgoing call
  rtc.onOutgoingCall?.(({ targetName, video, voiceOnly } = {}) => {
    logDebug(`Outgoing call to ${targetName || "Unknown"}`);
    setStatus("Calling…");
    showConnecting(targetName);
    setVoiceOnlyMode(!!voiceOnly && !video);
    setScreenShareMode(false);
  });

  // Call connected
  rtc.onCallConnected?.(() => {
    logDebug("Call connected");
    hideOverlay();
    setStatus("In call");
    startTimer();
    if (container) container.classList.remove("hidden");
  });

  // Call ended
  rtc.onCallEnded?.(() => {
    logDebug("Call ended (event)");
    hideOverlay();
    setStatus("Call ended");
    stopTimer();
    setRemoteMuted(false);
    setRemoteSpeaking(false);
    setScreenShareMode(false);
    setCameraOff(false);
    setAINoiseSuppression(false);
    if (container) container.classList.add("hidden");
  });

  // Call failed
  rtc.onCallFailed?.((reason) => {
    logDebug(`Call failed: ${reason || "Unknown"}`);
    hideOverlay();
    setStatus(`Call failed: ${reason || "Unknown"}`);
    stopTimer();
    if (container) container.classList.add("hidden");
  });

  // Remote mute/unmute
  rtc.onRemoteMuted?.(() => {
    logDebug("Remote muted");
    setRemoteMuted(true);
  });

  rtc.onRemoteUnmuted?.(() => {
    logDebug("Remote unmuted");
    setRemoteMuted(false);
  });

  // Remote camera off/on
  rtc.onRemoteCameraOff?.(() => {
    logDebug("Remote camera off");
    setCameraOff(true);
  });

  rtc.onRemoteCameraOn?.(() => {
    logDebug("Remote camera on");
    setCameraOff(false);
  });

  // Remote speaking
  rtc.onRemoteSpeaking?.((active) => {
    setRemoteSpeaking(!!active);
  });

  // Network quality
  rtc.onNetworkQuality?.((level, info) => {
    logDebug(`Network quality: ${level} (${info || ""})`);
    setNetworkQuality(level, info);
  });

  // Screen share
  rtc.onScreenShareStarted?.(() => {
    logDebug("Screen share started");
    setScreenShareMode(true);
  });

  rtc.onScreenShareStopped?.(() => {
    logDebug("Screen share stopped");
    setScreenShareMode(false);
  });

  // AI noise suppression
  rtc.onNoiseSuppressionChanged?.((enabled) => {
    logDebug(`AI noise suppression: ${enabled}`);
    setAINoiseSuppression(!!enabled);
  });

  // Voicemail prompt (if you support it)
  rtc.onVoicemailPrompt?.(() => {
    logDebug("Voicemail prompt");
    showVoicemailPrompt();
  });

  logDebug("CallUI initialized");
}


