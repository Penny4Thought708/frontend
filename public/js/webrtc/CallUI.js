// public/js/webrtc/CallUI.js
// ============================================================
// CallUI: owns layout, PiP, modes, overlays, timers, and
// connects WebRTCController to your HTML/CSS.
// ============================================================

export class CallUI {
  constructor(controller, options = {}) {
    this.controller = controller;

    // Mode preferences / feature flags
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

    this.iosVoiceUI = this.root.querySelector(".ios-voice-ui");
    this.iosVoiceAvatar = document.getElementById("iosVoiceAvatar");
    this.iosCallStatus = this.root.querySelector(".ios-call-status");
    this.iosCallTimer = this.root.querySelector(".ios-call-timer");

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

    // Internal state
    this.currentMode = "meet"; // "meet" | "discord" | "ios-voice"
    this.callTimerInterval = null;
    this.callStartTs = null;
    this.isMuted = false;
    this.isCameraOn = true;
    this.isScreenSharing = false;
    this.isInbound = false;
    this.incomingUpgradeOffer = null;
    this.incomingUpgradePeerId = null;

    // PiP state
    this.pipSwapActive = true; // local ↔ remote swap enabled
    this.pipDragState = {
      active: false,
      target: null,
      startX: 0,
      startY: 0,
      origX: 0,
      origY: 0,
    };

    // Participant DOM map
    this.remoteTiles = new Map(); // peerId → { el, videoEl, avatarEl, nameTag }

    this._bindController();
    this._bindUI();
    this._bindPipDrag();
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  /**
   * Open call window for an outgoing call.
   * mode: "meet" | "discord" | "ios-voice"
   */
  openForOutgoing(peerId, { audio = true, video = true, mode = "meet" } = {}) {
    this.isInbound = false;
    this._setMode(mode, { audioOnly: audio && !video });
    this._openWindow();
    this._setInboundActiveState(false);

    this._setStatusText("Calling…");
    this._startTimer(null); // start when controller says call started

    this.controller.startCall(peerId, { audio, video });
  }

  /**
   * Called when an inbound offer arrives.
   * We just show the window in inbound mode and let user accept/decline.
   */
  showInboundRinging(peerId, { incomingIsVideo, modeHint } = {}) {
    this.isInbound = true;

    // Decide mode:
    // - if iOS/mobile + audio-only → ios-voice
    // - if group (later) → discord
    // - else meet
    const audioOnly = !incomingIsVideo;
    let mode = modeHint || "meet";

    if (this._isMobile() && audioOnly) {
      mode = "ios-voice";
    } else if (mode === "discord") {
      // keep as discord if caller wants group style
    }

    this._setMode(mode, { audioOnly });
    this._openWindow();
    this._setInboundActiveState(true);

    this._setStatusText("Incoming call…");
    this._startTimer(null); // start when answered
  }

  closeWindow() {
    this._stopTimer();
    this._clearParticipants();
    this._hideVideoUpgradeOverlay();
    this._setStatusText("Idle");
    this._setMode("meet", { audioOnly: false });

    this.root.classList.remove("is-open", "call-opening", "inbound-mode", "active-mode");
    this.root.classList.add("hidden");
    this.root.style.opacity = "0";
  }

  // ============================================================
  // CONTROLLER BINDING
  // ============================================================

  _bindController() {
    const c = this.controller;

    c.onCallStarted = (peerId) => {
      this._onCallStarted(peerId);
    };

    c.onCallEnded = (reason) => {
      this._onCallEnded(reason);
    };

    c.onIncomingOffer = (peerId, offer) => {
      // Decide mode based on offer (audio/video) via rtcState,
      // but controller already computed incomingIsVideo.
      this.showInboundRinging(peerId, {
        incomingIsVideo: window.rtcState?.incomingIsVideo,
      });
    };

    c.onIncomingOfferQueued = (peerId, offer, callId) => {
      // Could show a subtle toast "New call waiting"
      // For now, just log.
      console.log("[CallUI] Incoming offer queued from", peerId, callId);
    };

    c.onRemoteJoin = (peerId) => {
      this._ensureRemoteTile(peerId);
      this._recomputeGridLayout();
    };

    c.onRemoteLeave = (peerId) => {
      this._removeRemoteTile(peerId);
      this._recomputeGridLayout();
    };

    c.onParticipantUpdate = (peerId, data) => {
      this._updateParticipantTile(peerId, data);
      this._recomputeGridLayout();
    };

    c.onScreenShareStarted = () => {
      this._onScreenShareStarted();
    };

    c.onScreenShareStopped = () => {
      this._onScreenShareStopped();
    };

    c.onQualityUpdate = (level) => {
      this._updateQualityIndicator(level);
    };

    c.onCallStatusChange = (status) => {
      this._onCallStatusChange(status);
    };

    c.onPeerUnavailable = (reason) => {
      this._onPeerUnavailable(reason);
    };
  }

 _bindUI() {
  // ============================================================
  // INBOUND / ACTIVE CALL CONTROLS
  // ============================================================
  if (this.declineBtn) {
    this.declineBtn.addEventListener("click", () => {
      this.controller.declineCall("declined");
      this._setStatusText("Declined");
    });
  }

  if (this.answerBtn) {
    this.answerBtn.addEventListener("click", async () => {
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
    this.muteBtn.addEventListener("click", () => {
      this._toggleMute();
    });
  }

  if (this.cameraToggleBtn) {
    this.cameraToggleBtn.addEventListener("click", () => {
      this._toggleCamera();
    });
  }

  // ============================================================
  // MORE CONTROLS MENU
  // ============================================================
  if (this.moreControlsBtn && this.moreControlsMenu) {
    this.moreControlsBtn.addEventListener("click", () => {
      this._toggleMoreControlsMenu();
    });

    document.addEventListener("click", (e) => {
      if (!this.moreControlsMenu.contains(e.target) &&
          e.target !== this.moreControlsBtn) {
        this._hideMoreControlsMenu();
      }
    });
  }

  // ============================================================
  // SCREEN SHARE
  // ============================================================
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

  // ============================================================
  // VIDEO UPGRADE OVERLAY
  // ============================================================
  if (this.videoUpgradeAcceptMobile) {
    this.videoUpgradeAcceptMobile.addEventListener("click", () => {
      this._acceptVideoUpgrade();
    });
  }
  if (this.videoUpgradeDeclineMobile) {
    this.videoUpgradeDeclineMobile.addEventListener("click", () => {
      this._declineVideoUpgrade();
    });
  }
  if (this.videoUpgradeAcceptDesktop) {
    this.videoUpgradeAcceptDesktop.addEventListener("click", () => {
      this._acceptVideoUpgrade();
    });
  }
  if (this.videoUpgradeDeclineDesktop) {
    this.videoUpgradeDeclineDesktop.addEventListener("click", () => {
      this._declineVideoUpgrade();
    });
  }

  // ============================================================
  // GLOBAL VOICE + VIDEO CALL BUTTONS (outside call window)
  // ============================================================
  const voiceBtn = document.getElementById("voiceBtn");
  const videoBtn = document.getElementById("videoBtn");

  const getReceiver = () => {
    return window.currentChatUserId || window.session?.getReceiver?.();
  };

  if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
      const peerId = getReceiver();
      if (!peerId) return console.warn("No receiver selected for voice call");

      const mode = this._isMobile() ? "ios-voice" : "meet";

      this.openForOutgoing(peerId, {
        audio: true,
        video: false,
        mode,
      });
    });
  }

  if (videoBtn) {
    videoBtn.addEventListener("click", () => {
      const peerId = getReceiver();
      if (!peerId) return console.warn("No receiver selected for video call");

      this.openForOutgoing(peerId, {
        audio: true,
        video: true,
        mode: "meet",
      });
    });
  }

  // ============================================================
  // AUTO-HIDE CONTROLS
  // ============================================================
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
      if (Date.now() - lastMove > 4000) {
        hideControls();
      }
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

      // Snap to nearest edge (simple)
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
      el.addEventListener("touchstart", (e) => startDrag(el, e), { passive: false });
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
    this._setInboundActiveState(false);
    this._setStatusText("Connected");
    this._startTimer(Date.now());
    this._openWindow();

    // In 1:1 video, remote full, local PiP overlay
    if (this.currentMode === "meet" || this.currentMode === "discord") {
      this._ensureRemoteTile(peerId);
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

    // Small delay then close window
    setTimeout(() => {
      this.closeWindow();
    }, 800);
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
      case "idle":
      default:
        this._setStatusText("Idle");
        break;
    }
  }

