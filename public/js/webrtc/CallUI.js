// public/js/webrtc/CallUI.js
// ============================================================
// CallUI: orchestrates call window, controls, and WebRTCController
// ============================================================

import { rtcState } from "./WebRTCState.js";
import { WebRTCController } from "./WebRTCController.js";

function log(...args) {
  console.log("[CallUI]", ...args);
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function isMobile() {
  return window.matchMedia("(max-width: 900px)").matches;
}

export class CallUI {
  constructor(socket) {
    this.socket = socket;
    this.rtc = new WebRTCController(socket);

    // -------------------------------------------------------
    // DOM REFERENCES
    // -------------------------------------------------------
    this.videoContainer = document.getElementById("callWindow");
    this.callBody = this.videoContainer?.querySelector(".call-body") || null;
    this.callGrid = document.getElementById("callGrid");

    // Local participant
    this.localWrapper = document.getElementById("localParticipant");
    this.localVideo = document.getElementById("localVideo");
    this.localAvatarImg = document.getElementById("localAvatarImg");

    // Remote audio
    this.remoteAudio = document.getElementById("remoteAudio");

    // Controls + status
    this.callControls = document.getElementById("call-controls");
    this.statusEl = document.getElementById("call-status");
    this.timerEl = document.getElementById("call-timer");
    this.qualityEl = document.getElementById("call-quality-indicator");

    // Local PiP
    this.localPip = document.getElementById("localPip");
    this.localPipVideo = document.getElementById("localPipVideo");

    // Buttons
    this.answerBtn = document.getElementById("answer-call");
    this.declineBtn = document.getElementById("decline-call");
    this.muteBtn = document.getElementById("mute-call");
    this.camBtn = document.getElementById("camera-toggle");
    this.endBtn = document.getElementById("end-call");

    // More controls
    this.moreBtn = document.getElementById("more-controls-btn");
    this.moreMenu = document.getElementById("more-controls-menu");
    this.shareBtn = document.getElementById("share-screen");
    this.noiseBtn = document.getElementById("ai-noise-toggle");
    this.recordBtn = document.getElementById("record-call");
    this.historyBtn = document.getElementById("call-history-toggle");

    // Debug toggle
    this.debugToggleBtn = document.getElementById("call-debug-toggle");

    // Video upgrade overlay
    this.videoUpgradeOverlay = document.getElementById("video-upgrade-overlay");
    this.videoUpgradeAcceptBtn = document.getElementById("video-upgrade-accept");
    this.videoUpgradeDeclineBtn = document.getElementById("video-upgrade-decline");
    this.videoUpgradeAcceptDesktopBtn = document.getElementById("video-upgrade-accept-desktop");
    this.videoUpgradeDeclineDesktopBtn = document.getElementById("video-upgrade-decline-desktop");

    // Audio cues
    this.ringtone = document.getElementById("ringtone");
    this.ringback = document.getElementById("ringback");
    this.cameraOnBeep = document.getElementById("cameraOnBeep");

    // Layout state
    this._primaryIsRemote = true;
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

    this.socket.emit("call:start", { to: peerId, type: "voice" });

    this._openWindow();
    this._enterOutboundVoiceMode();
    this.rtc.startCall(peerId, { audio: true, video: false });
    this._playRingback();
  }

  startVideoCall(peerId) {
    log("startVideoCall", peerId);
    rtcState.audioOnly = false;
    rtcState.peerId = String(peerId);

    this.socket.emit("call:start", { to: peerId, type: "video" });

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
    if (isVideo) this._enterInboundVideoMode();
    else this._enterInboundVoiceMode();

    this._playRingtone();
  }

  answerCall() {
    log("answerCall");

    // Accepting video upgrade
    if (this.videoContainer.classList.contains("video-upgrade-mode")) {
      this._exitVideoUpgradePreview();
      rtcState.audioOnly = false;
      this.rtc.answerCall();
      this._enterActiveVideoMode();
      return;
    }

    this._stopRinging();
    this.rtc.answerCall();

    if (rtcState.audioOnly) this._enterActiveVoiceMode();
    else this._enterActiveVideoMode();
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
  // CONTROLLER EVENTS
  // -------------------------------------------------------
  _bindControllerEvents() {
    this.rtc.onCallStarted = () => {
      this._stopRinging();
      if (rtcState.audioOnly) this._enterActiveVoiceMode();
      else this._enterActiveVideoMode();
    };

    this.rtc.onCallEnded = () => {
      this._stopRinging();
      this._resetUI();
    };

    this.rtc.onRemoteJoin = () => {
      this._setStatus("Connected");
    };

    this.rtc.onRemoteLeave = () => {
      this._setStatus("Remote left");
      this._resetUI();
    };

    this.rtc.onIncomingOffer = (peerId, offer) => {
      this._handleIncomingOffer(peerId, offer);
    };

    this.rtc.onRemoteUpgradedToVideo = () => {
      if (this.cameraOnBeep) {
        this.cameraOnBeep.currentTime = 0;
        this.cameraOnBeep.play().catch(() => {});
      }
      rtcState.audioOnly = false;
      this._enterVideoControlsMode();
      this._setStatus("Camera enabled by other side");
    };

    this.rtc.onQualityUpdate = (score) => {
      if (this.qualityEl) this.qualityEl.textContent = score;
    };
  }

  // -------------------------------------------------------
  // BUTTON LOGIC
  // -------------------------------------------------------
  _bindButtons() {
    this.answerBtn?.addEventListener("click", () => this.answerCall());
    this.declineBtn?.addEventListener("click", () => this.endCall());
    this.endBtn?.addEventListener("click", () => this.endCall());

    // Mute
    this.muteBtn?.addEventListener("click", () => {
      const stream = rtcState.localStream;
      if (!stream) return;
      const enabled = stream.getAudioTracks().some((t) => t.enabled);
      stream.getAudioTracks().forEach((t) => (t.enabled = !enabled));
      this.muteBtn.classList.toggle("active", !enabled);
    });

    // Camera toggle (upgrade or toggle)
    this.camBtn?.addEventListener("click", async () => {
      if (rtcState.audioOnly || !rtcState.localStream?.getVideoTracks().length) {
        await this.upgradeToVideo();
        return;
      }

      const stream = rtcState.localStream;
      const enabled = stream.getVideoTracks().some((t) => t.enabled);
      const newEnabled = !enabled;
      stream.getVideoTracks().forEach((t) => (t.enabled = newEnabled));
      this.camBtn.classList.toggle("active", newEnabled);

      if (!newEnabled) this.videoContainer.classList.add("camera-off");
      else this.videoContainer.classList.remove("camera-off");
    });

    // More menu
    this.moreBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = this.moreMenu.classList.contains("show");
      this.moreMenu.classList.toggle("show", !isOpen);
      this.moreMenu.classList.toggle("hidden", isOpen);
    });

    document.addEventListener("click", (e) => {
      if (!this.moreMenu.contains(e.target) && e.target !== this.moreBtn) {
        this.moreMenu.classList.remove("show");
        this.moreMenu.classList.add("hidden");
      }
    });

    // More menu actions
    this.shareBtn?.addEventListener("click", () => {
      this.rtc.startScreenShare();
      this.moreMenu.classList.remove("show");
      this.moreMenu.classList.add("hidden");
    });

    this.noiseBtn?.addEventListener("click", () => {
      this.noiseBtn.classList.toggle("active");
    });

    this.recordBtn?.addEventListener("click", () => {
      this.recordBtn.classList.toggle("active");
    });

    this.historyBtn?.addEventListener("click", () => {
      this.historyBtn.classList.toggle("active");
    });

    // Debug toggle
    this.debugToggleBtn?.addEventListener("click", () => {
      this.debugToggleBtn.classList.toggle("active");
    });

    // Video upgrade overlay buttons
    this.videoUpgradeAcceptBtn?.addEventListener("click", () => this.answerCall());
    this.videoUpgradeDeclineBtn?.addEventListener("click", () => {
      this._exitVideoUpgradePreview();
      this._setStatus("In call");
      this._enterActiveVoiceMode();
    });

    this.videoUpgradeAcceptDesktopBtn?.addEventListener("click", () => this.answerCall());
    this.videoUpgradeDeclineDesktopBtn?.addEventListener("click", () => {
      this._exitVideoUpgradePreview();
      this._setStatus("In call");
      this._enterActiveVoiceMode();
    });

    // Double-tap swap (local vs first remote)
    const firstRemote = () =>
      this.callGrid?.querySelector(".participant.remote") || null;

    if (this.localWrapper) {
      this._bindDoubleTap(this.localWrapper, () => {
        this._togglePrimary(firstRemote());
      });
    }

    const initialRemote = firstRemote();
    if (initialRemote) {
      this._bindDoubleTap(initialRemote, () => {
        this._togglePrimary(initialRemote);
      });
    }
  }

  _bindDoubleTap(el, handler) {
    if (!el) return;
    let lastTap = 0;
    el.addEventListener("click", () => {
      const now = Date.now();
      if (now - lastTap < 300) handler();
      lastTap = now;
    });
  }

  // -------------------------------------------------------
  // INBOUND OFFER HANDLING
  // -------------------------------------------------------
  _handleIncomingOffer(peerId, offer) {
    const isVideoUpgrade =
      rtcState.audioOnly === true &&
      offer?.sdp &&
      offer.sdp.includes("m=video");

    if (isVideoUpgrade) {
      this._enterInboundVideoUpgradeMode(peerId);
      return;
    }

    const isVideo = !rtcState.audioOnly;
    this.receiveInboundCall(peerId, isVideo);
  }

  _enterInboundVideoUpgradeMode(peerId) {
    log("Inbound video upgrade request from", peerId);

    this._openWindow();
    this._setStatus("Incoming video…");

    if (this.cameraOnBeep) {
      this.cameraOnBeep.currentTime = 0;
      this.cameraOnBeep.play().catch(() => {});
    }

    this.videoContainer.classList.add("video-upgrade-mode", "inbound-mode");
    this.videoContainer.classList.remove("active-mode");

    this.answerBtn?.classList.remove("hidden");
    this.declineBtn?.classList.remove("hidden");
    this.muteBtn?.classList.add("hidden");
    this.camBtn?.classList.add("hidden");
    this.endBtn?.classList.add("hidden");

    if (isMobile()) {
      this.callGrid.classList.add("mobile-video-preview");
      this.callGrid.classList.remove("desktop-video-preview");
    } else {
      this.callGrid.classList.add("desktop-video-preview");
      this.callGrid.classList.remove("mobile-video-preview");
    }

    this.videoUpgradeOverlay?.classList.add("show");
  }

  _exitVideoUpgradePreview() {
    this.videoContainer.classList.remove("video-upgrade-mode");
    this.callGrid.classList.remove("mobile-video-preview", "desktop-video-preview");
    this.videoUpgradeOverlay?.classList.remove("show");
  }

  // -------------------------------------------------------
  // WINDOW + MODES
  // -------------------------------------------------------
  _openWindow() {
    if (!this.videoContainer) return;

    this.videoContainer.classList.remove("hidden");
    this.videoContainer.classList.add("is-open", "call-opening");

    setTimeout(() => {
      this.videoContainer.classList.remove("call-opening");
    }, 300);

    this.callControls?.classList.remove("hidden");

    this._primaryIsRemote = true;
    this._applyPrimaryLayout();
  }

  _closeWindow() {
    if (!this.videoContainer) return;

    this.videoContainer.classList.remove(
      "is-open",
      "inbound-mode",
      "active-mode",
      "voice-only-call",
      "camera-off",
      "video-upgrade-mode"
    );
    this.videoContainer.classList.add("hidden");

    this.callControls?.classList.add("hidden");
    this._exitVideoUpgradePreview();
  }

  _enterOutboundVoiceMode() {
    this._setStatus("Calling…");
    this._showControlsForVoice();
    this._applyModeFlags({ inbound: false, active: false, video: false });
  }

  _enterOutboundVideoMode() {
    this._setStatus("Video calling…");
    this._showControlsForVideo();
    this._applyModeFlags({ inbound: false, active: false, video: true });
  }

  _enterInboundVoiceMode() {
    this._setStatus("Incoming call");
    this._showControlsForVoice();
    this._applyModeFlags({ inbound: true, active: false, video: false });
  }

  _enterInboundVideoMode() {
    this._setStatus("Incoming video");
    this._showControlsForVideo();
    this._applyModeFlags({ inbound: true, active: false, video: true });
  }

  _enterActiveVoiceMode() {
    this._setStatus("In call");
    this._showControlsForVoice();
    this._applyModeFlags({ inbound: false, active: true, video: false });
  }

  _enterActiveVideoMode() {
    this._setStatus("In video call");
    this._showControlsForVideo();
    this._applyModeFlags({ inbound: false, active: true, video: true });
    this._applyPrimaryLayout();
  }

  _enterVideoControlsMode() {
    this._enterActiveVideoMode();
  }

  _applyModeFlags({ inbound, active, video }) {
    if (!this.videoContainer) return;

    this.videoContainer.classList.toggle("inbound-mode", !!inbound);
    this.videoContainer.classList.toggle("active-mode", !!active);

    const isVoiceOnly = !video;
    this.videoContainer.classList.toggle("voice-only-call", isVoiceOnly);
    this.videoContainer.classList.toggle("camera-off", isVoiceOnly);

    this.callControls?.classList.remove("hidden");
  }

  _resetUI() {
    rtcState.inCall = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.incomingIsVideo = false;

    this._closeWindow();
    this._setStatus("Call ended");
    if (this.timerEl) this.timerEl.textContent = "00:00";

    if (this.moreMenu) {
      this.moreMenu.classList.remove("show");
      this.moreMenu.classList.add("hidden");
    }
  }

  // -------------------------------------------------------
  // CONTROLS VISIBILITY
  // -------------------------------------------------------
  _showControlsForVoice() {
    if (!this.callControls) return;
    this.camBtn?.classList.add("hidden-soft");
  }

  _showControlsForVideo() {
    if (!this.callControls) return;
    this.camBtn?.classList.remove("hidden-soft");
  }

  // -------------------------------------------------------
  // STATUS
  // -------------------------------------------------------
  _setStatus(text) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text || "";
  }

  // -------------------------------------------------------
  // AUDIO CUES
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
  // PRIMARY / PIP + DRAG
  // -------------------------------------------------------
  _togglePrimary(remoteEl) {
    if (!this.localWrapper || !remoteEl) return;
    this._primaryIsRemote = !this._primaryIsRemote;
    this._applyPrimaryLayout(remoteEl);
  }

  _applyPrimaryLayout() {
    // CSS handles layout; hook left for future enhancements
  }

  _initPipDrag() {
    const pipEl = this.localWrapper;
    if (!pipEl || !this.callBody) return;

    const startDrag = (x, y) => {
      const rect = pipEl.getBoundingClientRect();
      const parent = this.callBody.getBoundingClientRect();
      this._dragState = {
        offsetX: x - rect.left,
        offsetY: y - rect.top,
        parent,
      };
    };

    const moveDrag = (x, y) => {
      if (!this._dragState) return;
      const { offsetX, offsetY, parent } = this._dragState;

      let newX = x - offsetX - parent.left;
      let newY = y - offsetY - parent.top;

      newX = Math.max(0, Math.min(parent.width - pipEl.offsetWidth, newX));
      newY = Math.max(0, Math.min(parent.height - pipEl.offsetHeight, newY));

      pipEl.style.transform = `translate(${newX}px, ${newY}px)`;
    };

    const endDrag = () => {
      this._dragState = null;
    };

    pipEl.addEventListener("pointerdown", (e) => {
      pipEl.setPointerCapture(e.pointerId);
      startDrag(e.clientX, e.clientY);
    });

    pipEl.addEventListener("pointermove", (e) => moveDrag(e.clientX, e.clientY));
    pipEl.addEventListener("pointerup", endDrag);
    pipEl.addEventListener("pointercancel", endDrag);
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
    // Already wired via this.rtc.onQualityUpdate → this.qualityEl
  }
}



















































