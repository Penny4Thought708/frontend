// public/js/webrtc/CallUI.js
import { WebRTCController } from "./WebRTCController.js";
import { rtcState } from "./WebRTCState.js";

export class CallUI {
  constructor(socket, options = {}) {
    this.rtc = new WebRTCController(socket);
    this.controller = this.rtc;

    this.enablePipSwap = false;
// ============================================================
    // DOM REFS
    // ============================================================
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

    // iOS voice / mobile UI
    this.iosVoiceUI = this.root?.querySelector(".ios-voice-ui");
    this.iosVoiceAvatar = document.getElementById("iosVoiceAvatar");
    this.iosCallStatus = this.root?.querySelector(".ios-call-status");
    this.iosCallTimer =
      document.getElementById("iosCallTimer") ||
      this.root?.querySelector(".ios-call-timer");

    // iOS inline controls
    this.iosMuteBtn = this.root?.querySelector(".ios-btn.mute");
    this.iosSpeakerBtn = this.root?.querySelector(".ios-btn.speaker");
    this.iosKeypadBtn = this.root?.querySelector(".ios-btn.keypad");
    this.iosAddBtn = this.root?.querySelector(".ios-btn.add");
    this.iosVideoBtn = this.root?.querySelector(".ios-btn.video");
    this.iosEndBtn = this.root?.querySelector(".ios-btn.end");

    // iOS inbound controls (mobile incoming call)
    this.iosInboundControls = this.root?.querySelector(".ios-inbound-controls");
    this.iosInboundAnswerBtn = this.root?.querySelector(
      ".ios-inbound-controls .answer"
    );
    this.iosInboundDeclineBtn = this.root?.querySelector(
      ".ios-inbound-controls .decline"
    );

    // Desktop status + timer
    this.callStatusEl = document.getElementById("call-status");
    this.callTimerEl = document.getElementById("call-timer");

    // Desktop controls
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

    // Media elements
    this.remoteAudio = document.getElementById("remoteAudio");

    // Quality + debug
    this.qualityIndicator = document.getElementById("call-quality-indicator");
    this.debugToggle = document.getElementById("call-debug-toggle");

    // Generic video upgrade overlay (desktop + mobile fallback)
    this.videoUpgradeOverlay = document.getElementById("video-upgrade-overlay");
    this.videoUpgradeAcceptMobile = document.getElementById(
      "video-upgrade-accept"
    );
    this.videoUpgradeDeclineMobile = document.getElementById(
      "video-upgrade-decline"
    );
    this.videoUpgradeAcceptDesktop = document.getElementById(
      "video-upgrade-accept-desktop"
    );
    this.videoUpgradeDeclineDesktop = document.getElementById(
      "video-upgrade-decline-desktop"
    );

    // iOS 17-style upgrade overlays (mobile)
    this.iosCallerUpgradeOverlay =
      this.root?.querySelector(".ios-caller-upgrade");
    this.iosCallerUpgradePreview =
      this.root?.querySelector(".ios-caller-preview");
    this.iosCallerUpgradeLabel = this.root?.querySelector(
      ".ios-caller-upgrade-label"
    );
    this.iosCallerUpgradeCancel = this.root?.querySelector(
      ".ios-caller-upgrade-cancel"
    );

    this.iosCalleeUpgradeOverlay =
      this.root?.querySelector(".ios-callee-upgrade");
    this.iosCalleeUpgradePreview =
      this.root?.querySelector(".ios-callee-preview");
    this.iosCalleeUpgradeLabel = this.root?.querySelector(
      ".ios-callee-upgrade-label"
    );
    this.iosCalleeUpgradeAccept = this.root?.querySelector(
      ".ios-callee-upgrade-accept"
    );
    this.iosCalleeUpgradeDecline = this.root?.querySelector(
      ".ios-callee-upgrade-decline"
    );

    // Audio elements
    this.ringtone = document.getElementById("ringtone");
    this.ringback = document.getElementById("ringback");

    // ============================================================
    // INTERNAL STATE
    // ============================================================
    this.currentMode = "meet";
    this.callTimerInterval = null;
    this.callStartTs = null;
    this.isMuted = false;
    this.isCameraOn = true;
    this.isScreenSharing = false;
    this.isInbound = false;

    this._pendingVideoUpgrade = false;

    this.pipDragState = { /* unchanged */ };
    this.remoteTiles = null;
    this._lastControlsMove = Date.now();
    this._controlsHideInterval = null;

    this._bindController();
    this._bindUI();
    this._bindPipDrag();
  }