  _onScreenShareStarted() {
    this.isScreenSharing = true;
    if (this.localTile) {
      this.localTile.classList.add("presenting");
    }
    if (this.callGrid) {
      this.callGrid.classList.add("screen-share-mode");
    }
  }

  _onScreenShareStopped() {
    this.isScreenSharing = false;
    if (this.localTile) {
      this.localTile.classList.remove("presenting");
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
    setTimeout(() => {
      this.closeWindow();
    }, 1200);
  }

  // ============================================================
  // MODE + LAYOUT
  // ============================================================

  _setMode(mode, { audioOnly = false } = {}) {
    this.currentMode = mode;

    this.root.classList.remove("meet-mode", "discord-mode", "ios-voice-mode");
    this.callGrid.classList.remove("discord-layout");

    if (mode === "meet") {
      this.root.classList.add("meet-mode");
      // Google Meet style grid
    } else if (mode === "discord") {
      this.root.classList.add("discord-mode");
      this.callGrid.classList.add("discord-layout");
    } else if (mode === "ios-voice") {
      this.root.classList.add("ios-voice-mode");
    }

    // Voice-only vs camera
    if (audioOnly) {
      this.root.classList.add("voice-only-call");
      this.root.classList.add("camera-off");
    } else {
      this.root.classList.remove("voice-only-call");
      this.root.classList.remove("camera-off");
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

  _recomputeGridLayout() {
    if (!this.callGrid) return;
    const count = this.remoteTiles.size + (this.localTile ? 1 : 0);

    this.callGrid.classList.remove(
      "participants-1",
      "participants-2",
      "participants-3",
      "participants-4",
      "participants-5",
      "participants-6",
      "participants-7",
      "participants-8",
      "participants-9",
      "participants-many"
    );

    if (count <= 1) {
      this.callGrid.classList.add("participants-1");
    } else if (count === 2) {
      this.callGrid.classList.add("participants-2");
    } else if (count === 3) {
      this.callGrid.classList.add("participants-3");
    } else if (count === 4) {
      this.callGrid.classList.add("participants-4");
    } else if (count === 5) {
      this.callGrid.classList.add("participants-5");
    } else if (count === 6) {
      this.callGrid.classList.add("participants-6");
    } else if (count >= 7 && count <= 9) {
      this.callGrid.classList.add("participants-7");
    } else if (count > 9) {
      this.callGrid.classList.add("participants-many");
    }
  }

  // ============================================================
  // PARTICIPANTS
  // ============================================================

  _ensureRemoteTile(peerId) {
    peerId = String(peerId);
    if (this.remoteTiles.has(peerId)) return this.remoteTiles.get(peerId);

    if (!this.remoteTemplate) return null;
    const clone = this.remoteTemplate.content.firstElementChild.cloneNode(true);
    clone.dataset.peerId = peerId;

    const videoEl = clone.querySelector("video.remoteVideo");
    const avatarEl = clone.querySelector(".avatar-wrapper");
    const nameTag = clone.querySelector(".name-tag");

    if (nameTag) {
      nameTag.textContent = `User ${peerId}`;
    }

    this.callGrid.appendChild(clone);

    const tile = { el: clone, videoEl, avatarEl, nameTag };
    this.remoteTiles.set(peerId, tile);

    return tile;
  }

  _removeRemoteTile(peerId) {
    peerId = String(peerId);
    const tile = this.remoteTiles.get(peerId);
    if (!tile) return;
    tile.el.remove();
    this.remoteTiles.delete(peerId);
  }

  _updateParticipantTile(peerId, data) {
    peerId = String(peerId);
    if (peerId === "local" || peerId === window.rtcState?.selfId) {
      // Local tile
      if (!this.localTile) return;
      if (data?.voiceOnly) {
        this.localTile.classList.add("voice-only");
      } else {
        this.localTile.classList.remove("voice-only");
      }
      return;
    }

    const tile = this._ensureRemoteTile(peerId);
    if (!tile) return;

    const { el } = tile;

    el.classList.toggle("speaking", !!data?.speaking);
    el.classList.toggle("active-speaker", !!data?.activeSpeaker);
    el.classList.toggle("voice-only", !!data?.voiceOnly);
    el.classList.toggle("presenting", !!data?.presenting);

    if (tile.nameTag && data?.displayName) {
      tile.nameTag.textContent = data.displayName;
    }
  }

  _clearParticipants() {
    this.remoteTiles.forEach((tile) => tile.el.remove());
    this.remoteTiles.clear();
    if (this.localTile) {
      this.localTile.classList.remove("presenting", "voice-only", "speaking", "active-speaker");
    }
  }

  // ============================================================
  // PIP + SWAP
  // ============================================================

  _showLocalPip(show) {
    if (!this.localPip) return;
    if (show) {
      this.localPip.classList.remove("hidden");
      this.localPip.classList.add("fade-in");
      this.localPip.classList.remove("fade-out");
    } else {
      this.localPip.classList.add("hidden");
      this.localPip.classList.remove("fade-in");
    }
  }

  _swapPipWithMain() {
    if (!this.enablePipSwap) return;
    if (!this.localPip || !this.localVideo) return;

    // For 1:1: remote is "main", local is PiP.
    // Swap the video elements' srcObject.
    const mainRemote = [...this.remoteTiles.values()][0];
    if (!mainRemote || !mainRemote.videoEl) return;

    const mainVideo = mainRemote.videoEl;
    const pipVideo = this.localPipVideo || this.localVideo;

    const tmp = mainVideo.srcObject;
    mainVideo.srcObject = pipVideo.srcObject;
    pipVideo.srcObject = tmp;

    // Optional: toggle a class to indicate which is "primary"
    mainRemote.el.classList.toggle("active-speaker");
  }

  // ============================================================
  // VIDEO UPGRADE OVERLAY
  // ============================================================

  showVideoUpgradeOverlay(peerId, offer) {
    this.incomingUpgradePeerId = peerId;
    this.incomingUpgradeOffer = offer;

    if (!this.videoUpgradeOverlay) return;

    this.videoUpgradeOverlay.classList.remove("hidden");
    this.videoUpgradeOverlay.classList.add("show");
    this.root.classList.add("video-upgrade-mode");

    if (this._isMobile()) {
      this.callGrid.classList.add("mobile-video-preview");
    } else {
      this.callGrid.classList.add("desktop-video-preview");
    }
  }

  _hideVideoUpgradeOverlay() {
    if (!this.videoUpgradeOverlay) return;
    this.videoUpgradeOverlay.classList.remove("show");
    this.videoUpgradeOverlay.classList.add("hidden");
    this.root.classList.remove("video-upgrade-mode");
    this.callGrid.classList.remove("desktop-video-preview", "mobile-video-preview");
    this.incomingUpgradeOffer = null;
    this.incomingUpgradePeerId = null;
  }

  _acceptVideoUpgrade() {
    // Caller side: controller.upgradeToVideo()
    // Callee side: controller.answerCall() with incomingIsVideo=true already handled.
    if (window.rtcState?.isCaller) {
      this.controller.upgradeToVideo();
    } else {
      this.controller.answerCall();
    }
    this._hideVideoUpgradeOverlay();
  }

  _declineVideoUpgrade() {
    // Keep audio only; optionally send a decline reason via signaling if you want.
    this._hideVideoUpgradeOverlay();
  }

  // ============================================================
  // CONTROLS + STATUS + TIMER
  // ============================================================

  _setInboundActiveState(isInbound) {
    if (!this.root) return;
    if (isInbound) {
      this.root.classList.add("inbound-mode");
      this.root.classList.remove("active-mode");
    } else {
      this.root.classList.remove("inbound-mode");
      this.root.classList.add("active-mode");
    }
  }

  _setStatusText(text) {
    if (this.callStatusEl) {
      this.callStatusEl.textContent = text || "";
    }
  }

  _startTimer(startTs) {
    this._stopTimer();
    if (startTs) {
      this.callStartTs = startTs;
    } else {
      this.callStartTs = null;
    }

    this.callTimerInterval = setInterval(() => {
      if (!this.callTimerEl) return;
      let elapsed = 0;
      if (this.callStartTs) {
        elapsed = Date.now() - this.callStartTs;
      }
      const secs = Math.floor(elapsed / 1000);
      const mm = String(Math.floor(secs / 60)).padStart(2, "0");
      const ss = String(secs % 60).padStart(2, "0");
      this.callTimerEl.textContent = `${mm}:${ss}`;

      if (this.currentMode === "ios-voice" && this.iosCallTimer) {
        this.iosCallTimer.textContent = `${mm}:${ss}`;
      }
    }, 1000);
  }

  _stopTimer() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }
  }

  _updateQualityIndicator(level) {
    if (!this.qualityIndicator) return;
    this.qualityIndicator.dataset.level = level || "excellent";
    this.qualityIndicator.textContent = level || "excellent";
  }

  _toggleMoreControlsMenu() {
    if (!this.moreControlsMenu) return;
    if (this.moreControlsMenu.classList.contains("show")) {
      this._hideMoreControlsMenu();
    } else {
      this.moreControlsMenu.classList.remove("hidden");
      this.moreControlsMenu.classList.add("show");
    }
  }

  _hideMoreControlsMenu() {
    if (!this.moreControlsMenu) return;
    this.moreControlsMenu.classList.remove("show");
    this.moreControlsMenu.classList.add("hidden");
  }

_toggleMute() {
  this.isMuted = !this.isMuted;

  const stream = window.rtcState?.localStream;
  if (stream) {
    stream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
  }

  this.muteBtn.classList.toggle("active", this.isMuted);
}


_toggleCamera() {
  this.isCameraOn = !this.isCameraOn;

  const stream = window.rtcState?.localStream;
  if (stream) {
    stream.getVideoTracks().forEach(t => t.enabled = this.isCameraOn);
  }

  if (this.isCameraOn) {
    this.root.classList.remove("camera-off");
  } else {
    this.root.classList.add("camera-off");
  }

  this.cameraToggleBtn.classList.toggle("active", this.isCameraOn);
}


  // ============================================================
  // iOS VOICE UI
  // ============================================================

  _updateIosVoiceStatus(text) {
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

    setTimeout(() => {
      this.root.classList.remove("call-opening");
    }, 260);
  }

  // ============================================================
  // UTIL
  // ============================================================

  _isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }
}










