// public/js/webrtc/CallUI.js
// High-performance, production-grade call window UI
// - Mobile: iOS 17-style voice + video upgrade
// - Web: Google Meet-style layout
// - Group: Discord-style grid
// - RemoteParticipants.js owns ALL remote tiles

import { WebRTCController } from "./WebRTCController.js";
import { rtcState } from "./WebRTCState.js";

export class CallUI {
  constructor(socket, options = {}) {
    this.rtc = new WebRTCController(socket);
    this.controller = this.rtc;

    this.enablePipSwap = false; // P1: PiP always local after call is answered

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

    // PiP drag state
    this.pipDragState = {
      active: false,
      target: null,
      startX: 0,
      startY: 0,
      origX: 0,
      origY: 0,
    };

    // Remote tile system disabled (RemoteParticipants.js owns tiles)
    this.remoteTiles = null;

    this._lastControlsMove = Date.now();
    this._controlsHideInterval = null;

    // Video upgrade state
    this._pendingVideoUpgrade = null;
    this._pendingUpgradePeerId = null;

    this._bindController();
    this._bindUI();
    this._bindPipDrag();
  }

  // ============================================================
  // REMOTE TILE SYSTEM DISABLED
  // ============================================================
  _ensureRemoteTile() {
    return null;
  }
  _removeRemoteTile() {}
  _updateParticipantTile() {}
  _clearParticipants() {}

  // ============================================================
  // PUBLIC API
  // ============================================================
// ============================================================
// PUBLIC API
// ============================================================
openForOutgoing(peerId, { audio = true, video = true, mode = "meet" } = {}) {
  this.isInbound = false;

  let audioOnly = audio && !video;

  // If the caller explicitly chose audio-only, prefer iOS voice UI on mobile
  if (this._isMobile() && audioOnly) {
    mode = "ios-voice";
  }

  // 🔥 Force audio-only on mobile when in ios-voice mode
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

  _setStatusText(text) {
    if (this.callStatusEl) this.callStatusEl.textContent = text || "";
    if (this.iosCallStatus) this.iosCallStatus.textContent = text || "";
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

  // ============================================================
  // CONTROLLER BINDING
  // ============================================================
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
    };

c.onIncomingOffer = (peerId, offer, isVideoUpgrade = false) => {
  rtcState.incomingOffer = offer;

  rtcState.incomingIsVideo =
    isVideoUpgrade || offer?.sdp?.includes("m=video");

const isUpgrade = !!isVideoUpgrade;
console.log("🔥 onIncomingOffer", { isVideoUpgrade, isUpgrade });


  if (isUpgrade) {
    if (this._isMobile()) {
      this._showCalleeVideoUpgrade(peerId);   // ✅ will now run
    } else {
      this.showVideoUpgradeOverlay(peerId, offer);
    }
    return;
  }

  // Normal inbound call
  if (this._isMobile()) {
    this._showIosInboundControls(peerId);
  } else {
    this.showInboundRinging(peerId, {
      incomingIsVideo: rtcState.incomingIsVideo,
    });
  }
};

    // RemoteParticipants.js owns remote tiles
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
      this._onPeerUnavailable(reason);
    };