  // PUBLIC API
  openForOutgoing(peerId, { audio = true, video = true, mode = "meet" } = {}) {
    this.isInbound = false;

    let audioOnly = audio && !video;

    if (this._isMobile() && audioOnly) {
      mode = "ios-voice";
    }

    if (this._isMobile() && mode === "ios-voice") {
      video = false;
      audioOnly = true;
    }

    this._setMode(mode, { audioOnly });
    this._openWindow();
    this._setInboundActiveState(false);

    this._playRingback();
    this._setStatusText("Calling…");
    this._startTimer(null);

    this.controller.startCall(peerId, { audio, video });
  }

  receiveInboundCall(peerId, isVideo) {
    if (this._isMobile()) {
      this._showIosInboundControls(peerId);
      return;
    }

    this.showInboundRinging(peerId, {
      incomingIsVideo: !!isVideo,
    });
  }

  closeWindow() {
    this._stopTimer();
    this._hideVideoUpgradeOverlay();
    this._hideIosUpgradeOverlays();
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

  /* -------------------------------------------------------
     CONTROLLER BINDING
  ------------------------------------------------------- */
  _bindController() {
    const c = this.controller;

    c.onCallStarted = (peerId) => {
      this._stopRingback();
      this._stopRingtone();
      this._onCallStarted(peerId);
    };

    c.onCallEnded = (reason) => {
      this._stopRingback();
      this._stopRingtone();
      this._onCallEnded(reason);
      if (this.isInbound) {
        this.closeWindow();
      }
    };

    c.onIncomingOffer = (peerId, offer, isVideoUpgrade = false) => {
      rtcState.incomingOffer = offer;
      rtcState.incomingIsVideo =
        isVideoUpgrade || offer?.sdp?.includes("m=video");

      const isUpgrade = !!isVideoUpgrade;
      console.log("🔥 onIncomingOffer", { isVideoUpgrade, isUpgrade });

      if (isUpgrade) {
        if (this._isMobile()) {
          this._showCalleeVideoUpgrade(peerId);
        } else {
          this.showVideoUpgradeOverlay(peerId, offer);
        }
        return;
      }

      if (this._isMobile()) {
        this._showIosInboundControls(peerId);
      } else {
        this.showInboundRinging(peerId, {
          incomingIsVideo: rtcState.incomingIsVideo,
        });
      }
    };

    c.onRemoteJoin = () => {};
    c.onParticipantUpdate = () => {};
    c.onRemoteLeave = () => {};

    c.onScreenShareStarted = () => {
      if (!this._isMobile()) this._onScreenShareStarted();
    };

    c.onScreenShareStopped = () => {
      if (!this._isMobile()) this._onScreenShareStopped();
    };

    c.onQualityUpdate = (level) => this._updateQualityIndicator(level);
    c.onCallStatusChange = (status) => this._onCallStatusChange(status);

    c.onPeerUnavailable = (reason) => {
      this._stopRingback();
      this._stopRingtone();
      this._setStatusText("Call failed");
      setTimeout(() => this.closeWindow(), 1200);
    };

    c.onRemoteUpgradedToVideo = () => this._enterActiveVideoMode();
  }

  /* -------------------------------------------------------
     UI BINDING
  ------------------------------------------------------- */
  _bindUI() {
    const isMobile = this._isMobile();

    if (!isMobile) {
      if (this.declineBtn) {
        this.declineBtn.addEventListener("click", () => {
          this._stopRingtone();
          this.controller.declineCall("declined");
          this._setStatusText("Declined");
        });
      }

      if (this.answerBtn) {
        this.answerBtn.addEventListener("click", async () => {
          if (rtcState.status === "in-call") return;
          this._stopRingtone();
          await this.controller.answerCall();
          this._setInboundActiveState(false);
          this.callControls?.classList.add("active");
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
        this.cameraToggleBtn.addEventListener("click", () =>
          this._toggleCamera()
        );
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
    }

    if (isMobile) {
      // iOS controls (unchanged except for answer guard)
      if (this.iosInboundAnswerBtn) {
        this.iosInboundAnswerBtn.addEventListener("click", async () => {
          if (rtcState.status === "in-call") return;
          this._stopRingtone();
          await this.controller.answerCall();
          this._enterActiveVideoMode();
        });
      }

      if (this.iosInboundDeclineBtn) {
        this.iosInboundDeclineBtn.addEventListener("click", () => {
          this._stopRingtone();
          this.controller.declineCall("declined");
          this.closeWindow();
        });
      }

      // iOS video button → upgrade
      if (this.iosVideoBtn) {
        this.iosVideoBtn.addEventListener("click", () => {
          if (!rtcState.inCall) return;

          this.root?.classList.add("ios-upgrade-requested");
          this.isCameraOn = true;
          this.root?.classList.remove("camera-off");

          this._onIosVideoPressed();
        });
      }

      // Caller upgrade cancel
      if (this.iosCallerUpgradeCancel) {
        this.iosCallerUpgradeCancel.addEventListener("click", () => {
          this._hideCallerVideoUpgrade();
          this.root?.classList.remove("ios-upgrade-requested");
          this._pendingVideoUpgrade = false;
        });
      }

      // Callee upgrade accept/decline
      if (this.iosCalleeUpgradeAccept) {
        this.iosCalleeUpgradeAccept.addEventListener("click", async () => {
          await this._acceptVideoUpgrade();
          this.root?.classList.remove("ios-upgrade-pending");
        });
      }

      if (this.iosCalleeUpgradeDecline) {
        this.iosCalleeUpgradeDecline.addEventListener("click", () => {
          this._declineVideoUpgrade();
          this.root?.classList.remove("ios-upgrade-pending");
        });
      }

      // Fallback mobile overlay buttons
      if (this.videoUpgradeAcceptMobile) {
        this.videoUpgradeAcceptMobile.addEventListener("click", async () => {
          await this._acceptVideoUpgrade();
          this.root?.classList.remove("ios-upgrade-pending");
        });
      }
      if (this.videoUpgradeDeclineMobile) {
        this.videoUpgradeDeclineMobile.addEventListener("click", () => {
          this._declineVideoUpgrade();
          this.root?.classList.remove("ios-upgrade-pending");
        });
      }
    }

    // AUTO-HIDE CONTROLS
    const showControls = () => {
      if (!this.callControls) return;
      this.callControls.classList.remove("hidden-soft");
    };

    const hideControls = () => {
      if (!this.callControls) return;
      if (
        this.videoUpgradeOverlay &&
        !this.videoUpgradeOverlay.classList.contains("hidden")
      ) {
        return;
      }
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
    if (this._isMobile()) return;
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

  /* -------------------------------------------------------
     UPGRADE FLOW HELPERS
  ------------------------------------------------------- */
  _onIosVideoPressed() {
    if (!rtcState.inCall) return;
    if (this._pendingVideoUpgrade) return;

    this._pendingVideoUpgrade = true;
    this._upgradeToVideo();

    const waitForVideo = () => {
      const stream = rtcState.localStream;
      if (stream && stream.getVideoTracks().length > 0) {
        this._showCallerVideoUpgrade();
      } else {
        requestAnimationFrame(waitForVideo);
      }
    };

    waitForVideo();
  }

  _upgradeToVideo() {
    this.controller.upgradeToVideo?.();
    this._attachLocalStreamFromState?.();
    this.isCameraOn = true;
    this.root?.classList.remove("camera-off");

    if (!this._isMobile()) {
      this._showCallerVideoUpgradeDesktop();
    }
  }

  async _acceptVideoUpgrade() {
    this._stopRingtone();
    this._hideVideoUpgradeOverlay();
    this._hideCalleeVideoUpgrade();
    this._pendingVideoUpgrade = false;

    this._enterActiveVideoMode();
    this.controller.sendVideoUpgradeAccepted?.();
  }

  _declineVideoUpgrade() {
    this._stopRingtone();
    this._hideVideoUpgradeOverlay();
    this._hideCalleeVideoUpgrade();
    this._pendingVideoUpgrade = false;

    this.controller.sendVideoUpgradeDeclined?.();
  }

  _toggleCamera() {
    this.isCameraOn = !this.isCameraOn;

    const stream = rtcState.localStream;
    if (stream) {
      const track = stream.getVideoTracks()[0];
      if (track) track.enabled = this.isCameraOn;
    }

    this.root?.classList.toggle("camera-off", !this.isCameraOn);
  }

  _onCallStarted(peerId) {
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
      this.callControls?.classList.add("hidden");
    } else {
      this.callControls?.classList.remove("hidden");
      this.callControls?.classList.remove("hidden-soft");
      this.callControls?.classList.add("active");
    }

    this._setInboundButtonsVisible(false);

    if (this.currentMode === "meet" || this.currentMode === "discord") {
      this._showLocalPip(true);
    }

    if (this.currentMode === "ios-voice") {
      this._updateIosVoiceStatus("Connected");
    }
  }

  _onCallEnded(reason) {
    this._stopTimer();
    this._setStatusText("Call ended");

    if (this.currentMode === "ios-voice") {
      this._updateIosVoiceStatus("Call ended");
    }

    this._hideIosUpgradeOverlays();

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

    if (this.callGrid) {
      this.callGrid.classList.add("screen-share-mode");
    }
  }

  _onScreenShareStopped() {
    this.isScreenSharing = false;

    if (this.localTile) {
      this.localTile.classList.remove("presenting", "stage");
    }

    if (this.callGrid) {
      this.callGrid.classList.remove("screen-share-mode");
    }
  }

  _onPeerUnavailable(reason) {
    this._setStatusText(reason || "User unavailable");

    if (this.currentMode === "ios-voice") {
      this._updateIosVoiceStatus(reason || "User unavailable");
    }

    this._hideIosUpgradeOverlays();

    setTimeout(() => this.closeWindow(), 1200);
  }

_enterActiveVideoMode() {
  // Release caller preview stream so the main local video can render
  if (this.iosCallerUpgradePreview) {
    this.iosCallerUpgradePreview.srcObject = null;
  }

  // Hide all iOS upgrade overlays (caller + callee)
  this._hideIosUpgradeOverlays();

  // Switch UI mode to Meet (full video)
  this._setMode("meet", { audioOnly: false });

  // Ensure inbound controls are hidden and normal controls visible
  const inbound = this.root.querySelector(".ios-inbound-controls");
  const normal = this.root.querySelector(".ios-controls");
  inbound?.classList.add("hidden");
  normal?.classList.remove("hidden");

  // 🔥 CRITICAL: reattach the upgraded local stream to both video elements
  this._attachLocalStreamFromState();

  // Show PiP (local video) immediately
  this._showLocalPip(true);

  // Clear iOS voice status text
  this._updateIosVoiceStatus("");
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
    this.callControls?.classList.remove("hidden-soft");
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
      this.callControls?.classList.add("hidden");
      this.localPip?.classList.add("hidden");
      this.remotePip?.classList.add("hidden");
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

      this.answerBtn?.classList.remove("hidden");
      this.declineBtn?.classList.remove("hidden");
      this.endCallBtn?.classList.add("hidden");
    } else {
      this.callControls.classList.remove("inbound");
      this.callControls.classList.add("active");

      this.answerBtn?.classList.add("hidden");
      this.declineBtn?.classList.add("hidden");
      this.endCallBtn?.classList.remove("hidden");
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

  if (!this._isMobile()) {
    this.callControls?.classList.remove("hidden");
    this.callControls?.classList.remove("hidden-soft");
  } else {
    this.callControls?.classList.add("hidden");

    // 🔥 Force an orientation sync when the call UI opens on mobile
    try {
      let orientation = "portrait";

      if (screen.orientation && screen.orientation.type) {
        orientation = screen.orientation.type.startsWith("portrait")
          ? "portrait"
          : "landscape";
      } else if (typeof window.orientation === "number") {
        const angle = window.orientation;
        orientation =
          angle === 0 || angle === 180 ? "portrait" : "landscape";
      }

      this.controller.sendOrientation(orientation);
    } catch (e) {
      console.warn("[CallUI] orientation sync failed:", e);
    }
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
  // MUTE / CAMERA / MORE
  // ============================================================
  _toggleMute() {
    const stream = rtcState.localStream;
    if (!stream) return;

    this.isMuted = !this.isMuted;
    stream.getAudioTracks().forEach((t) => (t.enabled = !this.isMuted));

    this.muteBtn?.classList.toggle("active", this.isMuted);
    this.iosMuteBtn?.classList.toggle("active", this.isMuted);

    rtcState.micMuted = this.isMuted;
  }

  _toggleCamera() {
    const stream = rtcState.localStream;
    if (!stream) return;

    this.isCameraOn = !this.isCameraOn;
    stream.getVideoTracks().forEach((t) => (t.enabled = this.isCameraOn));

    this.cameraToggleBtn?.classList.toggle("active", !this.isCameraOn);

    if (this.root) {
      if (this.isCameraOn) {
        this.root.classList.remove("camera-off");
      } else {
        this.root.classList.add("camera-off");
      }
    }

    rtcState.cameraOff = !this.isCameraOn;
  }

  _toggleMoreControlsMenu() {
    this.moreControlsMenu?.classList.toggle("hidden");
  }

  _hideMoreControlsMenu() {
    this.moreControlsMenu?.classList.add("hidden");
  }

  // ============================================================
  // LOCAL PIP (always local after call is answered)
  // ============================================================
  _showLocalPip(show) {
    if (!this.localPip) return;
    if (show) {
      this.localPip.classList.remove("hidden");
      this._attachLocalStreamFromState();
    } else {
      this.localPip.classList.add("hidden");
    }
  }

  // ============================================================
  // iOS VOICE STATUS
  // ============================================================
  _updateIosVoiceStatus(text) {
    if (this.iosCallStatus) {
      this.iosCallStatus.textContent = text || "";
    }
  }

  // ============================================================
  // QUALITY INDICATOR
  // ============================================================
  _updateQualityIndicator(level) {
    if (!this.qualityIndicator) return;
    this.qualityIndicator.dataset.level = level || "excellent";
    this.qualityIndicator.textContent = `Connection: ${
      level || "excellent"
    }`;
  }

  
// ============================================================
// VIDEO UPGRADE OVERLAY (DESKTOP / FALLBACK)
// ============================================================
showVideoUpgradeOverlay(peerId, offer) {
  this._pendingVideoUpgrade = { peerId, offer };
  if (!this.videoUpgradeOverlay) return;

  // Hide ALL inbound/active controls
  if (this.callControls) {
    this.callControls.classList.add("hidden");
    this.callControls.classList.remove("inbound", "active");
  }

  // Blur remote preview (CSS handles this)
  this.root?.classList.add("web-upgrade-pending");

  // Ensure remote video stays visible behind overlay
  this.callGrid?.classList.add("upgrade-pending");

  // Show overlay
  this.videoUpgradeOverlay.classList.remove("hidden");
}


_hideVideoUpgradeOverlay() {
  if (!this.videoUpgradeOverlay) return;

  this.videoUpgradeOverlay.classList.add("hidden");
  this._pendingVideoUpgrade = null;

  // Remove blur + overlay state
  this.root?.classList.remove("web-upgrade-pending");
  this.callGrid?.classList.remove("upgrade-pending");

  // Do NOT restore inbound controls for upgrades
  // Only restore if this was a real inbound call
  if (this.isInbound && this.callControls) {
    this.callControls.classList.remove("hidden");
    this.callControls.classList.remove("hidden-soft");
    this.callControls.classList.add("inbound");
  }
}


async _acceptVideoUpgrade() {
  this._stopRingtone();

  // 🔥 Upgrade local media + send answer
  await this.controller.answerCall();

  // Switch UI to full video mode
  this._enterActiveVideoMode();

  // Hide overlays
  this._hideVideoUpgradeOverlay();
  this._hideCalleeVideoUpgrade();

  // Notify caller
  this.controller.sendVideoUpgradeAccepted?.();
}



_declineVideoUpgrade() {
  this._stopRingtone();
  this._hideVideoUpgradeOverlay();
  this._hideCalleeVideoUpgrade();

  // Notify caller
  this.controller.sendVideoUpgradeDeclined?.();
}


  // ============================================================
  // UTIL
  // ============================================================
  _isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }
}




























