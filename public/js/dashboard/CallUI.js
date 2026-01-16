// public/js/webrtc/CallUI.js

/**
 * UI layer for WebRTC calls.
 * Works alongside your existing WebRTCController.js
 * without overriding its internal button bindings.
 */

export function initCallUI(rtc) {
  if (!rtc) {
    console.warn("[CallUI] WebRTCController instance missing");
    return;
  }

  // DOM elements
  const callStatus     = document.getElementById("call-status");
  const callTimerEl    = document.getElementById("call-timer");
  const callerOverlay  = document.getElementById("callerOverlay");

  const answerBtn      = document.getElementById("answer-call");
  const declineBtn     = document.getElementById("decline-call");
  const endBtn         = document.getElementById("end-call");
  const muteBtn        = document.getElementById("mute-call");
  const cameraToggle   = document.getElementById("camera-toggle");

  const localVideo     = document.getElementById("localVideo");
  const remoteVideo    = document.getElementById("remoteVideo");
  const remoteAudio    = document.getElementById("remoteAudio");

  // Attach media elements if controller supports it
  if (typeof rtc.attachMediaElements === "function") {
    rtc.attachMediaElements({ localVideo, remoteVideo, remoteAudio });
  }

  // -------------------------------
  // CALL TIMER
  // -------------------------------
  let callStart = null;
  let timerId = null;

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

  // -------------------------------
  // UI HELPERS
  // -------------------------------
  function setStatus(text) {
    if (callStatus) callStatus.textContent = text;
  }

  function showIncoming(fromName) {
    if (!callerOverlay) return;
    callerOverlay.style.display = "flex";
    callerOverlay.textContent = fromName
      ? `Incoming call from ${fromName}...`
      : "Incoming call...";
  }

  function hideIncoming() {
    if (!callerOverlay) return;
    callerOverlay.style.display = "none";
    callerOverlay.textContent = "";
  }

  // -------------------------------
  // BUTTON BINDINGS
  // -------------------------------
  answerBtn?.addEventListener("click", () => {
    hideIncoming();
    setStatus("Answering...");
    rtc.answerCall?.();
  });

  declineBtn?.addEventListener("click", () => {
    hideIncoming();
    setStatus("Declined");
    rtc.declineCall?.();
  });

  endBtn?.addEventListener("click", () => {
    setStatus("Call ended");
    stopTimer();
    rtc.endCall?.();
  });

  muteBtn?.addEventListener("click", () => {
    const muted = rtc.toggleMute?.();
    if (muted !== undefined) {
      muteBtn.textContent = muted ? "🔈 Unmute" : "🔇 Mute";
    }
  });

  cameraToggle?.addEventListener("click", () => {
    rtc.switchCamera?.();
  });

  // -------------------------------
  // HOOK INTO rtc EVENTS (if provided)
  // -------------------------------
  if (typeof rtc.onIncomingCall === "function") {
    rtc.onIncomingCall(({ fromName }) => {
      showIncoming(fromName);
      setStatus("Incoming call...");
    });
  }

  if (typeof rtc.onCallStarted === "function") {
    rtc.onCallStarted(() => {
      hideIncoming();
      setStatus("In call");
      startTimer();
    });
  }

  if (typeof rtc.onCallEnded === "function") {
    rtc.onCallEnded(() => {
      hideIncoming();
      setStatus("Call ended");
      stopTimer();
    });
  }

  if (typeof rtc.onCallFailed === "function") {
    rtc.onCallFailed((reason) => {
      hideIncoming();
      setStatus(`Call failed: ${reason || "Unknown error"}`);
      stopTimer();
    });
  }
}
