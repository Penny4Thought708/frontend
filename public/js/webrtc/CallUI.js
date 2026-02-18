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
    this.iosCallTimer = document.getElementById("iosCallTimer") || this.root?.querySelector(".ios-call-timer");

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
    this.iosMuteBtn = this.root.querySelector(".ios-btn.mute");
    this.iosSpeakerBtn = this.root.querySelector(".ios-btn.speaker");
    this.iosKeypadBtn = this.root.querySelector(".ios-btn.keypad");
    this.iosAddBtn = this.root.querySelector(".ios-btn.add");
    this.iosVideoBtn = this.root.querySelector(".ios-btn.video");
    this.iosEndBtn = this.root.querySelector(".ios-btn.end");

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
    this._lastControlsMove = Date.now();
    this._controlsHideInterval = null;

    // For video upgrade overlay
    this._pendingVideoUpgrade = null;

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

  if (this._isMobile()) {
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
    this._clearParticipants();
    this._hideVideoUpgradeOverlay();
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

    this._stopControlsAutoHide();
  }
// ============================================================
// CONTROLLER BINDING  (FIXED FOR iOS‑ONLY MOBILE MODE)
// ============================================================

_bindController() {
  const c = this.controller;

  // When the call actually connects
  c.onCallStarted = (peerId) => {
    // Stop audio ONLY here (correct behavior)
    this._stopRingback();
    this._stopRingtone();

    this._onCallStarted(peerId);
  };

  // When the call ends (remote or local)
  c.onCallEnded = (reason) => {
    // Stop audio ONLY here
    this._stopRingback();
    this._stopRingtone();

    this._onCallEnded(reason);
  };

  // When an inbound offer arrives
  c.onIncomingOffer = (peerId, offer) => {
    const isUpgrade =
      rtcState.status === "in-call" &&
      rtcState.incomingIsVideo &&
      rtcState.audioOnly;

    // If already in a call and remote upgrades → show upgrade UI
    if (isUpgrade) {
      this.showVideoUpgradeOverlay(peerId, offer);
      return;
    }

    // Otherwise → inbound ringing
    this.showInboundRinging(peerId, {
      incomingIsVideo: rtcState.incomingIsVideo,
    });
  };

  // When an inbound offer is queued (busy line)
  c.onIncomingOfferQueued = (peerId, offer, callId) => {
    console.log("[CallUI] Incoming offer queued", peerId, callId);
  };

  // Remote peer joins (track arrives)
  c.onRemoteJoin = (peerId) => {
    // Desktop only — mobile iOS mode hides grid
    if (!this._isMobile()) {
      this._ensureRemoteTile(peerId);
      this._recomputeGridLayout();
    }
  };

  // Remote peer leaves
  c.onRemoteLeave = (peerId) => {
    if (!this._isMobile()) {
      this._removeRemoteTile(peerId);
      this._recomputeGridLayout();
    }
  };

  // Participant metadata update (speaking, presenting, name)
  c.onParticipantUpdate = (peerId, data) => {
    if (!this._isMobile()) {
      this._updateParticipantTile(peerId, data);
      this._recomputeGridLayout();
    }
  };

  // Screen share events (desktop only)
  c.onScreenShareStarted = () => {
    if (!this._isMobile()) this._onScreenShareStarted();
  };

  c.onScreenShareStopped = () => {
    if (!this._isMobile()) this._onScreenShareStopped();
  };

  // Quality indicator
  c.onQualityUpdate = (level) => this._updateQualityIndicator(level);

  // Status changes (ringing, in-call, on-hold)
  c.onCallStatusChange = (status) => this._onCallStatusChange(status);

  // Busy, unavailable, timeout, decline
  c.onPeerUnavailable = (reason) => {
    // Stop audio ONLY here
    this._stopRingback();
    this._stopRingtone();

    this._onPeerUnavailable(reason);
  };

  // Remote upgrades audio → video
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
        if (this.callControls) {
          this.callControls.classList.add("active");
        }
        this._resetControlsTimer();
        this._startControlsAutoHide();
      });
    }

    if (this.endCallBtn) {
      this.endCallBtn.addEventListener("click", () => {
        this.controller.endCall("local_hangup");
      });
    }

    if (this.muteBtn) {
      this.muteBtn.addEventListener("click", () => this._toggleMute());
    }

    if (this.cameraToggleBtn) {
      this.cameraToggleBtn.addEventListener("click", () => this._toggleCamera());
    }

    if (this.moreControlsBtn && this.moreControlsMenu) {
      this.moreControlsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggleMoreControlsMenu();
      });

      document.addEventListener("click", (e) => {
        if (
          this.moreControlsMenu &&
          !this.moreControlsMenu.contains(e.target) &&
          e.target !== this.moreControlsBtn
        ) {
          this._hideMoreControlsMenu();
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
        this._acceptVideoUpgrade()
      );
    }
    if (this.videoUpgradeDeclineMobile) {
      this.videoUpgradeDeclineMobile.addEventListener("click", () =>
        this._declineVideoUpgrade()
      );
    }
    if (this.videoUpgradeAcceptDesktop) {
      this.videoUpgradeAcceptDesktop.addEventListener("click", () =>
        this._acceptVideoUpgrade()
      );
    }
    if (this.videoUpgradeDeclineDesktop) {
      this.videoUpgradeDeclineDesktop.addEventListener("click", () =>
        this._declineVideoUpgrade()
      );
    }

    if (this.localPip && this.enablePipSwap) {
      this.localPip.addEventListener("dblclick", () => this._swapPipWithMain());
      this.localPip.addEventListener("touchend", (e) => {
        if (e.detail === 2) this._swapPipWithMain();
      });
    }
    if (this.iosMuteBtn) {
      this.iosMuteBtn.addEventListener("click", () => this._toggleMute());
    }
    
    if (this.iosSpeakerBtn) {
      this.iosSpeakerBtn.addEventListener("click", () => this._toggleSpeaker());
    }
    
    if (this.iosKeypadBtn) {
      this.iosKeypadBtn.addEventListener("click", () => this._openKeypad());
    }
    
    if (this.iosAddBtn) {
      this.iosAddBtn.addEventListener("click", () => this._addCall());
    }
    
    if (this.iosVideoBtn) {
      this.iosVideoBtn.addEventListener("click", () => this._upgradeToVideo());
    }
    
    if (this.iosEndBtn) {
      this.iosEndBtn.addEventListener("click", () => this.controller.endCall("local_hangup"));
    }

    // Auto-hide controls
    const showControls = () => {
      if (!this.callControls) return;
      this.callControls.classList.remove("hidden-soft");
    };
    const hideControls = () => {
      if (!this.callControls) return;
      this.callControls.classList.add("hidden-soft");
    };

    this._showControls = showControls;
    this._hideControls = hideControls;

    if (this.callBody) {
      this.callBody.addEventListener("mousemove", () => {
        this._resetControlsTimer();
        showControls();
      });
      this.callBody.addEventListener("touchstart", () => {
        this._resetControlsTimer();
        showControls();
      });
    }
  }

  _startControlsAutoHide() {
    if (this._controlsHideInterval) return;
    this._controlsHideInterval = setInterval(() => {
      if (!this.callControls) return;
      if (Date.now() - this._lastControlsMove > 4000) {
        this._hideControls?.();
      }
    }, 1000);
  }

  _stopControlsAutoHide() {
    if (this._controlsHideInterval) {
      clearInterval(this._controlsHideInterval);
      this._controlsHideInterval = null;
    }
  }
