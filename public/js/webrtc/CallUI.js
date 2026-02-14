// public/js/webrtc/CallUI.js
// Aurora‑Orbit Call UI — Production Version (Google‑Meet–grade)
//
// Sole owner of:
//  - Call window visibility
//  - Layout classes (inbound/active, voice-only, camera-off, screen-share, PIP)
//  - Ringer / ringback / notification behavior
//  - Mobile Meet-style behavior
//
// Integrates with:
//  - WebRTCMedia.js (resumeRemoteMediaPlayback, flipLocalCamera, cleanupMedia)
//  - RemoteParticipants.js (initRemoteParticipants, clearAllParticipants, setParticipantSpeaking, setParticipantCameraOff)
//  - messaging.js (getReceiver)
//  - session.js (getVoiceBtn, getVideoBtn)

// public/js/webrtc/CallUI.js
import { openVoicemailRecorder } from "../voicemail-recorder.js";
import {
  resumeRemoteMediaPlayback,
  flipLocalCamera,
  cleanupMedia,
} from "./WebRTCMedia.js";

import {
  initRemoteParticipants,
  clearAllParticipants,
  setParticipantSpeaking,
  setParticipantCameraOff,
} from "./RemoteParticipants.js";

import { getReceiver } from "../messaging.js";
import { getVoiceBtn, getVideoBtn } from "../session.js";

