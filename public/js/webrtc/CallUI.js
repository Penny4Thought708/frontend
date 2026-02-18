// public/js/webrtc/CallUI.js
// High-performance, production-grade call window UI
// - Mobile: iOS voice + FaceTime-style PiP
// - Web: Google Meet-style layout
// - Group: Discord-style grid

import { WebRTCController } from "./WebRTCController.js";
import { rtcState } from "./WebRTCState.js";

export class CallUI {
  constructor(socket, options = {}) {
    this.rtc = new WebRTCController(socket);
    this.controller = this.rtc;

    this.enablePipSwap = options.enablePipSwap ?? true;

    // DOM refs
    this.root = document.getElementById("callWindow");
    this.callBody = this.root?.querySelector(".call-body");
    this.callGrid = document.getElementById("callGrid");

    this.localTile = document.getElementById("localParticipant");
    this.localVideo = document.getElementById("localVideo");
    this.localAvatarImg = document.getElementById("localAvatarImg");

    this.remoteTemplate = document.getElementById("remoteParticipantTemplate");

    this.localPip = document.getElementById("localPip");
    this.localPipVideo = document.getElementById("localPipVideo");

    this.remotePip = document.getElementById("remotePip");
    this.remotePipVideo = document.getElementById("remotePipVideo");

    this.iosVoiceUI = this.root?.querySelector(".ios-voice-ui");
    this.iosVoiceAvatar = document.getElementById("iosVoiceAvatar");
    this.iosCallStatus = this.root?.querySelector(".ios-call-status");
    this.iosCallTimer = this.root?.querySelector(".ios-call-timer");

    this.callStatusEl = document.getElementById("call-status");
    this.callTimerEl = document.getElementById("call-timer");

    this.callControls = document.getElementById("call-controls");
    this.declineBtn = document.getElementById("decline-call");
    this.answerBtn = document.getElementById("answer-call");
    this.muteBtn = document.getElementById("mute-call");
    this.cameraToggleBtn = document.getElementById("camera-toggle");
    this.endCallBtn = document.getElementById("end-call");

    this.moreControlsBtn = document.getElementById("more-controls-btn");
    this.moreControlsMenu = document.getElementById("more-controls-menu");
    this.shareScreenBtn = document.getElementById("share-screen");
    this.aiNoiseBtn = document.getElementById("ai-noise-toggle");
    this.recordCallBtn = document.getElementById("record-call");
    this.callHistoryToggleBtn = document.getElementById("call-history-toggle");

    this.remoteAudio = document.getElementById("remoteAudio");

    this.qualityIndicator = document.getElementById("call-quality-indicator");
    this.debugToggle = document.getElementById("call-debug-toggle");

    this.videoUpgradeOverlay = document.getElementById("video-upgrade-overlay");
    this.videoUpgradeAcceptMobile = document.getElementById("video-upgrade-accept");
    this.videoUpgradeDeclineMobile = document.getElementById("video-upgrade-decline");
    this.videoUpgradeAcceptDesktop = document.getElementById("video-upgrade-accept-desktop");
    this.videoUpgradeDeclineDesktop = document.getElementById("video-upgrade-decline-desktop");

    // Audio elements
    this.ringtone = document.getElementById("ringtone");
    this.ringback = document.getElementById("ringback");

    // Internal state
    this.currentMode = "meet";
    this.callTimerInterval = null;
    this.callStartTs = null;
    this.isMuted = false;
    this.isCameraOn = true;
    this.isScreenSharing = false;
    this.isInbound = false;

    // PiP drag state
    this.pipDragState = {
      active: false,
      target: null,
      startX: 0,
      startY: 0,
      origX: 0,
      origY: 0,
    };

    this.remoteTiles = new Map();

    this._bindController();
    this._bindUI();
    this._bindPipDrag();
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  openForOutgoing(peerId, { audio = true, video = true, mode = "meet" } = {}) {
    this.isInbound = false;
    this._setMode(mode, { audioOnly: audio && !video });
    this._openWindow();
    this._setInboundActiveState(false);

    this._playRingback();
    this._setStatusText("Calling…");
    this._startTimer(null);

    this.controller.startCall(peerId, { audio, video });
  }

  receiveInboundCall(peerId, isVideo) {
    this.showInboundRinging(peerId, {
      incomingIsVideo: !!isVideo,
    });
  }
_setStatusText(text) {
  if (this.callStatusEl) {
    this.callStatusEl.textContent = text || "";
  }

  if (this.iosCallStatus) {
    this.iosCallStatus.textContent = text || "";
  }
}

  showInboundRinging(peerId, { incomingIsVideo, modeHint } = {}) {
    this.isInbound = true;

    this._playRingtone();

    const audioOnly = !incomingIsVideo;
    let mode = modeHint || "meet";

    if (this._isMobile() && audioOnly) {
      mode = "ios-voice";
    }

    this._setMode(mode, { audioOnly });
    this._openWindow();
    this._setInboundActiveState(true);

    this._setStatusText("Incoming call…");
    this._startTimer(null);
  }

  closeWindow() {
    this._stopTimer();
    this._clearParticipants?.();
    this._hideVideoUpgradeOverlay?.();
    this._setStatusText("Idle");
    this._setMode("meet", { audioOnly: false });

    this._stopRingtone();
    this._stopRingback();

    if (!this.root) return;

    this.root.classList.remove("is-open", "call-opening");
    this.root.classList.add("hidden");
    this.root.style.opacity = "0";

    if (this.callControls) {
      this.callControls.classList.add("hidden");
      this.callControls.classList.remove("inbound", "active");
    }

    if (this.localTile) {
      this.localTile.classList.add("hidden");
    }
  }

  // ============================================================
  // CONTROLLER BINDING
  // ============================================================

  _bindController() {
    const c = this.controller;

    c.onCallStarted = (peerId) => this._onCallStarted(peerId);
    c.onCallEnded = (reason) => this._onCallEnded(reason);
    c.onIncomingOffer = (peerId, offer) => {
      const isUpgrade =
        rtcState.status === "in-call" &&
        rtcState.incomingIsVideo &&
        rtcState.audioOnly;

      if (isUpgrade) {
        this.showVideoUpgradeOverlay?.(peerId, offer);
      } else {
        this.showInboundRinging(peerId, {
          incomingIsVideo: rtcState.incomingIsVideo,
        });
      }
    };

    c.onIncomingOfferQueued = (peerId, offer, callId) => {
      console.log("[CallUI] Incoming offer queued", peerId, callId);
    };

    c.onRemoteJoin = (peerId) => {
      this._ensureRemoteTile?.(peerId);
      this._recomputeGridLayout?.();
    };

    c.onRemoteLeave = (peerId) => {
      this._removeRemoteTile?.(peerId);
      this._recomputeGridLayout?.();
    };

    c.onParticipantUpdate = (peerId, data) => {
      this._updateParticipantTile?.(peerId, data);
      this._recomputeGridLayout?.();
    };

    c.onScreenShareStarted = () => this._onScreenShareStarted();
    c.onScreenShareStopped = () => this._onScreenShareStopped();
    c.onQualityUpdate = (level) => this._updateQualityIndicator?.(level);
    c.onCallStatusChange = (status) => this._onCallStatusChange(status);
    c.onPeerUnavailable = (reason) => this._onPeerUnavailable(reason);
    c.onRemoteUpgradedToVideo = () => this._enterActiveVideoMode();
  }

  // ============================================================
  // UI BINDING
  // ============================================================

  _bindUI() {
    if (this.declineBtn) {
      this.declineBtn.addEventListener("click", () => {
        this._stopRingtone();
        this.controller.declineCall("declined");
        this._setStatusText("Declined");
      });
    }

    if (this.answerBtn) {
      this.answerBtn.addEventListener("click", async () => {
        this._stopRingtone();
        await this.controller.answerCall();
        this._setInboundActiveState(false);
      });
    }

    if (this.endCallBtn) {
      this.endCallBtn.addEventListener("click", () => {
        this.controller.endCall("local_hangup");
      });
    }

    if (this.muteBtn) {
      this.muteBtn.addEventListener("click", () => this._toggleMute?.());
    }

    if (this.cameraToggleBtn) {
      this.cameraToggleBtn.addEventListener("click", () => this._toggleCamera?.());
    }

    if (this.moreControlsBtn && this.moreControlsMenu) {
      this.moreControlsBtn.addEventListener("click", () => {
        this._toggleMoreControlsMenu?.();
      });

      document.addEventListener("click", (e) => {
        if (
          !this.moreControlsMenu.contains(e.target) &&
          e.target !== this.moreControlsBtn
        ) {
          this._hideMoreControlsMenu?.();
        }
      });
    }

    if (this.shareScreenBtn) {
      this.shareScreenBtn.addEventListener("click", async () => {
        if (!this.isScreenSharing) {
          const ok = await this.controller.startScreenShare();
          if (ok) this.isScreenSharing = true;
        } else {
          await this.controller.stopScreenShare();
          this.isScreenSharing = false;
        }
      });
    }

    if (this.aiNoiseBtn) {
      this.aiNoiseBtn.addEventListener("click", () => {
        this.aiNoiseBtn.classList.toggle("active");
      });
    }

    if (this.recordCallBtn) {
      this.recordCallBtn.addEventListener("click", () => {
        this.recordCallBtn.classList.toggle("active");
      });
    }

    if (this.callHistoryToggleBtn) {
      this.callHistoryToggleBtn.addEventListener("click", () => {
        console.log("[CallUI] Call history toggle clicked");
      });
    }

    if (this.videoUpgradeAcceptMobile) {
      this.videoUpgradeAcceptMobile.addEventListener("click", () =>
        this._acceptVideoUpgrade?.()
      );
    }
    if (this.videoUpgradeDeclineMobile) {
      this.videoUpgradeDeclineMobile.addEventListener("click", () =>
        this._declineVideoUpgrade?.()
      );
    }
    if (this.videoUpgradeAcceptDesktop) {
      this.videoUpgradeAcceptDesktop.addEventListener("click", () =>
        this._acceptVideoUpgrade?.()
      );
    }
    if (this.videoUpgradeDeclineDesktop) {
      this.videoUpgradeDeclineDesktop.addEventListener("click", () =>
        this._declineVideoUpgrade?.()
      );
    }

    if (this.localPip && this.enablePipSwap) {
      this.localPip.addEventListener("dblclick", () => this._swapPipWithMain?.());
      this.localPip.addEventListener("touchend", (e) => {
        if (e.detail === 2) this._swapPipWithMain?.();
      });
    }

    // Auto-hide controls
    let lastMove = Date.now();
    const showControls = () => {
      if (!this.callControls) return;
      this.callControls.classList.remove("hidden-soft");
    };
    const hideControls = () => {
      if (!this.callControls) return;
      this.callControls.classList.add("hidden-soft");
    };

    if (this.callBody) {
      this.callBody.addEventListener("mousemove", () => {
        lastMove = Date.now();
        showControls();
      });
      this.callBody.addEventListener("touchstart", () => {
        lastMove = Date.now();
        showControls();
      });

      setInterval(() => {
        if (!this.callControls) return;
        if (Date.now() - lastMove > 4000) hideControls();
      }, 1000);
    }
  }

  // ============================================================
  // PIP DRAGGING
  // ============================================================

  _bindPipDrag() {
    const startDrag = (el, evt) => {
      evt.preventDefault();
      const rect = el.getBoundingClientRect();
      this.pipDragState.active = true;
      this.pipDragState.target = el;
      this.pipDragState.startX = evt.clientX || evt.touches?.[0]?.clientX || 0;
      this.pipDragState.startY = evt.clientY || evt.touches?.[0]?.clientY || 0;
      this.pipDragState.origX = rect.left;
      this.pipDragState.origY = rect.top;
      el.classList.add("dragging");
    };

    const moveDrag = (evt) => {
      if (!this.pipDragState.active || !this.pipDragState.target) return;
      const el = this.pipDragState.target;
      const currentX = evt.clientX || evt.touches?.[0]?.clientX || 0;
      const currentY = evt.clientY || evt.touches?.[0]?.clientY || 0;
      const dx = currentX - this.pipDragState.startX;
      const dy = currentY - this.pipDragState.startY;
      const x = this.pipDragState.origX + dx;
      const y = this.pipDragState.origY + dy;

      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    const endDrag = () => {
      if (!this.pipDragState.active || !this.pipDragState.target) return;
      const el = this.pipDragState.target;
      this.pipDragState.active = false;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const snapLeft = centerX < vw / 2;
      const snapTop = centerY < vh / 2;

      const x = snapLeft ? 20 : vw - rect.width - 20;
      const y = snapTop ? 20 : vh - rect.height - 20;

      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      el.classList.remove("dragging");
    };

    const attachDragHandlers = (el) => {
      if (!el) return;
      el.addEventListener("mousedown", (e) => startDrag(el, e));
      el.addEventListener("touchstart", (e) => startDrag(el, e), {
        passive: false,
      });
    };

    attachDragHandlers(this.localPip);
    attachDragHandlers(this.remotePip);

    window.addEventListener("mousemove", moveDrag);
    window.addEventListener("touchmove", moveDrag, { passive: false });
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);
  }

  // ============================================================
  // CONTROLLER EVENT HANDLERS
  // ============================================================

  _onCallStarted(peerId) {
    this._stopRingback();
    this._stopRingtone();

    this._setInboundActiveState(false);
    this._setStatusText("Connected");
    this._startTimer(Date.now());
    this._openWindow();

    this._attachLocalStreamFromState();

    if (this.localTile) {
      this.localTile.classList.add("hidden");
    }

    if (this.callControls) {
      this.callControls.classList.remove("hidden");
      this.callControls.classList.remove("hidden-soft");
    }

    this._setInboundButtonsVisible?.(false);

    if (this.currentMode === "meet" || this.currentMode === "discord") {
      this._ensureRemoteTile?.(peerId);
      this._showLocalPip?.(true);
    }

    if (this.currentMode === "ios-voice") {
      this._updateIosVoiceStatus?.("Connected");
    }
  }

  _onCallEnded(reason) {
    this._stopRingback();
    this._stopRingtone();

    this._stopTimer();
    this._setStatusText("Call ended");

    if (this.currentMode === "ios-voice") {
      this._updateIosVoiceStatus?.("Call ended");
    }

    setTimeout(() => this.closeWindow(), 800);
  }

  _onCallStatusChange(status) {
    switch (status) {
      case "ringing":
        this._setStatusText("Ringing…");
        if (this.currentMode === "ios-voice") {
          this._updateIosVoiceStatus?.("Calling…");
        }
        break;
      case "in-call":
        this._setStatusText("Connected");
        if (this.currentMode === "ios-voice") {
          this._updateIosVoiceStatus?.("Connected");
        }
        break;
      case "on-hold":
        this._setStatusText("On hold");
        break;
      default:
        this._setStatusText("Idle");
        break;
    }
  }

  _onScreenShareStarted() {
    this.isScreenSharing = true;

    if (this.localTile) {
      this.localTile.classList.add("presenting", "stage");
    }

    this.remoteTiles.forEach((tile) => tile.el.classList.add("filmstrip"));

    if (this.callGrid) {
      this.callGrid.classList.add("screen-share-mode");
    }
  }

  _onScreenShareStopped() {
    this.isScreenSharing = false;

    if (this.localTile) {
      this.localTile.classList.remove("presenting", "stage");
    }

    this.remoteTiles.forEach((tile) => tile.el.classList.remove("filmstrip"));

    if (this.callGrid) {
      this.callGrid.classList.remove("screen-share-mode");
    }
  }

  _onPeerUnavailable(reason) {
    this._stopRingback();
    this._stopRingtone();

    this._setStatusText(reason || "User unavailable");

    if (this.currentMode === "ios-voice") {
      this._updateIosVoiceStatus?.(reason || "User unavailable");
    }

    setTimeout(() => this.closeWindow(), 1200);
  }

  _enterActiveVideoMode() {
    if (this.currentMode === "ios-voice") {
      this._setMode("meet", { audioOnly: false });
      this._showLocalPip?.(true);
      this._updateIosVoiceStatus?.("");
    }
  }

  // ============================================================
  // AUDIO HELPERS
  // ============================================================

  _playRingtone() {
    try {
      this._stopRingback();
      if (this.ringtone) {
        this.ringtone.currentTime = 0;
        this.ringtone.play().catch(() => {});
      }
    } catch {}
  }

  _stopRingtone() {
    try {
      if (this.ringtone) {
        this.ringtone.pause();
        this.ringtone.currentTime = 0;
      }
    } catch {}
  }

  _playRingback() {
    try {
      this._stopRingtone();
      if (this.ringback) {
        this.ringback.currentTime = 0;
        this.ringback.play().catch(() => {});
      }
    } catch {}
  }

  _stopRingback() {
    try {
      if (this.ringback) {
        this.ringback.pause();
        this.ringback.currentTime = 0;
      }
    } catch {}
  }

  // ============================================================
  // LOCAL MEDIA ATTACH
  // ============================================================

  _attachLocalStreamFromState() {
    const stream = rtcState.localStream;
    if (!stream) return;

    const attach = (el) => {
      if (!el) return;
      if (el.srcObject === stream) return;
      el.srcObject = stream;
      el.muted = true;
      el.playsInline = true;
      el.autoplay = true;
      el.play?.().catch(() => {});
    };

    attach(this.localVideo);
    attach(this.localPipVideo);
  }

  // ============================================================
  // MODE + LAYOUT
  // ============================================================

  _setMode(mode, { audioOnly = false } = {}) {
    this.currentMode = mode;

    if (!this.root || !this.callGrid) return;

    // Remove old mode classes
    this.root.classList.remove("mode-meet", "mode-discord", "mode-ios-voice");

    // Add correct mode class
    if (mode === "meet") {
      this.root.classList.add("mode-meet");
    } else if (mode === "discord") {
      this.root.classList.add("mode-discord");
    } else if (mode === "ios-voice") {
      this.root.classList.add("mode-ios-voice");
    }

    // Audio-only state
    if (audioOnly) {
      this.root.classList.add("voice-only-call", "camera-off");
    } else {
      this.root.classList.remove("voice-only-call", "camera-off");
    }

    // iOS voice UI visibility
    if (this.iosVoiceUI) {
      if (mode === "ios-voice") {
        this.iosVoiceUI.classList.remove("hidden");
      } else {
        this.iosVoiceUI.classList.add("hidden");
      }
    }
  }
_setInboundActiveState(isInbound) {
  this.isInbound = isInbound;

  if (!this.callControls) return;

  if (isInbound) {
    // Inbound call → show Answer + Decline, hide End Call
    this.callControls.classList.add("inbound");

    if (this.answerBtn) this.answerBtn.classList.remove("hidden");
    if (this.declineBtn) this.declineBtn.classList.remove("hidden");
    if (this.endCallBtn) this.endCallBtn.classList.add("hidden");
  } else {
    // Outbound or connected → hide Answer/Decline, show End Call
    this.callControls.classList.remove("inbound");

    if (this.answerBtn) this.answerBtn.classList.add("hidden");
    if (this.declineBtn) this.declineBtn.classList.add("hidden");
    if (this.endCallBtn) this.endCallBtn.classList.remove("hidden");
  }
}

_setStatusText(text) {
  if (this.callStatusEl) {
    this.callStatusEl.textContent = text || "";
  }
  if (this.iosCallStatus) {
    this.iosCallStatus.textContent = text || "";
  }
}


  // ============================================================
  // WINDOW OPEN/CLOSE
  // ============================================================

  _openWindow() {
    if (!this.root) return;

    this.root.classList.remove("hidden");
    this.root.classList.add("is-open", "call-opening");
    this.root.style.opacity = "1";

    // Ensure controls are visible
    if (this.callControls) {
      this.callControls.classList.remove("hidden");
      this.callControls.classList.remove("hidden-soft");
    }

    setTimeout(() => {
      this.root.classList.remove("call-opening");
    }, 260);
  }
// ============================================================
// TIMER HELPERS (REQUIRED)
// ============================================================
_startTimer(startTs) {
  this._stopTimer();
  this.callStartTs = startTs || Date.now();

  const update = () => {
    const elapsed = Math.floor((Date.now() - this.callStartTs) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    const text = `${m}:${s}`;

    if (this.callTimerEl) this.callTimerEl.textContent = text;
    if (this.iosCallTimer) this.iosCallTimer.textContent = text;
  };

  update();
  this.callTimerInterval = setInterval(update, 1000);
}

_stopTimer() {
  if (this.callTimerInterval) {
    clearInterval(this.callTimerInterval);
    this.callTimerInterval = null;
  }
}


  // ============================================================
  // UTIL
  // ============================================================

  _isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }
}