_toggleMute() {
  const stream = rtcState.localStream;
  if (!stream) return;

  this.isMuted = !this.isMuted;
  stream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);

  if (this.iosMuteBtn) {
    this.iosMuteBtn.classList.toggle("active", this.isMuted);
  }
}
_toggleSpeaker() {
  if (!this.remoteAudio) return;

  this.remoteAudio.muted = !this.remoteAudio.muted;

  if (this.iosSpeakerBtn) {
    this.iosSpeakerBtn.classList.toggle("active", !this.remoteAudio.muted);
  }
}
_openKeypad() {
  console.log("Keypad pressed — implement keypad UI here");
}
_addCall() {
  console.log("Add Call pressed — implement call merging here");
}
_upgradeToVideo() {
  this.controller.upgradeToVideo();
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
    this._resetControlsTimer();
    this._startControlsAutoHide();

    if (this.localTile) {
      this.localTile.classList.add("hidden");
    }
    if (this._isMobile()) {
      if (this.callControls) this.callControls.classList.add("hidden");
    }

    if (this.callControls) {
      this.callControls.classList.remove("hidden");
      this.callControls.classList.remove("hidden-soft");
      this.callControls.classList.add("active");
    }

    this._setInboundButtonsVisible(false);

    if (this.currentMode === "meet" || this.currentMode === "discord") {
      this._ensureRemoteTile(peerId);
      this._showLocalPip(true);
    }

    if (this.currentMode === "ios-voice") {
      this._updateIosVoiceStatus("Connected");
    }
  }

  _onCallEnded(reason) {
    this._stopRingback();
    this._stopRingtone();

    this._stopTimer();
    this._setStatusText("Call ended");

    if (this.currentMode === "ios-voice") {
      this._updateIosVoiceStatus("Call ended");
    }

    setTimeout(() => this.closeWindow(), 800);
  }

  _onCallStatusChange(status) {
    switch (status) {
      case "ringing":
        this._setStatusText("Ringing…");
        if (this.currentMode === "ios-voice") {
          this._updateIosVoiceStatus("Calling…");
        }
        break;
      case "in-call":
        this._setStatusText("Connected");
        if (this.currentMode === "ios-voice") {
          this._updateIosVoiceStatus("Connected");
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
      this._updateIosVoiceStatus(reason || "User unavailable");
    }

    setTimeout(() => this.closeWindow(), 1200);
  }

  _enterActiveVideoMode() {
    if (this.currentMode === "ios-voice") {
      this._setMode("meet", { audioOnly: false });
      this._showLocalPip(true);
      this._updateIosVoiceStatus("");
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

  _resetControlsTimer() {
    this._lastControlsMove = Date.now();
    if (this.callControls) {
      this.callControls.classList.remove("hidden-soft");
    }
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

    this.root.classList.remove("mode-meet", "mode-discord", "mode-ios-voice");
    if (this._isMobile()) {
      if (this.callControls) this.callControls.classList.add("hidden");
      if (this.localPip) this.localPip.classList.add("hidden");
      if (this.remotePip) this.remotePip.classList.add("hidden");
    }

    if (mode === "meet") {
      this.root.classList.add("mode-meet");
    } else if (mode === "discord") {
      this.root.classList.add("mode-discord");
    } else if (mode === "ios-voice") {
      this.root.classList.add("mode-ios-voice");
    }

    if (audioOnly) {
      this.root.classList.add("voice-only-call", "camera-off");
    } else {
      this.root.classList.remove("voice-only-call", "camera-off");
    }

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
      this.callControls.classList.add("inbound");
      this.callControls.classList.remove("active");

      if (this.answerBtn) this.answerBtn.classList.remove("hidden");
      if (this.declineBtn) this.declineBtn.classList.remove("hidden");
      if (this.endCallBtn) this.endCallBtn.classList.add("hidden");
    } else {
      this.callControls.classList.remove("inbound");
      this.callControls.classList.add("active");

      if (this.answerBtn) this.answerBtn.classList.add("hidden");
      if (this.declineBtn) this.declineBtn.classList.add("hidden");
      if (this.endCallBtn) this.endCallBtn.classList.remove("hidden");
    }
  }

  _setInboundButtonsVisible(show) {
    if (!this.callControls) return;
    if (show) {
      this.callControls.classList.add("inbound");
      this.callControls.classList.remove("active");
    } else {
      this.callControls.classList.remove("inbound");
      this.callControls.classList.add("active");
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

    if (this.callControls) {
      this.callControls.classList.remove("hidden");
      this.callControls.classList.remove("hidden-soft");
    }
    if (this._isMobile()) {
      if (this.callControls) this.callControls.classList.add("hidden");
    }

    setTimeout(() => {
      this.root.classList.remove("call-opening");
    }, 260);
  }

  // ============================================================
  // TIMER HELPERS
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
  // GRID + PARTICIPANTS
  // ============================================================

  _ensureRemoteTile(peerId) {
    if (!this.callGrid) return null;
    const id = String(peerId);

    if (this.remoteTiles.has(id)) {
      return this.remoteTiles.get(id);
    }

    let el;
    if (this.remoteTemplate && "content" in this.remoteTemplate) {
      const clone = this.remoteTemplate.content
        ? this.remoteTemplate.content.cloneNode(true)
        : this.remoteTemplate.cloneNode(true);
      el = clone.querySelector(".participant") || clone.firstElementChild;
      if (!el) {
        el = document.createElement("div");
        el.className = "participant remote";
      }
      this.callGrid.appendChild(el);
    } else {
      el = document.createElement("div");
      el.className = "participant remote";
      el.innerHTML = `
        <div class="media-wrapper">
          <video class="remoteVideo" autoplay playsinline></video>
          <div class="avatar-wrapper">
            <div class="voice-pulse"></div>
          </div>
          <div class="presenting-badge">Presenting</div>
          <div class="name-tag"></div>
        </div>
      `;
      this.callGrid.appendChild(el);
    }

    const videoEl = el.querySelector("video.remoteVideo") || el.querySelector("video");
    const avatarWrapper = el.querySelector(".avatar-wrapper");
    const nameTag = el.querySelector(".name-tag");

    const tile = { el, videoEl, avatarWrapper, nameTag };
    this.remoteTiles.set(id, tile);

    return tile;
  }

  _removeRemoteTile(peerId) {
    const id = String(peerId);
    const tile = this.remoteTiles.get(id);
    if (!tile) return;
    if (tile.el && tile.el.parentNode) {
      tile.el.parentNode.removeChild(tile.el);
    }
    this.remoteTiles.delete(id);
  }

  _recomputeGridLayout() {
    // For now, CSS auto-fit grid handles layout.
    // Hook left here for future advanced layouts.
  }

  _updateParticipantTile(peerId, data) {
    if (!data) {
      this._removeRemoteTile(peerId);
      return;
    }
    const tile = this._ensureRemoteTile(peerId);
    if (!tile) return;

    if (tile.nameTag && data.displayName) {
      tile.nameTag.textContent = data.displayName;
    }

    if (tile.el) {
      if (data.isPresenting) {
        tile.el.classList.add("is-presenting");
      } else {
        tile.el.classList.remove("is-presenting");
      }

      if (data.speaking) {
        tile.el.classList.add("speaking");
      } else {
        tile.el.classList.remove("speaking");
      }
    }
  }

  _clearParticipants() {
    this.remoteTiles.forEach((tile) => {
      if (tile.el && tile.el.parentNode) {
        tile.el.parentNode.removeChild(tile.el);
      }
    });
    this.remoteTiles.clear();
  }

  // ============================================================
  // QUALITY INDICATOR
  // ============================================================

  _updateQualityIndicator(level) {
    if (!this.qualityIndicator) return;
    this.qualityIndicator.dataset.level = level || "excellent";
    this.qualityIndicator.textContent = `Connection: ${level || "excellent"}`;
  }

  // ============================================================
  // VIDEO UPGRADE OVERLAY
  // ============================================================

  showVideoUpgradeOverlay(peerId, offer) {
    this._pendingVideoUpgrade = { peerId, offer };
    if (!this.videoUpgradeOverlay) return;
    this.videoUpgradeOverlay.classList.remove("hidden");
  }

  _hideVideoUpgradeOverlay() {
    if (!this.videoUpgradeOverlay) return;
    this.videoUpgradeOverlay.classList.add("hidden");
    this._pendingVideoUpgrade = null;
  }

  async _acceptVideoUpgrade() {
    if (!this._pendingVideoUpgrade) {
      this._hideVideoUpgradeOverlay();
      return;
    }
    // For upgrade, controller.answerCall() already knows rtcState.incomingOffer
    await this.controller.answerCall();
    this._enterActiveVideoMode();
    this._hideVideoUpgradeOverlay();
  }

  _declineVideoUpgrade() {
    // For now, just hide overlay and stay audio-only.
    this._hideVideoUpgradeOverlay();
  }

  // ============================================================
  // CONTROLS HELPERS
  // ============================================================

  _toggleMute() {
    const stream = rtcState.localStream;
    if (!stream) return;

    this.isMuted = !this.isMuted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !this.isMuted;
    });

    if (this.muteBtn) {
      this.muteBtn.classList.toggle("active", this.isMuted);
    }
  }

  _toggleCamera() {
    const stream = rtcState.localStream;
    if (!stream) return;

    this.isCameraOn = !this.isCameraOn;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = this.isCameraOn;
    });

    if (this.cameraToggleBtn) {
      this.cameraToggleBtn.classList.toggle("active", !this.isCameraOn);
    }

    if (this.root) {
      if (this.isCameraOn) {
        this.root.classList.remove("camera-off");
      } else {
        this.root.classList.add("camera-off");
      }
    }
  }

  _toggleMoreControlsMenu() {
    if (!this.moreControlsMenu) return;
    this.moreControlsMenu.classList.toggle("hidden");
  }

  _hideMoreControlsMenu() {
    if (!this.moreControlsMenu) return;
    this.moreControlsMenu.classList.add("hidden");
  }

  _showLocalPip(show) {
    if (!this.localPip) return;
    if (show) {
      this.localPip.classList.remove("hidden");
      this._attachLocalStreamFromState();
    } else {
      this.localPip.classList.add("hidden");
    }
  }

  _swapPipWithMain() {
    if (!this.localPipVideo || !this.localVideo) return;

    const mainStream = this.localVideo.srcObject;
    const pipStream = this.localPipVideo.srcObject;

    this.localVideo.srcObject = pipStream;
    this.localPipVideo.srcObject = mainStream;

    if (this.localVideo.srcObject) {
      this.localVideo.play?.().catch(() => {});
    }
    if (this.localPipVideo.srcObject) {
      this.localPipVideo.play?.().catch(() => {});
    }
  }

  _updateIosVoiceStatus(text) {
    if (this.iosCallStatus) {
      this.iosCallStatus.textContent = text || "";
    }
  }

  // ============================================================
  // UTIL
  // ============================================================

  _isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }
}















