// public/js/webrtc/CallUI.js

export function initCallUI(rtc) {
  if (!rtc) {
    console.warn("[CallUI] No RTC controller provided");
    return;
  }

  /* -------------------------------------------------------
     Core elements
  ------------------------------------------------------- */

  // Header buttons (global call entrypoints)
  const voiceBtn = document.getElementById("voiceBtn");
  const videoBtn = document.getElementById("videoBtn");

  // Call controls
  const declineBtn   = document.getElementById("decline-call");
  const answerBtn    = document.getElementById("answer-call");
  const muteBtn      = document.getElementById("mute-call");
  const cameraToggle = document.getElementById("camera-toggle");
  const endCallBtn   = document.getElementById("end-call");

  // Status + overlay
  const callStatus    = document.getElementById("call-status");
  const callerOverlay = document.getElementById("callerOverlay");

  // Media
  const localVideo  = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");
  const remoteAudio = document.getElementById("remoteAudio");

  // Quality + debug
  const qualityEl   = document.getElementById("call-quality-indicator");
  const debugToggle = document.getElementById("call-debug-toggle");

  // Attach media to controller (safe even if some are null)
  rtc.attachMediaElements({ localVideo, remoteVideo, remoteAudio });

  /* -------------------------------------------------------
     Status / quality helpers
  ------------------------------------------------------- */

  function setStatus(text) {
    if (callStatus) callStatus.textContent = text;
  }

  function setQuality(level, info) {
    if (!qualityEl) return;

    const labels = {
      excellent: "Excellent",
      good: "Good",
      fair: "Fair",
      poor: "Poor",
      bad: "Bad",
      unknown: "Unknown"
    };

    qualityEl.textContent = labels[level] || "Unknown";
    qualityEl.dataset.level = level;
    qualityEl.title = info || "";
  }

  // Initial state
  setStatus("Ready");
  setQuality("unknown", "No active call");

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
    el.style.maxHeight = "200px";
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
     Button bindings
  ------------------------------------------------------- */

  voiceBtn?.addEventListener("click", () => {
    setStatus("Starting voice call...");
    logDebug("Voice call clicked");
    rtc.startVoiceCall();
  });

  videoBtn?.addEventListener("click", () => {
    setStatus("Starting video call...");
    logDebug("Video call clicked");
    rtc.startVideoCall();
  });

  answerBtn?.addEventListener("click", () => {
    setStatus("Answering call...");
    logDebug("Answer clicked");
    rtc.answerIncomingCall();
  });

  declineBtn?.addEventListener("click", () => {
    setStatus("Declining call...");
    logDebug("Decline clicked");
    rtc.declineIncomingCall();
  });

  endCallBtn?.addEventListener("click", () => {
    setStatus("Call ended");
    logDebug("End call clicked");
    rtc.endCall(true);
  });

  muteBtn?.addEventListener("click", () => {
    const muted = rtc.toggleMute?.();
    if (muted !== undefined) {
      muteBtn.textContent = muted ? "🔈 Unmute" : "🔇 Mute";
      logDebug(`Mute toggled: ${muted}`);
    } else {
      logDebug("toggleMute() not implemented on rtc");
    }
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
     Controller event hooks
  ------------------------------------------------------- */

  rtc.onIncomingCall = ({ fromName } = {}) => {
    const name = fromName || "Unknown";
    setStatus(`Incoming call from ${name}`);
    if (callerOverlay) {
      callerOverlay.textContent = `Incoming call from ${name}...`;
      callerOverlay.style.display = "flex";
    }
    logDebug(`Incoming call from ${name}`);
  };

  rtc.onCallStarted = () => {
    setStatus("In call");
    if (callerOverlay) callerOverlay.style.display = "none";
    logDebug("Call started");
  };

  rtc.onCallEnded = () => {
    setStatus("Call ended");
    setQuality("unknown", "No active call");
    if (callerOverlay) callerOverlay.style.display = "none";
    logDebug("Call ended");
  };

  rtc.onCallFailed = (reason = "Unknown error") => {
    setStatus(`Call failed: ${reason}`);
    setQuality("bad", reason);
    if (callerOverlay) callerOverlay.style.display = "none";
    logDebug(`Call failed: ${reason}`);
  };

  rtc.onQualityChange = (level, info = "") => {
    setQuality(level, info);
    logDebug(`Quality: ${level} (${info})`);
  };

  logDebug("CallUI initialized");
}