    c.onRemoteUpgradedToVideo = () => this._enterActiveVideoMode();
  }

  // ============================================================
  // UI BINDING (iOS + DESKTOP)
  // ============================================================
  _bindUI() {
    const isMobile = this._isMobile();

    // DESKTOP CONTROLS
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

    // iOS CONTROLS
    if (isMobile) {
      if (this.iosMuteBtn) {
        this.iosMuteBtn.addEventListener("click", () => this._toggleMute());
      }

      if (this.iosSpeakerBtn) {
        this.iosSpeakerBtn.addEventListener("click", () =>
          this._toggleSpeaker()
        );
      }

      if (this.iosKeypadBtn) {
        this.iosKeypadBtn.addEventListener("click", () => this._openKeypad());
      }

      if (this.iosAddBtn) {
        this.iosAddBtn.addEventListener("click", () => this._addCall());
      }

      if (this.iosVideoBtn) {
        this.iosVideoBtn.addEventListener("click", () => {
          // Mark UI state
          this.root?.classList.add("ios-upgrade-requested");

          // Ensure camera is on
          this.isCameraOn = true;
          this.root?.classList.remove("camera-off");

          // Trigger upgrade flow
          this._onIosVideoPressed();
        });
      }

      if (this.iosEndBtn) {
        this.iosEndBtn.addEventListener("click", () =>
          this.controller.endCall("local_hangup")
        );
      }

      // Caller upgrade overlay
      if (this.iosCallerUpgradeCancel) {
        this.iosCallerUpgradeCancel.addEventListener("click", () => {
          this._hideCallerVideoUpgrade();
          this.root?.classList.remove("ios-upgrade-requested");
          this.controller.cancelVideoUpgrade?.();
        });
      }

      // Callee upgrade overlay
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

      // iOS inbound answer/decline wired once
      if (this.iosInboundAnswerBtn) {
        this.iosInboundAnswerBtn.addEventListener("click", async () => {
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
    }

    // AUTO-HIDE CONTROLS (desktop)
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

  // ============================================================
  // iOS INBOUND CONTROLS
  // ============================================================
  _showIosInboundControls(peerId) {
    this.isInbound = true;
    this._openWindow();
    this._setMode("ios-voice", { audioOnly: !rtcState.incomingIsVideo });

    const inbound = this.root.querySelector(".ios-inbound-controls");
    const normal = this.root.querySelector(".ios-controls");

    inbound?.classList.remove("hidden");
    normal?.classList.add("hidden");
  }

  // ============================================================
  // iOS HELPERS + UPGRADE FLOW
  // ============================================================
  _toggleSpeaker() {
    if (!this.remoteAudio) return;
    this.remoteAudio.muted = !this.remoteAudio.muted;
    this.iosSpeakerBtn?.classList.toggle("active", !this.remoteAudio.muted);
  }

  _openKeypad() {
    console.log("[CallUI] iOS keypad pressed — implement keypad UI here");
  }

  _addCall() {
    console.log("[CallUI] iOS add call pressed — implement call merging here");
  }

_onIosVideoPressed() {
  if (!rtcState.inCall) return;

  // Start the upgrade (this triggers getUserMedia)
  this._upgradeToVideo();

  // 🔥 Wait until the upgraded local video track exists
  const waitForVideo = () => {
    const stream = rtcState.localStream;

    if (stream && stream.getVideoTracks().length > 0) {
      // Now safe to show the overlay
      this._showCallerVideoUpgrade();
    } else {
      requestAnimationFrame(waitForVideo);
    }
  };

  waitForVideo();
}


_upgradeToVideo() {
  this.controller.upgradeToVideo?.();

  // Refresh local video immediately
  this._attachLocalStreamFromState?.();
  this.isCameraOn = true;
  this.root?.classList.remove("camera-off");

  // 🔥 Desktop caller upgrade overlay
  if (!this._isMobile()) {
    this._showCallerVideoUpgradeDesktop();
  }
}
_showCallerVideoUpgradeDesktop() {
  if (!this.videoUpgradeOverlay) return;

  // Hide controls
  this.callControls?.classList.add("hidden");

  // Blur remote preview
  this.root?.classList.add("web-upgrade-pending");

  // Show overlay
  this.videoUpgradeOverlay.classList.remove("hidden");

  // Update text
  const label = this.videoUpgradeOverlay.querySelector(".title");
  if (label) label.textContent = "Waiting for them…";
}


_showCallerVideoUpgrade() {
  if (!this.iosCallerUpgradeOverlay || !this.iosCallerUpgradePreview) return;

  // 🔥 MUST happen first — otherwise CSS hides the preview
  this.root?.classList.remove("camera-off");

  // Hide other overlays AFTER camera-off is removed
  this._hideIosUpgradeOverlays();

  // Refresh local stream
  this._attachLocalStreamFromState();

  // Attach upgraded stream with a tiny delay (iOS timing fix)
  setTimeout(() => {
    const stream = rtcState.localStream;
    if (stream) {
      this.iosCallerUpgradePreview.srcObject = stream;
      this.iosCallerUpgradePreview.muted = true;
      this.iosCallerUpgradePreview.playsInline = true;
      this.iosCallerUpgradePreview.autoplay = true;
      this.iosCallerUpgradePreview.play?.().catch(() => {});
    }
  }, 50);

  const name = rtcState.peerName || "them";
  if (this.iosCallerUpgradeLabel) {
    this.iosCallerUpgradeLabel.textContent = `Waiting for ${name}…`;
  }

  if (this.iosVoiceUI) {
    this.iosVoiceUI.classList.add("hidden");
  }

  this.iosCallerUpgradeOverlay.classList.remove("hidden");
  this.iosCallerUpgradeOverlay.classList.add("active");
}


_hideCallerVideoUpgrade() {
  // iOS overlay
  if (this.iosCallerUpgradeOverlay) {
    this.iosCallerUpgradeOverlay.classList.remove("active");
    this.iosCallerUpgradeOverlay.classList.add("hidden");
    if (this.iosCallerUpgradePreview) {
      this.iosCallerUpgradePreview.srcObject = null;
    }
  }

  // Desktop overlay
  if (this.videoUpgradeOverlay) {
    this.videoUpgradeOverlay.classList.add("hidden");
    this.root?.classList.remove("web-upgrade-pending");
    this.callGrid?.classList.remove("upgrade-pending");
  }
}

_showCalleeVideoUpgrade(peerId) {
  this._pendingUpgradePeerId = peerId;
console.log("🔥 CALLEE UPGRADE OVERLAY TRIGGERED");

  if (!this.iosCalleeUpgradeOverlay) {
    // Mobile fallback: still use generic overlay if iOS markup missing
    this.showVideoUpgradeOverlay(peerId, rtcState.incomingOffer);
    return;
  }

  // Hide any other upgrade overlays
  this._hideIosUpgradeOverlays();

  // 🔥 Immediately show the iOS callee overlay
  this.iosCalleeUpgradeOverlay.classList.remove("hidden");
  this.iosCalleeUpgradeOverlay.classList.add("active");
  this.root?.classList.add("ios-upgrade-pending");

  // Try to attach remote preview if available, but DO NOT block on it
  const id = String(peerId);
  const stream = rtcState.remoteStreams?.[id];

  if (stream && this.iosCalleeUpgradePreview) {
    this.iosCalleeUpgradePreview.srcObject = stream;
    this.iosCalleeUpgradePreview.muted = true;
    this.iosCalleeUpgradePreview.playsInline = true;
    this.iosCalleeUpgradePreview.autoplay = true;
    this.iosCalleeUpgradePreview.play?.().catch(() => {});
  }

  const name = rtcState.peerName || "Caller";
  if (this.iosCalleeUpgradeLabel) {
    this.iosCalleeUpgradeLabel.textContent = `${name} wants to switch to video`;
  }

  // Make sure ringtone is playing for the upgrade prompt
  this._playRingtone();
}

// You can now delete iosCalleePreviewReady() entirely,
// or leave it unused if you want, but it’s no longer needed.


iosCalleePreviewReady(stream) {
  // Attach the real remote video
  this.iosCalleeUpgradePreview.srcObject = stream;
  this.iosCalleeUpgradePreview.muted = true;
  this.iosCalleeUpgradePreview.playsInline = true;
  this.iosCalleeUpgradePreview.autoplay = true;
  this.iosCalleeUpgradePreview.play?.().catch(() => {});

  const name = rtcState.peerName || "Caller";
  if (this.iosCalleeUpgradeLabel) {
    this.iosCalleeUpgradeLabel.textContent = `${name} wants to switch to video`;
  }

  this._playRingtone();

  this.iosCalleeUpgradeOverlay.classList.remove("hidden");
  this.iosCalleeUpgradeOverlay.classList.add("active");
  this.root?.classList.add("ios-upgrade-pending");
}


  _hideCalleeVideoUpgrade() {
    if (!this.iosCalleeUpgradeOverlay) return;
    this.iosCalleeUpgradeOverlay.classList.remove("active");
    this.iosCalleeUpgradeOverlay.classList.add("hidden");
    if (this.iosCalleeUpgradePreview) {
      this.iosCalleeUpgradePreview.srcObject = null;
    }
  }

  _hideIosUpgradeOverlays() {
    this._hideCallerVideoUpgrade();
    this._hideCalleeVideoUpgrade();
  }

  // ============================================================
  // PIP DRAGGING (PiP always local after call is answered)
  // ============================================================
  _bindPipDrag() {
    const startDrag = (el, evt) => {
      evt.preventDefault();
      const rect = el.getBoundingClientRect();
      this.pipDragState.active = true;
      this.pipDragState.target = el;
      this.pipDragState.startX =
        evt.clientX || evt.touches?.[0]?.clientX || 0;
      this.pipDragState.startY =
        evt.clientY || evt.touches?.[0]?.clientY || 0;
      this.pipDragState.origX = rect.left;
      this.pipDragState.origY = rect.top;
      el.classList.add("dragging");
    };

    const moveDrag = (evt) => {
      if (!this.pipDragState.active || !this.pipDragState.target) return;
      const el = this.pipDragState.target;
      const currentX =
        evt.clientX || evt.touches?.[0]?.clientX || 0;
      const currentY =
        evt.clientY || evt.touches?.[0]?.clientY || 0;
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

    window.addEventListener("mousemove", moveDrag);
    window.addEventListener("touchmove", moveDrag, { passive: false });
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);
  }

  // ============================================================
  // CONTROLLER EVENT HANDLERS
  // ============================================================
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

    // P1: PiP always local after call is answered
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



























