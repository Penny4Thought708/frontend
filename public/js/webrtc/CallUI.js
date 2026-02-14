// public/js/webrtc/CallUI.js
// ============================================================
// CallUI: orchestrates call window, controls, and WebRTCController
// ============================================================

import { rtcState } from "./WebRTCState.js";
import { WebRTCController } from "./WebRTCController.js";
import {
  videoContainer,
  remoteWrapper,
  localWrapper,
  localNameDiv,
  remoteNameDiv,
  ringtone,
  ringback,
  muteBtn,
  camBtn,
  answerBtn,
  declineBtn,
  callControls,
  endBtn,
  callerOverlay,
} from "../session.js";

function log(...args) {
  console.log("[CallUI]", ...args);
}

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export class CallUI {
  constructor(socket) {
    this.socket = socket;
    this.rtc = new WebRTCController(socket);

    // Core containers
    this.videoContainer = videoContainer;
    this.remoteWrapper = remoteWrapper;
    this.localWrapper = localWrapper;
    this.callerOverlay = callerOverlay;
    this.callControls = callControls;

    // Names
    this.localNameDiv = localNameDiv;
    this.remoteNameDiv = remoteNameDiv;

    // Controls
    this.muteBtn = muteBtn;
    this.camBtn = camBtn;
    this.answerBtn = answerBtn;
    this.declineBtn = declineBtn;
    this.endBtn = endBtn;
    this.moreBtn = document.getElementById("more-controls-btn");
    this.moreMenu = document.getElementById("more-controls-menu");
    this.upgradeBtn = document.getElementById("upgrade-to-video");

    // Audio cues
    this.ringtone = ringtone;
    this.ringback = ringback;
    this.cameraOnBeep = document.getElementById("cameraOnBeep");

    // Status / timer / quality
    this.statusEl = document.getElementById("call-status");
    this.timerEl = document.getElementById("call-timer");
    this.qualityEl = document.getElementById("call-quality-indicator");

    // Layout state
    this._primaryIsRemote = true; // remote full, local PiP
    this._dragState = null;

    this._bindButtons();
    this._bindControllerEvents();
    this._initPipDrag();
    this._startTimerLoop();
    this._startQualityMonitor();
  }

  // -------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------
  startVoiceCall(peerId) {
    log("startVoiceCall", peerId);
    rtcState.audioOnly = true;
    rtcState.peerId = String(peerId);
    this._openWindow();
    this._enterOutboundVoiceMode();
    this.rtc.startCall(peerId, { audio: true, video: false });
    this._playRingback();
  }

  startVideoCall(peerId) {
    log("startVideoCall", peerId);
    rtcState.audioOnly = false;
    rtcState.peerId = String(peerId);
    this._openWindow();
    this._enterOutboundVideoMode();
    this.rtc.startCall(peerId, { audio: true, video: true });
    this._playRingback();
  }

  receiveInboundCall(peerId, isVideo = false) {
    log("receiveInboundCall", peerId, { isVideo });
    rtcState.peerId = String(peerId);
    rtcState.audioOnly = !isVideo;

    this._openWindow();
    if (isVideo) {
      this._enterInboundVideoMode();
    } else {
      this._enterInboundVoiceMode();
    }
    this._playRingtone();
  }

  answerCall() {
    log("answerCall");
    this._stopRinging();
    this.rtc.answerCall();
    if (rtcState.audioOnly) {
      this._enterActiveVoiceMode();
    } else {
      this._enterActiveVideoMode();
    }
  }

  endCall() {
    log("endCall");
    this._stopRinging();
    this.rtc.endCall();
    this._resetUI();
  }

  async upgradeToVideo() {
    log("upgradeToVideo");
    await this.rtc.upgradeToVideo();
    rtcState.audioOnly = false;
    this._enterVideoControlsMode();
  }

  // -------------------------------------------------------
  // INTERNAL: controller event wiring
  // -------------------------------------------------------
  _bindControllerEvents() {
    this.rtc.onCallStarted = (peerId) => {
      log("onCallStarted", peerId);
      this._stopRinging();
      if (rtcState.audioOnly) {
        this._enterActiveVoiceMode();
      } else {
        this._enterActiveVideoMode();
      }
    };

    this.rtc.onCallEnded = () => {
      log("onCallEnded");
      this._stopRinging();
      this._resetUI();
    };

    this.rtc.onRemoteJoin = (peerId) => {
      log("onRemoteJoin", peerId);
      this._setStatus("Connected");
    };

    this.rtc.onRemoteLeave = (peerId) => {
      log("onRemoteLeave", peerId);
      this._setStatus("Remote left");
      this._resetUI();
    };

    this.rtc.onIncomingOffer = (peerId, offer) => {
      log("onIncomingOffer", peerId);
      this._handleIncomingOffer(peerId, offer);
    };

    this.rtc.onRemoteUpgradedToVideo = () => {
      log("onRemoteUpgradedToVideo");
      this._handleRemoteUpgradedToVideo();
    };

    this.rtc.onQualityUpdate = (score) => {
      if (!this.qualityEl) return;
      this.qualityEl.textContent = score;
    };
  }

  // -------------------------------------------------------
  // INTERNAL: button wiring
  // -------------------------------------------------------
  _bindButtons() {
    if (this.answerBtn) {
      this.answerBtn.addEventListener("click", () => this.answerCall());
    }

    if (this.declineBtn) {
      this.declineBtn.addEventListener("click", () => this.endCall());
    }

    if (this.endBtn) {
      this.endBtn.addEventListener("click", () => this.endCall());
    }

    if (this.muteBtn) {
      this.muteBtn.addEventListener("click", () => {
        const stream = rtcState.localStream;
        if (!stream) return;
        const enabled = stream.getAudioTracks().some((t) => t.enabled);
        stream.getAudioTracks().forEach((t) => (t.enabled = !enabled));
        this.muteBtn.classList.toggle("active", !enabled);
      });
    }

    if (this.camBtn) {
      this.camBtn.addEventListener("click", () => {
        const stream = rtcState.localStream;
        if (!stream) return;
        const enabled = stream.getVideoTracks().some((t) => t.enabled);
        stream.getVideoTracks().forEach((t) => (t.enabled = !enabled));
        this.camBtn.classList.toggle("active", !enabled);
      });
    }

    if (this.moreBtn && this.moreMenu) {
      this.moreBtn.addEventListener("click", () => {
        this.moreMenu.classList.toggle("visible");
      });

      document.addEventListener("click", (e) => {
        if (
          !this.moreMenu.contains(e.target) &&
          e.target !== this.moreBtn
        ) {
          this.moreMenu.classList.remove("visible");
        }
      });
    }

    if (this.upgradeBtn) {
      this.upgradeBtn.addEventListener("click", () => this.upgradeToVideo());
    }

    // Double-tap / double-click to swap primary/ PiP
    if (this.remoteWrapper) {
      this._bindDoubleTap(this.remoteWrapper, () => this._togglePrimary());
    }
    if (this.localWrapper) {
      this._bindDoubleTap(this.localWrapper, () => this._togglePrimary());
    }
  }

  _bindDoubleTap(el, handler) {
    let lastTap = 0;
    el.addEventListener("click", () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        handler();
      }
      lastTap = now;
    });
  }

  // -------------------------------------------------------
  // INBOUND OFFER HANDLING
  // -------------------------------------------------------
  _handleIncomingOffer(peerId, offer) {
    const isVideo = !rtcState.audioOnly;
    this.receiveInboundCall(peerId, isVideo);
  }

  _handleRemoteUpgradedToVideo() {
    if (this.cameraOnBeep) {
      this.cameraOnBeep.currentTime = 0;
      this.cameraOnBeep.play().catch(() => {});
    }

    rtcState.audioOnly = false;
    this._enterVideoControlsMode();
    this._setStatus("Camera enabled by other side");
  }

  // -------------------------------------------------------
  // WINDOW + LAYOUT MODES
  // -------------------------------------------------------
  _openWindow() {
    if (!this.videoContainer) return;
    this.videoContainer.classList.add("active");
    this.videoContainer.classList.remove("hidden");

    // Default layout: remote primary, local PiP
    this._primaryIsRemote = true;
    this._applyPrimaryLayout();
  }

  _closeWindow() {
    if (!this.videoContainer) return;
    this.videoContainer.classList.remove("active");
    this.videoContainer.classList.add("hidden");
  }

  _enterOutboundVoiceMode() {
    this._setStatus("Calling…");
    this._showControlsForVoice({ outbound: true });
    this._showOverlay("Calling…");
  }

  _enterOutboundVideoMode() {
    this._setStatus("Video calling…");
    this._showControlsForVideo({ outbound: true });
    this._showOverlay("Video calling…");
  }

  _enterInboundVoiceMode() {
    this._setStatus("Incoming call");
    this._showControlsForVoice({ inbound: true });
    this._showOverlay("Incoming call");
  }

  _enterInboundVideoMode() {
    this._setStatus("Incoming video");
    this._showControlsForVideo({ inbound: true });
    this._showOverlay("Incoming video");
  }

  _enterActiveVoiceMode() {
    this._setStatus("In call");
    this._showControlsForVoice({ active: true });
    this._hideOverlay();

    // Voice-only: remote wrapper can still be used for avatar / waveform
    if (this.remoteWrapper) {
      this.remoteWrapper.classList.add("voice-only");
    }
    if (this.localWrapper) {
      this.localWrapper.classList.add("voice-only");
    }
  }

  _enterActiveVideoMode() {
    this._setStatus("In video call");
    this._showControlsForVideo({ active: true });
    this._hideOverlay();

    if (this.remoteWrapper) {
      this.remoteWrapper.classList.remove("voice-only");
    }
    if (this.localWrapper) {
      this.localWrapper.classList.remove("voice-only");
    }

    // Mobile A: when callee gets remote video before answer, full screen.
    // After answer, we keep remote full and local PiP.
    this._applyPrimaryLayout();
  }

  _enterVideoControlsMode() {
    this._enterActiveVideoMode();
  }

  _resetUI() {
    rtcState.inCall = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.incomingIsVideo = false;

    this._closeWindow();
    this._hideOverlay();
    this._setStatus("");
    if (this.timerEl) this.timerEl.textContent = "00:00";
    if (this.moreMenu) this.moreMenu.classList.remove("visible");
  }

  // -------------------------------------------------------
  // CONTROLS VISIBILITY
  // -------------------------------------------------------
  _showControlsForVoice({ outbound, inbound, active } = {}) {
    if (!this.callControls) return;

    this.callControls.classList.remove("video-mode");
    this.callControls.classList.add("voice-mode");

    if (this.camBtn) this.camBtn.classList.add("hidden");
    if (this.upgradeBtn) this.upgradeBtn.classList.remove("hidden");

    if (this.answerBtn) {
      this.answerBtn.classList.toggle("hidden", !inbound);
    }
    if (this.declineBtn) {
      this.declineBtn.classList.toggle("hidden", !inbound);
    }
    if (this.endBtn) {
      this.endBtn.classList.toggle("hidden", !active && !outbound);
    }

    if (outbound) {
      if (this.endBtn) this.endBtn.classList.remove("hidden");
    }
  }

  _showControlsForVideo({ outbound, inbound, active } = {}) {
    if (!this.callControls) return;

    this.callControls.classList.remove("voice-mode");
    this.callControls.classList.add("video-mode");

    if (this.camBtn) this.camBtn.classList.remove("hidden");
    if (this.upgradeBtn) this.upgradeBtn.classList.add("hidden");

    if (this.answerBtn) {
      this.answerBtn.classList.toggle("hidden", !inbound);
    }
    if (this.declineBtn) {
      this.declineBtn.classList.toggle("hidden", !inbound);
    }
    if (this.endBtn) {
      this.endBtn.classList.toggle("hidden", !active && !outbound);
    }

    if (outbound) {
      if (this.endBtn) this.endBtn.classList.remove("hidden");
    }
  }

  // -------------------------------------------------------
  // OVERLAY / STATUS
  // -------------------------------------------------------
  _showOverlay(text) {
    if (!this.callerOverlay) return;
    this.callerOverlay.classList.remove("hidden");
    const label = this.callerOverlay.querySelector(".caller-label");
    if (label) label.textContent = text;
  }

  _hideOverlay() {
    if (!this.callerOverlay) return;
    this.callerOverlay.classList.add("hidden");
  }

  _setStatus(text) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text || "";
  }

  // -------------------------------------------------------
  // RINGING / AUDIO CUES
  // -------------------------------------------------------
  _playRingtone() {
    if (!this.ringtone) return;
    this.ringtone.currentTime = 0;
    this.ringtone.loop = true;
    this.ringtone.play().catch(() => {});
  }

  _playRingback() {
    if (!this.ringback) return;
    this.ringback.currentTime = 0;
    this.ringback.loop = true;
    this.ringback.play().catch(() => {});
  }

  _stopRinging() {
    if (this.ringtone) {
      this.ringtone.pause();
      this.ringtone.currentTime = 0;
    }
    if (this.ringback) {
      this.ringback.pause();
      this.ringback.currentTime = 0;
    }
  }

  // -------------------------------------------------------
  // PRIMARY / PIP LAYOUT + DRAG
  // -------------------------------------------------------
  _togglePrimary() {
    this._primaryIsRemote = !this._primaryIsRemote;
    this._applyPrimaryLayout();
  }

  _applyPrimaryLayout() {
    if (!this.remoteWrapper || !this.localWrapper) return;

    if (this._primaryIsRemote) {
      // Remote full, local PiP
      this.remoteWrapper.classList.add("primary");
      this.remoteWrapper.classList.remove("pip");

      this.localWrapper.classList.add("pip");
      this.localWrapper.classList.remove("primary");
    } else {
      // Local full, remote PiP
      this.localWrapper.classList.add("primary");
      this.localWrapper.classList.remove("pip");

      this.remoteWrapper.classList.add("pip");
      this.remoteWrapper.classList.remove("primary");
    }
  }

  _initPipDrag() {
    if (!this.localWrapper || !this.videoContainer) return;

    const pipEl = this.localWrapper;

    const startDrag = (clientX, clientY) => {
      const rect = pipEl.getBoundingClientRect();
      const parentRect = this.videoContainer.getBoundingClientRect();

      this._dragState = {
        offsetX: clientX - rect.left,
        offsetY: clientY - rect.top,
        parentRect,
      };
    };

    const moveDrag = (clientX, clientY) => {
      if (!this._dragState) return;
      const { offsetX, offsetY, parentRect } = this._dragState;

      let x = clientX - offsetX - parentRect.left;
      let y = clientY - offsetY - parentRect.top;

      const maxX = parentRect.width - pipEl.offsetWidth;
      const maxY = parentRect.height - pipEl.offsetHeight;

      x = Math.max(0, Math.min(maxX, x));
      y = Math.max(0, Math.min(maxY, y));

      pipEl.style.transform = `translate(${x}px, ${y}px)`;
    };

    const endDrag = () => {
      this._dragState = null;
    };

    pipEl.addEventListener("pointerdown", (e) => {
      if (!pipEl.classList.contains("pip")) return;
      pipEl.setPointerCapture(e.pointerId);
      startDrag(e.clientX, e.clientY);
    });

    pipEl.addEventListener("pointermove", (e) => {
      if (!this._dragState) return;
      moveDrag(e.clientX, e.clientY);
    });

    pipEl.addEventListener("pointerup", () => endDrag());
    pipEl.addEventListener("pointercancel", () => endDrag());

    // Touch fallback (older browsers)
    pipEl.addEventListener("touchstart", (e) => {
      if (!pipEl.classList.contains("pip")) return;
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
    });

    pipEl.addEventListener("touchmove", (e) => {
      if (!this._dragState) return;
      const t = e.touches[0];
      moveDrag(t.clientX, t.clientY);
    });

    pipEl.addEventListener("touchend", () => endDrag());
    pipEl.addEventListener("touchcancel", () => endDrag());
  }

  // -------------------------------------------------------
  // TIMER + QUALITY
  // -------------------------------------------------------
  _startTimerLoop() {
    const tick = () => {
      if (rtcState.inCall && rtcState.callStartTs && this.timerEl) {
        const elapsed = Date.now() - rtcState.callStartTs;
        this.timerEl.textContent = formatDuration(elapsed);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _startQualityMonitor() {
    // If you later wire stats → this.rtc.onQualityUpdate, UI is already ready.
  }
}
















