export function initCallUI(rtc) {
  if (!rtc) {
    console.warn("[CallUI] No RTC controller provided");
    return;
  }

  /* -------------------------------------------------------
     DOM ELEMENTS
  ------------------------------------------------------- */
  const win              = document.getElementById("callWindow");
  const grid             = document.getElementById("callGrid");
  const localParticipant = document.getElementById("localParticipant");

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

  const voiceBtn         = getVoiceBtn?.();
  const videoBtn         = getVideoBtn?.();

  const ringtoneEl       = document.getElementById("ringtone");
  const ringbackEl       = document.getElementById("ringback");
  const notificationEl   = document.getElementById("notification");

  /* -------------------------------------------------------
     SAFETY GUARDS
  ------------------------------------------------------- */
  if (!win || !grid) {
    console.warn("[CallUI] Missing core call window elements");
    return;
  }

  if (win.dataset.callUiInitialized === "true") {
    console.warn("[CallUI] initCallUI called more than once — skipping rebind");
    return;
  }
  win.dataset.callUiInitialized = "true";

  /* -------------------------------------------------------
     CALL BUTTON SAFETY HELPERS
  ------------------------------------------------------- */
  function disableCallButtons() {
    if (voiceBtn) voiceBtn.disabled = true;
    if (videoBtn) videoBtn.disabled = true;
  }

  function enableCallButtons() {
    if (voiceBtn) voiceBtn.disabled = false;
    if (videoBtn) videoBtn.disabled = false;
  }

/* -------------------------------------------------------
   MEDIA ELEMENT WIRING
------------------------------------------------------- */
initRemoteParticipants();

rtc.attachMediaElements({
  localVideo,
  remoteAudio,
});

  /* -------------------------------------------------------
     AUTOPLAY RECOVERY (GLOBAL)
  ------------------------------------------------------- */
  let autoplayArmed = false;

  function primeAudioElement(el) {
    if (!el) return;
    try {
      el.muted = false;
      if (el.volume === 0) el.volume = 1;
      el.play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
        })
        .catch(() => {});
    } catch {}
  }

  function enableAutoplayRecovery() {
    if (autoplayArmed) return;
    autoplayArmed = true;

    const handler = () => {
      resumeRemoteMediaPlayback();

      primeAudioElement(ringtoneEl);
      primeAudioElement(ringbackEl);
      primeAudioElement(notificationEl);

      document.removeEventListener("pointerdown", handler);
    };

    document.addEventListener("pointerdown", handler, { once: true });

    win.addEventListener("click", () => {
      resumeRemoteMediaPlayback();
    });
  }

  enableAutoplayRecovery();

  /* -------------------------------------------------------
     RINGER / RINGBACK / NOTIFICATION HELPERS
  ------------------------------------------------------- */
  function playSafe(el, loop = false) {
    if (!el) return;
    try {
      el.loop = !!loop;
      el.muted = false;
      if (el.volume === 0) el.volume = 1;
      el.play().catch(() => {});
    } catch {}
  }

  function stopSafe(el) {
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.loop = false;
    } catch {}
  }

  function playRingtone() {
    stopSafe(ringbackEl);
    playSafe(ringtoneEl, true);
  }

  function stopRingtone() {
    stopSafe(ringtoneEl);
  }

  function playRingback() {
    stopSafe(ringtoneEl);
    playSafe(ringbackEl, true);
  }

  function stopRingback() {
    stopSafe(ringbackEl);
  }

  function playNotification() {
    playSafe(notificationEl, false);
  }

  /* -------------------------------------------------------
     LOCAL STREAM BINDING (DEFENSIVE)
  ------------------------------------------------------- */
  rtc.onLocalStream = (stream) => {
    if (!localVideo) return;

    localVideo.srcObject = stream || null;
    localVideo.muted = true;
    localVideo.playsInline = true;

    if (stream) {
      localParticipant?.classList.remove("voice-only");
      win.classList.remove("voice-only-call");

      localVideo
        .play()
        .catch(() =>
          setTimeout(() => localVideo.play().catch(() => {}), 80)
        );
    } else {
      localParticipant?.classList.add("voice-only");
      win.classList.add("voice-only-call");
    }
  };

  if (rtc.localStream && localVideo) {
    localVideo.srcObject = rtc.localStream;
    localVideo.muted = true;
    localVideo.playsInline = true;
    localParticipant?.classList.remove("voice-only");
    win.classList.remove("voice-only-call");
  }

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
     UI MODE + LAYOUT HELPERS
  ------------------------------------------------------- */
  function setMode(mode) {
    win.classList.remove("inbound-mode", "active-mode");
    if (mode === "inbound") win.classList.add("inbound-mode");
    if (mode === "active")  win.classList.add("active-mode");
  }

  function setStatus(text) {
    if (!callStatus) return;
    callStatus.textContent = text || "";
  }

  function setVoiceOnly(on) {
    const isOn = !!on;
    win.classList.toggle("voice-only-call", isOn);
    localParticipant?.classList.toggle("voice-only", isOn);

    cameraBtn?.classList.toggle("hidden-soft", isOn);
    shareBtn?.classList.toggle("hidden-soft", isOn);
  }

  function setCameraOff(on) {
    const off = !!on;
    win.classList.toggle("camera-off", off);
    localParticipant?.classList.toggle("voice-only", off);
  }

  function setScreenShare(on) {
    grid.classList.toggle("screen-share-mode", !!on);
  }

  function setNoiseSuppression(on) {
    noiseBtn?.classList.toggle("active", !!on);
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
     SCREEN SHARE LAYOUT HELPERS (STAGE + FILMSTRIP)
  ------------------------------------------------------- */
  function setScreenShareMode(peerId) {
    const participants = Array.from(
      grid.querySelectorAll(".participant")
    );

    participants.forEach((p) => {
      p.classList.remove("stage", "filmstrip");
    });

    const stageParticipant = participants.find(
      (p) => p.dataset.peerId === String(peerId)
    );

    if (stageParticipant) {
      stageParticipant.classList.add("stage");
      participants
        .filter((p) => p !== stageParticipant)
        .forEach((p) => p.classList.add("filmstrip"));
    }

    setScreenShare(true);
  }

  function clearScreenShareMode() {
    const participants = Array.from(
      grid.querySelectorAll(".participant")
    );

    participants.forEach((p) => {
      p.classList.remove("stage", "filmstrip");
    });

    setScreenShare(false);
  }

  window.setScreenShareMode = setScreenShareMode;
  window.clearScreenShareMode = clearScreenShareMode;

  /* -------------------------------------------------------
     WINDOW OPEN/CLOSE
  ------------------------------------------------------- */
  function openWindowAnimated() {
    if (win.classList.contains("is-open")) return;

    win.classList.remove("hidden");
    win.classList.add("is-open");
    win.setAttribute("aria-hidden", "false");

    win.classList.add("call-opening");
    setTimeout(() => win.classList.remove("call-opening"), 300);

    document.body.classList.add("panel-open");
  }

  function hideWindow() {
    if (!win.classList.contains("is-open")) return;

    const active = document.activeElement;
    if (active && win.contains(active)) {
      active.blur();
    }

    win.classList.remove("is-open");
    win.setAttribute("aria-hidden", "true");

    setTimeout(() => {
      win.classList.add("hidden");
      document.body.classList.remove("panel-open");
    }, 260);
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

  window.showUnavailableToastInternal = showUnavailableToastInternal;
  window.showSecondaryIncomingToastInternal = showSecondaryIncomingToastInternal;

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
      disableCallButtons();
      setStatus("Declining…");
      stopRingtone();
      stopRingback();
      rtc.declineIncomingCall?.();
    };
  }

  if (answerBtn) {
    answerBtn.onclick = async () => {
      disableCallButtons();
      setStatus("Answering…");
      stopRingtone();
      stopRingback();

      openWindowAnimated();
      setMode("active");

      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      await rtc.answerIncomingCall?.();
      resumeRemoteMediaPlayback();
    };
  }

  if (endBtn) {
    endBtn.onclick = () => {
      setStatus("Call ended");
      stopRingtone();
      stopRingback();
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

  rtc.switchCamera = async function () {
    const ok = await flipLocalCamera(rtc);
    if (!ok) {
      console.warn("[CallUI] switchCamera failed");
      return false;
    }
    return false;
  };

  if (cameraBtn) {
    cameraBtn.onclick = async () => {
      const off = await rtc.switchCamera?.();
      cameraBtn.classList.toggle("flipped");
      cameraBtn.innerHTML =
        `<span class="material-symbols-outlined">videocam</span>`;
      setCameraOff(!!off);
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
    moreMenu.classList.add("hidden");

    const toggleMenu = (e) => {
      e.stopPropagation();
      const isOpen = moreMenu.classList.contains("show");
      moreMenu.classList.toggle("show", !isOpen);
      moreMenu.classList.toggle("hidden", isOpen);
    };

    const closeMenu = () => {
      moreMenu.classList.remove("show");
      moreMenu.classList.add("hidden");
    };

    moreBtn.addEventListener("click", toggleMenu);
    document.addEventListener("click", closeMenu);
  }

  if (voiceBtn) {
    voiceBtn.onclick = async () => {
      const peerId = getReceiver?.();
      if (!peerId) return;

      openWindowAnimated();
      setMode("active");
      setVoiceOnly(true);
      playRingback();

      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      rtc.startCall(peerId, true);
      resumeRemoteMediaPlayback();
    };
  }

  if (videoBtn) {
    videoBtn.onclick = async () => {
      const peerId = getReceiver?.();
      if (!peerId) return;

      openWindowAnimated();
      setMode("active");
      setVoiceOnly(false);
      playRingback();

      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      rtc.startCall(peerId, false);
      resumeRemoteMediaPlayback();
    };
  }

  /* -------------------------------------------------------
     RTC EVENT WIRING
  ------------------------------------------------------- */
  rtc.onOutgoingCall = ({ targetName, voiceOnly }) => {
    const kind = voiceOnly ? "voice" : "video";

    debug(`Placing ${kind} call to ${targetName || "user"}`);

    setStatus(`Calling (${kind})…`);
    setVoiceOnly(voiceOnly);
    setMode("active");

    disableCallButtons();
    openWindowAnimated();
    playRingback();
  };

  rtc.onIncomingCall = ({ fromName, audioOnly }) => {
    const kind = audioOnly ? "voice" : "video";

    debug(`Incoming ${kind} call from ${fromName}`);

    setStatus(`Incoming ${kind} call…`);
    setVoiceOnly(audioOnly);
    setMode("inbound");

    openWindowAnimated();
    playRingtone();
  };

  rtc.onCallStarted = () => {
    debug("Call connected");
    setStatus("In call");
    startTimer();
    setMode("active");
    openWindowAnimated();
    stopRingtone();
    stopRingback();
    resumeRemoteMediaPlayback();

    if (rtc.localStream && localVideo && !localVideo.srcObject) {
      localVideo.srcObject = rtc.localStream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localParticipant?.classList.remove("voice-only");
    }
  };

  function finalizeCallEnd(statusText) {
    debug(statusText);
    stopTimer();
    setStatus(statusText);
    setMode(null);
    clearAllParticipants();
    cleanupMedia();
    clearScreenShareMode();
    hideWindow();
    enableCallButtons();
    stopRingtone();
    stopRingback();
  }

  rtc.onCallEnded = () => {
    finalizeCallEnd("Call ended");
  };

  rtc.onCallFailed = (reason) => {
    finalizeCallEnd(`Call failed: ${reason}`);
    playNotification();
  };

  rtc.onQualityChange = (level, info) => {
    debug(`Network: ${level} (${info})`);
    setQuality(level, info);
  };

  rtc.onRemoteCameraOff = (peerId) => setParticipantCameraOff(peerId, true);
  rtc.onRemoteCameraOn  = (peerId) => setParticipantCameraOff(peerId, false);

  rtc.onRemoteSpeaking = ({ peerId, active, level }) => {
    setParticipantSpeaking(peerId, active, level);
  };

  rtc.onScreenShareStarted = (peerId) => {
    debug(`Screen share started by ${peerId}`);
    setScreenShareMode(peerId);

    const pip = document.getElementById("localPip");
    if (pip && peerId !== "local") {
      pip.classList.add("show");
    }
  };

  rtc.onScreenShareStopped = () => {
    debug("Screen share stopped");
    clearScreenShareMode();

    const pip = document.getElementById("localPip");
    if (pip) pip.classList.remove("show");
  };

  rtc.onNoiseSuppressionChanged = (enabled) =>
    setNoiseSuppression(enabled);

  rtc.onRecordingChanged = ({ active }) =>
    recordBtn?.classList.toggle("active", !!active);

  rtc.onVoicemailPrompt = (data) => {
    enableCallButtons();
    stopRingtone();
    stopRingback();
    showUnavailableToastInternal(data);
  };

  rtc.onSecondaryIncomingCall = (data) =>
    showSecondaryIncomingToastInternal(data);

  rtc.onActiveSpeaker = (peerId) => {
    setParticipantSpeaking(peerId, true, 1);
    if (window.setActiveSpeaker) {
      window.setActiveSpeaker(peerId);
    }
  };

  /* ============================================================
     ENHANCED INLINE RTC FEATURE IMPLEMENTATIONS
  ============================================================ */
  rtc._state = rtc._state || {};
  rtc._state.cameraFacing = rtc._state.cameraFacing || "user";
  rtc._state.noiseSuppression = !!rtc._state.noiseSuppression;
  rtc._state.recording = !!rtc._state.recording;
  rtc._state.recorder = rtc._state.recorder || null;
  rtc._state.recordedChunks = rtc._state.recordedChunks || [];

  /* ------------------------------------------------------------
     AUDIO PROCESSING
  ------------------------------------------------------------ */
  rtc.applyAudioProcessing = function () {
    try {
      rtc.localStream?.getAudioTracks().forEach((track) => {
        track.applyConstraints({
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: rtc._state.noiseSuppression,
        });
      });

      rtc.onNoiseSuppressionChanged?.(rtc._state.noiseSuppression);
    } catch (err) {
      console.error("applyAudioProcessing failed:", err);
    }
  };

  rtc.toggleNoiseSuppression = function () {
    rtc._state.noiseSuppression = !rtc._state.noiseSuppression;
    rtc.applyAudioProcessing();
    return rtc._state.noiseSuppression;
  };

  /* ------------------------------------------------------------
     RECORDING: Local + Remote mixed (DOM-aligned)
  ------------------------------------------------------------ */
  rtc.toggleRecording = function () {
    try {
      if (!rtc._state.recording) {
        const mixedStream = new MediaStream();

        rtc.localStream?.getTracks().forEach((t) => mixedStream.addTrack(t));

        const remoteSrc =
          (remoteAudio && remoteAudio.srcObject instanceof MediaStream
            ? remoteAudio.srcObject
            : null);

        remoteSrc?.getTracks().forEach((t) => mixedStream.addTrack(t));

        rtc._state.recordedChunks = [];
        rtc._state.recorder = new MediaRecorder(mixedStream, {
          mimeType: "video/webm; codecs=vp9",
        });

        rtc._state.recorder.ondataavailable = (e) => {
          if (e.data.size > 0) rtc._state.recordedChunks.push(e.data);
        };

        rtc._state.recorder.onstop = () => {
          const blob = new Blob(rtc._state.recordedChunks, {
            type: "video/webm",
          });
          const url = URL.createObjectURL(blob);
          console.log("Recording ready:", url);
        };

        rtc._state.recorder.start();
        rtc._state.recording = true;
        rtc.onRecordingChanged?.({ active: true });
        return true;
      }

      rtc._state.recorder?.stop();
      rtc._state.recording = false;
      rtc.onRecordingChanged?.({ active: false });
      return false;
    } catch (err) {
      console.error("toggleRecording failed:", err);
      return false;
    }
  };

  /* ------------------------------------------------------------
     WAVEFORM VISUALIZATION
  ------------------------------------------------------------ */
  (function initWaveform() {
    try {
      const canvas = document.getElementById("noiseWaveform");
      if (!canvas) return;

      const baseStream =
        rtc.localStream ||
        (localVideo && localVideo.srcObject instanceof MediaStream
          ? localVideo.srcObject
          : null);

      if (!baseStream) return;

      const ctx = canvas.getContext("2d");
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(baseStream);
      const analyser = audioCtx.createAnalyser();

      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      source.connect(analyser);

      function draw() {
        requestAnimationFrame(draw);

        analyser.getByteTimeDomainData(dataArray);

        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        ctx.lineWidth = 2;
        ctx.strokeStyle = rtc._state.noiseSuppression
          ? "#4ade80"
          : "#f97316";

        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }

      draw();
    } catch (err) {
      console.error("Waveform init failed:", err);
    }
  })();

  /* -------------------------------------------------------
     MOBILE VIDEO BEHAVIOR — GOOGLE MEET STYLE
  ------------------------------------------------------- */
  (function initMobileCallBehavior() {
    if (window.__callUiMobileInit) return;
    if (window.innerWidth > 900) return;
    if (!win || !grid) return;

    window.__callUiMobileInit = true;

    const callWindow = win;
    const callGrid   = grid;
    const controls   = document.querySelector(".call-controls");
    let participants = Array.from(callGrid.querySelectorAll(".participant"));

    let hideTimer = null;

    function resetAutoHide() {
      if (!controls) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        controls.classList.add("hidden");
      }, 3000);
    }

    callWindow.addEventListener("click", (e) => {
      if (controls && e.target.closest(".call-controls")) return;
      if (!controls) return;

      controls.classList.toggle("hidden");
      if (!controls.classList.contains("hidden")) {
        resetAutoHide();
      }
    });

    if (controls) resetAutoHide();

    let startX = 0;
    let scrollStart = 0;

    callGrid.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      scrollStart = callGrid.scrollLeft;
    });

    callGrid.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 1) return;
      const dx = startX - e.touches[0].clientX;
      callGrid.scrollLeft = scrollStart + dx;
    });

    window.setActiveSpeaker = function (participantId) {
      participants = Array.from(callGrid.querySelectorAll(".participant"));

      participants.forEach((p) => p.classList.remove("active-speaker"));

      const index = participants.findIndex(
        (p) => p.dataset.peerId === String(participantId)
      );

      if (index >= 0) {
        const active = participants[index];
        active.classList.add("active-speaker");

        callGrid.scrollTo({
          left: index * callGrid.clientWidth,
          behavior: "smooth",
        });
      }
    };

    let lastTap = 0;
    callWindow.addEventListener("touchend", () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        rtc.switchCamera?.();
      }
      lastTap = now;
    });

    function enablePinchZoom() {
      const activeVideo =
        callGrid.querySelector(".participant.active-speaker .media-wrapper video") ||
        callGrid.querySelector(".participant .media-wrapper video");

      if (!activeVideo) return;

      activeVideo.classList.add("zoomable");

      let initialDistance = 0;
      let scale = 1;

      activeVideo.addEventListener("touchmove", (e) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (!initialDistance) initialDistance = distance;

          scale = Math.min(Math.max(distance / initialDistance, 1), 3);
          activeVideo.style.transform = `scale(${scale})`;
        }
      });

      activeVideo.addEventListener("touchend", () => {
        if (scale <= 1.05) {
          scale = 1;
          activeVideo.style.transform = "scale(1)";
        }
        initialDistance = 0;
      });
    }

    enablePinchZoom();

    const pip = callGrid.querySelector(".participant.local");
    if (pip) {
      pip.classList.add("draggable");

      let offsetX = 0, offsetY = 0;
      let startX2 = 0, startY2 = 0;

      pip.addEventListener("touchstart", (e) => {
        const rect = pip.getBoundingClientRect();
        startX2 = e.touches[0].clientX;
        startY2 = e.touches[0].clientY;
        offsetX = startX2 - rect.left;
        offsetY = startY2 - rect.top;
      });

      pip.addEventListener("touchmove", (e) => {
        const x = e.touches[0].clientX - offsetX;
        const y = e.touches[0].clientY - offsetY;

        pip.style.left = `${x}px`;
        pip.style.top  = `${y}px`;
      });
    }

    function updateLayout() {
      if (window.innerWidth > window.innerHeight) {
        callGrid.classList.add("landscape-mode");
      } else {
        callGrid.classList.remove("landscape-mode");
      }
    }

    window.addEventListener("resize", updateLayout);
    updateLayout();
  })();

  console.log("[CallUI] Initialized");
}

















































