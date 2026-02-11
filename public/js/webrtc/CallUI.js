// public/js/webrtc/CallUI.js
// Aurora‑Orbit Call UI — Final Production Version
// CallUI is the SOLE owner of call window visibility.

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

  const win              = document.getElementById("callWindow");
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

  /* -------------------------------------------------------
     INITIALIZE REMOTE PARTICIPANT SYSTEM
  ------------------------------------------------------- */

  initRemoteParticipants();

  /* -------------------------------------------------------
     WIRE MEDIA ELEMENTS INTO CONTROLLER
  ------------------------------------------------------- */

  rtc.attachMediaElements?.({
    localVideo,
    remoteVideo: null,
    remoteAudio,
  });

  // 🔧 Ensure local preview is always visible when we already have a stream
  if (rtc.localStream && localVideo) {
    localVideo.srcObject = rtc.localStream;
    localVideo.muted = true;
    localVideo.playsInline = true;
    localVideo.classList.add("show");
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

    if (cameraBtn) cameraBtn.classList.toggle("hidden-soft", isOn);
    if (shareBtn)  shareBtn.classList.toggle("hidden-soft", isOn);
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
     WINDOW OPEN/CLOSE — CallUI is sole owner
  ------------------------------------------------------- */

  function openWindowAnimated() {
    if (!win) return;
    if (win.classList.contains("is-open")) return;

    win.classList.remove("hidden");
    win.classList.add("is-open");
    win.setAttribute("aria-hidden", "false");

    win.classList.add("call-opening");
    setTimeout(() => win.classList.remove("call-opening"), 300);

    document.body.classList.add("panel-open");
  }

  function hideWindow() {
    if (!win) return;
    if (!win.classList.contains("is-open")) return;

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
      const off = rtc.switchCamera?.(); // flip camera; returns false (camera on)
      cameraBtn.classList.toggle("flipped");
      cameraBtn.innerHTML =
        `<span class="material-symbols-outlined">videocam</span>`;
      // we keep camera logically "on" for flip behavior; no hard off here
      setCameraOff(false);
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
     RTC EVENT WIRING
  ------------------------------------------------------- */

  rtc.onOutgoingCall = ({ targetName, voiceOnly }) => {
    const kind = voiceOnly ? "voice" : "video";

    debug(`Placing ${kind} call to ${targetName || "user"}`);

    setStatus(`Calling (${kind})…`);
    setVoiceOnly(voiceOnly);
    setMode("active");

    openWindowAnimated();
  };

  rtc.onIncomingCall = ({ fromName, audioOnly }) => {
    const kind = audioOnly ? "voice" : "video";

    debug(`Incoming ${kind} call from ${fromName}`);

    setStatus(`Incoming ${kind} call…`);
    setVoiceOnly(audioOnly);
    setMode("inbound");

    openWindowAnimated();
  };

  rtc.onCallStarted = () => {
    debug("Call connected");
    setStatus("In call");
    startTimer();
    setMode("active");
    openWindowAnimated();

    // 🔧 Ensure local preview is bound once call is live
    if (rtc.localStream && localVideo && !localVideo.srcObject) {
      localVideo.srcObject = rtc.localStream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.classList.add("show");
    }
  };

  rtc.onCallEnded = () => {
    debug("Call ended");
    stopTimer();
    setStatus("Call ended");
    setMode(null);
    clearAllParticipants();
    demoteStage();
    hideWindow();
  };

  rtc.onCallFailed = (reason) => {
    debug(`Call failed: ${reason}`);
    stopTimer();
    setStatus(`Call failed: ${reason}`);
    setMode(null);
    clearAllParticipants();
    demoteStage();
    hideWindow();
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

  /* ============================================================
     ENHANCED INLINE RTC FEATURE IMPLEMENTATIONS
     - Camera flip (front/back)
     - Echo cancellation + AGC + Noise suppression
     - Recording local + remote
     - Waveform visualization
  ============================================================ */

  rtc._state = rtc._state || {};
  rtc._state.cameraFacing = rtc._state.cameraFacing || "user"; // "user" | "environment"
  rtc._state.noiseSuppression = !!rtc._state.noiseSuppression;
  rtc._state.recording = !!rtc._state.recording;
  rtc._state.recorder = rtc._state.recorder || null;
  rtc._state.recordedChunks = rtc._state.recordedChunks || [];

  /* ------------------------------------------------------------
     CAMERA FLIP (front/back)
  ------------------------------------------------------------ */
  rtc.switchCamera = async function () {
    try {
      rtc._state.cameraFacing =
        rtc._state.cameraFacing === "user" ? "environment" : "user";

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: rtc._state.cameraFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      const newTrack = newStream.getVideoTracks()[0];

      const senders = rtc.peerConnection?.getSenders() || [];
      const videoSender = senders.find(
        (s) => s.track && s.track.kind === "video"
      );
      if (videoSender) {
        await videoSender.replaceTrack(newTrack);
      }

      // Stop old video tracks
      rtc.localStream?.getVideoTracks().forEach((t) => t.stop());

      // Replace track in localStream
      if (rtc.localStream) {
        const oldVideo = rtc.localStream.getVideoTracks()[0];
        if (oldVideo) rtc.localStream.removeTrack(oldVideo);
        rtc.localStream.addTrack(newTrack);
      } else {
        rtc.localStream = newStream;
      }

      // 🔧 Always re-bind local preview to the updated localStream
      if (localVideo) {
        localVideo.srcObject = rtc.localStream;
        localVideo.muted = true;
        localVideo.playsInline = true;
        localVideo.classList.add("show");
      }

      return false; // camera is ON (flip, not off)
    } catch (err) {
      console.error("switchCamera (flip) failed:", err);
      return false;
    }
  };

  /* ------------------------------------------------------------
     AUDIO PROCESSING: Echo cancellation + AGC + Noise suppression
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
     SCREEN SHARE
  ------------------------------------------------------------ */
  rtc.startScreenShare = async function () {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      const sender = rtc.peerConnection
        ?.getSenders()
        .find((s) => s.track && s.track.kind === "video");

      if (sender && track) await sender.replaceTrack(track);

      track.onended = () => rtc.stopScreenShare();

      rtc.onScreenShareStarted?.(rtc.localPeerId);
    } catch (err) {
      console.error("Screen share failed:", err);
    }
  };

  rtc.stopScreenShare = async function () {
    try {
      const camTrack = rtc.localStream?.getVideoTracks()[0];
      const sender = rtc.peerConnection
        ?.getSenders()
        .find((s) => s.track && s.track.kind === "video");

      if (sender && camTrack) await sender.replaceTrack(camTrack);

      rtc.onScreenShareStopped?.(rtc.localPeerId);
    } catch (err) {
      console.error("stopScreenShare failed:", err);
    }
  };

  /* ------------------------------------------------------------
     RECORDING: Local + Remote mixed
  ------------------------------------------------------------ */
  rtc.toggleRecording = function () {
    try {
      if (!rtc._state.recording) {
        const mixedStream = new MediaStream();

        rtc.localStream?.getTracks().forEach((t) => mixedStream.addTrack(t));
        rtc.remoteStream?.getTracks().forEach((t) => mixedStream.addTrack(t));

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
          // TODO: upload or save
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
     WAVEFORM VISUALIZATION (Noise / Mic)
  ------------------------------------------------------------ */
  (function initWaveform() {
    try {
      const canvas = document.getElementById("noiseWaveform");
      if (!canvas || !rtc.localStream) return;

      const ctx = canvas.getContext("2d");
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(rtc.localStream);
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
    if (window.innerWidth > 900) return;
    if (!win || !grid) return;

    const callWindow = win;
    const callGrid   = grid;
    const controls   = document.querySelector(".call-controls");
    let participants = Array.from(callGrid.querySelectorAll(".participant"));

    let hideTimer = null;

    // Auto-hide controls
    function resetAutoHide() {
      if (!controls) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        controls.classList.add("hidden");
      }, 3000);
    }

    // Tap to show/hide controls (ignore taps on controls themselves)
    callWindow.addEventListener("click", (e) => {
      if (controls && e.target.closest(".call-controls")) return;
      if (!controls) return;

      controls.classList.toggle("hidden");
      if (!controls.classList.contains("hidden")) {
        resetAutoHide();
      }
    });

    if (controls) resetAutoHide();

    // Swipe left/right to switch participants
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

    // Active speaker auto-fullscreen
    window.setActiveSpeaker = function (participantId) {
      participants = Array.from(callGrid.querySelectorAll(".participant"));
      const index = participants.findIndex((p) => p.dataset.id === participantId);
      if (index >= 0) {
        callGrid.scrollTo({
          left: index * callGrid.clientWidth,
          behavior: "smooth",
        });
      }
    };

    // Screen share mode hooks
    window.enableScreenShareMode = function () {
      callGrid.classList.add("screen-share-mode");
    };

    window.disableScreenShareMode = function () {
      callGrid.classList.remove("screen-share-mode");
    };

    // Double-tap to switch camera
    let lastTap = 0;
    callWindow.addEventListener("touchend", () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        rtc.switchCamera?.();
      }
      lastTap = now;
    });

    // Pinch-to-zoom on active video
    function enablePinchZoom() {
      const activeVideo =
        callGrid.querySelector(".participant.active .media-wrapper video") ||
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

    // Draggable PIP (local participant)
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

    // Auto-switch layout on rotation
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






























