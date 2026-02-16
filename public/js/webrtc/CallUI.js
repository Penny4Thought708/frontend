// ============================================================
// CallUI.js — Fully Integrated with WebRTCController
// Google Meet / FaceTime–grade UI controller
// ============================================================

import { rtcState } from "./WebRTCState.js";
import { WebRTCController } from "./WebRTCController.js";

function log(...args) {
  console.log("[CallUI]", ...args);
}

function isMobile() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export class CallUI {
  constructor(socket) {
    this.socket = socket;
    this.rtc = new WebRTCController(socket);

    // -------------------------------------------------------
    // DOM REFERENCES
    // -------------------------------------------------------
    this.windowEl = document.getElementById("callWindow");
    this.callBody = this.windowEl?.querySelector(".call-body");
    this.callGrid = document.getElementById("callGrid");

    this.localTile = document.getElementById("localParticipant");
    this.localVideo = document.getElementById("localVideo");

    this.remoteAudio = document.getElementById("remoteAudio");

    this.localPip = document.getElementById("localPip");
    this.localPipVideo = document.getElementById("localPipVideo");

    this.remotePip = document.getElementById("remotePip");
    this.remotePipVideo = document.getElementById("remotePipVideo");

    this.controls = document.getElementById("call-controls");
    this.statusEl = document.getElementById("call-status");
    this.timerEl = document.getElementById("call-timer");
    this.qualityEl = document.getElementById("call-quality-indicator");

    this.answerBtn = document.getElementById("answer-call");
    this.declineBtn = document.getElementById("decline-call");
    this.muteBtn = document.getElementById("mute-call");
    this.camBtn = document.getElementById("camera-toggle");
    this.endBtn = document.getElementById("end-call");

    this.moreBtn = document.getElementById("more-controls-btn");
    this.moreMenu = document.getElementById("more-controls-menu");
    this.shareBtn = document.getElementById("share-screen");
    this.noiseBtn = document.getElementById("ai-noise-toggle");
    this.recordBtn = document.getElementById("record-call");
    this.historyBtn = document.getElementById("call-history-toggle");

    this.upgradeOverlay = document.getElementById("video-upgrade-overlay");
    this.upgradeAccept = document.getElementById("video-upgrade-accept");
    this.upgradeDecline = document.getElementById("video-upgrade-decline");
    this.upgradeAcceptDesktop = document.getElementById("video-upgrade-accept-desktop");
    this.upgradeDeclineDesktop = document.getElementById("video-upgrade-decline-desktop");

    this.voicemailModal = document.getElementById("voicemailModal");
    this.vmCancelBtn = document.getElementById("vmCancelBtn");

    this.unavailableToast = document.getElementById("unavailableToast");
    this.utVoiceBtn = document.getElementById("utVoiceBtn");
    this.utVideoBtn = document.getElementById("utVideoBtn");
    this.utTextBtn = document.getElementById("utTextBtn");

    this.ringtone = document.getElementById("ringtone");
    this.ringback = document.getElementById("ringback");
    this.cameraOnBeep = document.getElementById("cameraOnBeep");

    // -------------------------------------------------------
    // INTERNAL STATE
    // -------------------------------------------------------
    this.primaryIsRemote = true;
    this.pipPos = null;
    this.dragState = null;
    this.controlsVisible = true;
    this.controlsTimeout = null;

    this.callStartTime = null;
    this.timerInterval = null;

    // -------------------------------------------------------
    // INIT
    // -------------------------------------------------------
    this._bindButtons();
    this._bindControllerEvents();
    this._bindTapToToggleControls();
    this._initPipDrag();
    this._startTimerLoop();
    this._startQualityMonitor();

    this.localTile?.classList.add("hidden");
    this.remotePip?.classList.add("hidden");
  }

  // ===========================================================
  // PUBLIC API
  // ===========================================================
  startVoiceCall(peerId) {
    rtcState.audioOnly = true;
    rtcState.peerId = String(peerId);
    rtcState.status = "calling";

    this.socket.emit("call:start", { to: peerId, type: "voice" });

    this._openWindow();
    this._enterOutboundVoiceMode();

    this.rtc.startCall(peerId, { audio: true, video: false });
    this._playRingback();
  }

  startVideoCall(peerId) {
    rtcState.audioOnly = false;
    rtcState.peerId = String(peerId);
    rtcState.status = "calling";

    this.socket.emit("call:start", { to: peerId, type: "video" });

    this._openWindow();
    this._enterOutboundVideoMode();

    this.rtc.startCall(peerId, { audio: true, video: true });
    this._playRingback();
  }

  receiveInboundCall(peerId, isVideo) {
    rtcState.peerId = String(peerId);
    rtcState.audioOnly = !isVideo;
    rtcState.status = "ringing";

    this._openWindow();
    isVideo ? this._enterInboundVideoMode() : this._enterInboundVoiceMode();

    this._playRingtone();
  }

  answerCall() {
    if (this.windowEl.classList.contains("video-upgrade-mode")) {
      this._exitUpgradeOverlay();
      rtcState.audioOnly = false;
      rtcState.status = "in-call";
      this.rtc.answerCall();
      this._enterActiveVideoMode();
      return;
    }

    this._stopRinging();
    rtcState.status = "in-call";

    this.rtc.answerCall();
    this.callStartTime = Date.now();

    rtcState.audioOnly
      ? this._enterActiveVoiceMode()
      : this._enterActiveVideoMode();
  }

  endCall(reason = "local_end") {
    this._stopRinging();
    this.rtc.endCall(reason);
    rtcState.status = "idle";
    this._resetUI();
  }

  async upgradeToVideo() {
    await this.rtc.upgradeToVideo();
    rtcState.audioOnly = false;
    rtcState.status = "in-call";
    this._enterActiveVideoMode();
  }

  // ===========================================================
  // CONTROLLER EVENTS
  // ===========================================================
  _bindControllerEvents() {
    this.rtc.onCallStarted = () => {
      this._stopRinging();
      rtcState.status = "in-call";
      this.callStartTime = Date.now();

      rtcState.audioOnly
        ? this._enterActiveVoiceMode()
        : this._enterActiveVideoMode();
    };

    this.rtc.onCallEnded = () => {
      rtcState.status = "idle";
      this._resetUI();
    };

    this.rtc.onRemoteJoin = () => {
      this._setStatus("Connected");
      this._applyPrimaryLayout();
    };

    this.rtc.onRemoteLeave = () => {
      rtcState.status = "idle";
      this._resetUI();
    };

    this.rtc.onIncomingOffer = (peerId, offer) => {
      const isUpgrade =
        rtcState.audioOnly &&
        offer?.sdp &&
        offer.sdp.includes("m=video");

      if (isUpgrade) {
        this._enterInboundUpgradeMode(peerId);
      } else {
        this.receiveInboundCall(peerId, !rtcState.audioOnly);
      }
    };

    this.rtc.onRemoteUpgradedToVideo = () => {
      this.cameraOnBeep?.play().catch(() => {});
      rtcState.audioOnly = false;
      rtcState.status = "in-call";
      this._enterActiveVideoMode();
      this._setStatus("Camera enabled by other side");
    };

    this.rtc.onQualityUpdate = (score) => {
      if (this.qualityEl) {
        this.qualityEl.textContent = score;
        this._updateQualityLevel(score);
      }
    };

    this.rtc.onScreenShareStarted = () => this._enterStageMode();
    this.rtc.onScreenShareStopped = () => this._exitStageMode();

    this.rtc.onPeerUnavailable = (reason) => {
      this._showUnavailableToast(reason || "User unavailable");
    };
  }

  // ===========================================================
  // BUTTONS
  // ===========================================================
  _bindButtons() {
    this.answerBtn?.addEventListener("click", () => this.answerCall());
    this.declineBtn?.addEventListener("click", () => {
      this._stopRinging();
      this._closeWindow();
      this._openVoicemailModal();
    });

    this.endBtn?.addEventListener("click", () => this.endCall("end_button"));

    this.muteBtn?.addEventListener("click", () => {
      const stream = rtcState.localStream;
      if (!stream) return;

      const enabled = stream.getAudioTracks().some(t => t.enabled);
      stream.getAudioTracks().forEach(t => (t.enabled = !enabled));
      this.muteBtn.classList.toggle("active", !enabled);
    });

    this.camBtn?.addEventListener("click", async () => {
      if (rtcState.audioOnly || !rtcState.localStream?.getVideoTracks().length) {
        await this.upgradeToVideo();
        return;
      }

      const stream = rtcState.localStream;
      const enabled = stream.getVideoTracks().some(t => t.enabled);
      const newEnabled = !enabled;

      stream.getVideoTracks().forEach(t => (t.enabled = newEnabled));
      this.camBtn.classList.toggle("active", newEnabled);

      this.windowEl.classList.toggle("camera-off", !newEnabled);
    });

    // More menu
    this.moreBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = this.moreMenu.classList.contains("show");
      this.moreMenu.classList.toggle("show", !open);
      this.moreMenu.classList.toggle("hidden", open);
    });

    document.addEventListener("click", (e) => {
      if (!this.moreMenu.contains(e.target) && e.target !== this.moreBtn) {
        this.moreMenu.classList.remove("show");
        this.moreMenu.classList.add("hidden");
      }
    });

    this.shareBtn?.addEventListener("click", () => {
      this.rtc.startScreenShare();
      this.moreMenu.classList.add("hidden");
      this.moreMenu.classList.remove("show");
    });

    // Upgrade overlay
    this.upgradeAccept?.addEventListener("click", () => this.answerCall());
    this.upgradeDecline?.addEventListener("click", () => this._exitUpgradeOverlay());
    this.upgradeAcceptDesktop?.addEventListener("click", () => this.answerCall());
    this.upgradeDeclineDesktop?.addEventListener("click", () => this._exitUpgradeOverlay());

    // Voicemail
    this.vmCancelBtn?.addEventListener("click", () => this._closeVoicemailModal());

    // Unavailable toast
    this.utVoiceBtn?.addEventListener("click", () => {
      this._hideUnavailableToast();
      this._openVoicemailModal();
    });
    this.utVideoBtn?.addEventListener("click", () => this._hideUnavailableToast());
    this.utTextBtn?.addEventListener("click", () => this._hideUnavailableToast());

    // Double-tap swap
    this._bindDoubleTap(this.localPip, () => {
      const remote = this._firstRemoteTile();
      this._togglePrimary(remote);
    });

    this.callGrid?.addEventListener("click", (e) => {
      const tile = e.target.closest(".participant.remote");
      if (tile) this._handleRemoteDoubleTap(tile);
    });
  }

  // ===========================================================
  // TAP-TO-TOGGLE CONTROLS
  // ===========================================================
  _bindTapToToggleControls() {
    this.callBody?.addEventListener("click", (e) => {
      if (
        this.controls.contains(e.target) ||
        this.localPip.contains(e.target) ||
        this.remotePip.contains(e.target) ||
        this.upgradeOverlay.contains(e.target)
      ) return;

      this._toggleControls();
    });
  }

  _toggleControls(force = null) {
    const show = force !== null ? force : !this.controlsVisible;
    this.controlsVisible = show;

    this.controls.classList.toggle("hidden-soft", !show);

    if (show) this._scheduleControlsAutoHide();
    else clearTimeout(this.controlsTimeout);
  }

  _scheduleControlsAutoHide() {
    clearTimeout(this.controlsTimeout);
    this.controlsTimeout = setTimeout(() => {
      this._toggleControls(false);
    }, 3000);
  }

  // ===========================================================
  // INBOUND OFFER HANDLING
  // ===========================================================
  _enterInboundUpgradeMode(peerId) {
    this._openWindow();
    this._setStatus("Incoming video…");

    this.windowEl.classList.add("video-upgrade-mode", "inbound-mode");
    this.windowEl.classList.remove("active-mode");

    this.answerBtn.classList.remove("hidden");
    this.declineBtn.classList.remove("hidden");
    this.muteBtn.classList.add("hidden");
    this.camBtn.classList.add("hidden");
    this.endBtn.classList.add("hidden");

    if (isMobile()) {
      this.callGrid.classList.add("mobile-video-preview");
    } else {
      this.callGrid.classList.add("desktop-video-preview");
    }

    this.upgradeOverlay.classList.remove("hidden");
    this.upgradeOverlay.classList.add("show");
  }

  _exitUpgradeOverlay() {
    this.windowEl.classList.remove("video-upgrade-mode");
    this.callGrid.classList.remove("mobile-video-preview", "desktop-video-preview");
    this.upgradeOverlay.classList.remove("show");
    this.upgradeOverlay.classList.add("hidden");
  }

  // ===========================================================
  // WINDOW + MODES
  // ===========================================================
  _openWindow() {
    this.windowEl.classList.remove("hidden");
    this.windowEl.classList.add("is-open", "call-opening");

    setTimeout(() => this.windowEl.classList.remove("call-opening"), 300);

    this.controls.classList.remove("hidden");
    this.controlsVisible = true;
    this.controls.classList.remove("hidden-soft");
    this._scheduleControlsAutoHide();

    this.primaryIsRemote = true;
    this.pipPos = null;

    this._resetPipToDefault();
    this._applyPrimaryLayout();
  }

  _closeWindow() {
    this.windowEl.classList.remove(
      "is-open",
      "inbound-mode",
      "active-mode",
      "voice-only-call",
      "camera-off",
      "video-upgrade-mode",
      "screen-sharing"
    );
    this.windowEl.classList.add("hidden");

    this.controls.classList.add("hidden");
    this._exitUpgradeOverlay();
  }

  _enterOutboundVoiceMode() {
    this._setStatus("Calling…");
    rtcState.status = "calling";
    this._applyModeFlags({ inbound: false, active: false, video: false });
  }

  _enterOutboundVideoMode() {
    this._setStatus("Video calling…");
    rtcState.status = "calling";
    this._applyModeFlags({ inbound: false, active: false, video: true });
  }

  _enterInboundVoiceMode() {
    this._setStatus("Incoming call");
    rtcState.status = "ringing";
    this._applyModeFlags({ inbound: true, active: false, video: false });
  }

  _enterInboundVideoMode() {
    this._setStatus("Incoming video");
    rtcState.status = "ringing";
    this._applyModeFlags({ inbound: true, active: false, video: true });
  }

  _enterActiveVoiceMode() {
    this._setStatus("In call");
    rtcState.status = "in-call";
    this._applyModeFlags({ inbound: false, active: true, video: false });
  }

  _enterActiveVideoMode() {
    this._setStatus("In video call");
    rtcState.status = "in-call";
    this._applyModeFlags({ inbound: false, active: true, video: true });
    this._applyPrimaryLayout();
  }

  _applyModeFlags({ inbound, active, video }) {
    this.windowEl.classList.toggle("inbound-mode", inbound);
    this.windowEl.classList.toggle("active-mode", active);
    this.windowEl.classList.toggle("voice-only-call", !video);

    if (!video) this.windowEl.classList.remove("camera-off");

    this.controls.classList.remove("hidden");
  }

  _resetUI() {
    rtcState.inCall = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.incomingIsVideo = false;
    rtcState.status = "idle";

    this._closeWindow();
    this._setStatus("Call ended");

    this.timerEl.textContent = "00:00";
    this.callStartTime = null;

    clearInterval(this.timerInterval);
    this.timerInterval = null;

    this.moreMenu.classList.add("hidden");
    this.moreMenu.classList.remove("show");

    this.primaryIsRemote = true;
    this.pipPos = null;

    this.localPip.classList.add("hidden");
    this.remotePip.classList.add("hidden");
    this.localTile.classList.add("hidden");

    this._applyPrimaryLayout();
  }

  // ===========================================================
  // STATUS + AUDIO
  // ===========================================================
  _setStatus(text) {
    this.statusEl.textContent = text;
  }

  _playRingtone() {
    this.ringtone.currentTime = 0;
    this.ringtone.loop = true;
    this.ringtone.play().catch(() => {});
  }

  _playRingback() {
    this.ringback.currentTime = 0;
    this.ringback.loop = true;
    this.ringback.play().catch(() => {});
  }

  _stopRinging() {
    this.ringtone.pause();
    this.ringtone.currentTime = 0;

    this.ringback.pause();
    this.ringback.currentTime = 0;
  }

  // ===========================================================
  // TOASTS + VOICEMAIL
  // ===========================================================
  _showUnavailableToast(message) {
    if (!this.unavailableToast) return;
    const msgEl = this.unavailableToast.querySelector(".ut-message");
    if (msgEl) msgEl.textContent = message || "";
    this.unavailableToast.classList.remove("hidden");
  }

  _hideUnavailableToast() {
    if (!this.unavailableToast) return;
    this.unavailableToast.classList.add("hidden");
  }

  _openVoicemailModal() {
    if (!this.voicemailModal) return;
    this.voicemailModal.classList.remove("hidden");
  }

  _closeVoicemailModal() {
    if (!this.voicemailModal) return;
    this.voicemailModal.classList.add("hidden");
  }

  // ===========================================================
  // PRIMARY / PIP + SWAP ANIMATION + DRAG
  // ===========================================================
  _animateSwap(pipEl, primaryEl) {
    if (!pipEl || !primaryEl) {
      this._applyPrimaryLayout();
      return;
    }

    pipEl.classList.add("pip-anim");
    primaryEl.classList.add("primary-anim");

    pipEl.classList.add("shrink", "fade-out");
    primaryEl.classList.add("fade-out");

    setTimeout(() => {
      pipEl.classList.remove("shrink");

      this._applyPrimaryLayout();

      pipEl.classList.remove("fade-out");
      primaryEl.classList.remove("fade-out");

      pipEl.classList.add("fade-in");
      primaryEl.classList.add("fade-in");

      setTimeout(() => {
        pipEl.classList.remove("fade-in");
        primaryEl.classList.remove("fade-in");
      }, 200);
    }, 180);
  }

  _togglePrimary(remoteEl) {
    if (!remoteEl) return;

    const pipEl = this.primaryIsRemote ? this.localPip : this.remotePip;
    const primaryEl = this.primaryIsRemote ? remoteEl : this.localTile;

    this.primaryIsRemote = !this.primaryIsRemote;

    this._animateSwap(pipEl, primaryEl);
  }

  _resetPipToDefault() {
    if (!this.callBody) return;

    const pipEl = this.primaryIsRemote ? this.localPip : this.remotePip;
    if (!pipEl) return;

    const parent = this.callBody.getBoundingClientRect();
    const pipRect = pipEl.getBoundingClientRect();

    const margin = 16;
    const x = Math.max(0, parent.width - pipRect.width - margin);
    const y = margin;

    this.pipPos = { x, y };

    pipEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  _applyPrimaryLayout(remoteOverride = null) {
    const remoteEl =
      remoteOverride ||
      this.callGrid?.querySelector(".participant.remote") ||
      null;

    // No remote yet → local is primary
    if (!remoteEl) {
      this.localTile?.classList.remove("hidden");
      this.localPip?.classList.add("hidden");
      this.remotePip?.classList.add("hidden");
      return;
    }

    if (!this.pipPos) {
      this._resetPipToDefault();
    }

    const applyTransform = (pipEl) => {
      if (!pipEl || !this.pipPos) return;
      pipEl.style.transform = `translate3d(${this.pipPos.x}px, ${this.pipPos.y}px, 0)`;
    };

    if (this.primaryIsRemote) {
      this.localTile?.classList.add("hidden");
      remoteEl.classList.remove("hidden");

      this.localPip?.classList.remove("hidden");
      applyTransform(this.localPip);

      this.remotePip?.classList.add("hidden");
    } else {
      this.localTile?.classList.remove("hidden");
      remoteEl.classList.add("hidden");

      this.remotePip?.classList.remove("hidden");
      applyTransform(this.remotePip);

      this.localPip?.classList.add("hidden");
    }
  }

  // ===========================================================
  // PiP DRAGGING
  // ===========================================================
  _initPipDrag() {
    const pipTargets = [this.localPip, this.remotePip].filter(Boolean);
    pipTargets.forEach((pipEl) => {
      pipEl.addEventListener("pointerdown", (e) =>
        this._onPipPointerDown(e, pipEl)
      );
    });
  }

  _onPipPointerDown(e, pipEl) {
    if (!this.callBody) return;
    e.preventDefault();
    pipEl.setPointerCapture(e.pointerId);

    const parentRect = this.callBody.getBoundingClientRect();
    const pipRect = pipEl.getBoundingClientRect();

    const startX = e.clientX;
    const startY = e.clientY;

    const currentX = this.pipPos?.x ?? pipRect.left - parentRect.left;
    const currentY = this.pipPos?.y ?? pipRect.top - parentRect.top;

    this.dragState = {
      pointerId: e.pointerId,
      startX,
      startY,
      startPosX: currentX,
      startPosY: currentY,
      parentRect,
      pipRect,
      pipEl,
    };

    pipEl.classList.add("dragging");

    const moveHandler = (evt) => this._onPipPointerMove(evt);
    const upHandler = (evt) => this._onPipPointerUp(evt, moveHandler, upHandler);

    window.addEventListener("pointermove", moveHandler);
    window.addEventListener("pointerup", upHandler);
    window.addEventListener("pointercancel", upHandler);
  }

  _onPipPointerMove(e) {
    if (!this.dragState) return;
    if (e.pointerId !== this.dragState.pointerId) return;

    const dx = e.clientX - this.dragState.startX;
    const dy = e.clientY - this.dragState.startY;

    let x = this.dragState.startPosX + dx;
    let y = this.dragState.startPosY + dy;

    const margin = 8;
    const maxX =
      this.dragState.parentRect.width - this.dragState.pipRect.width - margin;
    const maxY =
      this.dragState.parentRect.height - this.dragState.pipRect.height - margin;

    x = Math.max(margin, Math.min(maxX, x));
    y = Math.max(margin, Math.min(maxY, y));

    this.pipPos = { x, y };
    this.dragState.pipEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  _onPipPointerUp(e, moveHandler, upHandler) {
    if (!this.dragState) return;
    if (e.pointerId !== this.dragState.pointerId) return;

    const pipEl = this.dragState.pipEl;
    pipEl.classList.remove("dragging");
    pipEl.releasePointerCapture(this.dragState.pointerId);

    window.removeEventListener("pointermove", moveHandler);
    window.removeEventListener("pointerup", upHandler);
    window.removeEventListener("pointercancel", upHandler);

    this._snapPipToEdge();
    this.dragState = null;
  }

  _snapPipToEdge() {
    if (!this.pipPos || !this.callBody) return;

    const parentRect = this.callBody.getBoundingClientRect();
    const pipEl = this.primaryIsRemote ? this.localPip : this.remotePip;
    if (!pipEl) return;

    const pipRect = pipEl.getBoundingClientRect();
    const margin = 16;

    const centerX = this.pipPos.x + pipRect.width / 2;
    const centerY = this.pipPos.y + pipRect.height / 2;

    const distLeft = centerX;
    const distRight = parentRect.width - centerX;
    const distTop = centerY;
    const distBottom = parentRect.height - centerY;

    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    let x = this.pipPos.x;
    let y = this.pipPos.y;

    if (minDist === distLeft) {
      x = margin;
    } else if (minDist === distRight) {
      x = parentRect.width - pipRect.width - margin;
    } else if (minDist === distTop) {
      y = margin;
    } else {
      y = parentRect.height - pipRect.height - margin;
    }

    this.pipPos = { x, y };
    pipEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  // ===========================================================
  // TIMER + QUALITY MONITOR
  // ===========================================================
  _startTimerLoop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    this.timerInterval = setInterval(() => {
      if (!this.callStartTime || !this.timerEl) return;
      const elapsed = Date.now() - this.callStartTime;
      this.timerEl.textContent = formatDuration(elapsed);
    }, 1000);
  }

  _startQualityMonitor() {
    if (!this.qualityEl) return;
    this._updateQualityLevel(rtcState.lastQualityLevel || "poor");
  }

  _updateQualityLevel(level) {
    if (!this.qualityEl) return;
    this.qualityEl.dataset.level = String(level || "").toLowerCase();
  }

  // ===========================================================
  // STAGE MODE (SCREEN SHARE)
  // ===========================================================
  _enterStageMode() {
    this.callGrid?.classList.add("screen-share-mode");
  }

  _exitStageMode() {
    this.callGrid?.classList.remove("screen-share-mode");
  }
}




































