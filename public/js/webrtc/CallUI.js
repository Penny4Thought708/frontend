// public/js/webrtc/CallUI.js
// ============================================================
// CallUI: orchestrates call window, controls, and WebRTCController
// FaceTime‑style A1‑Swap with PiP persistence + JS positioning
// Features:
//   - Remote-primary layout with local/remote PiP
//   - PiP drag + edge snapping + snap-away from controls
//   - Double-tap swap with smooth animations
//   - Tap-to-toggle controls + auto-hide
//   - Screen-share stage mode hooks
//   - Active speaker pulse (via CSS + RemoteParticipants)
//   - Multi-remote swap support (any remote tile)
//   - Voicemail + toast wiring hooks
//   - Debug overlay + analytics hook points
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

    // Local participant (grid tile)
    this.localWrapper = document.getElementById("localParticipant");
    this.localVideo = document.getElementById("localVideo");

    // Remote audio
    this.remoteAudio = document.getElementById("remoteAudio");

    // Controls + status
    this.callControls = document.getElementById("call-controls");
    this.statusEl = document.getElementById("call-status");
    this.timerEl = document.getElementById("call-timer");
    this.qualityEl = document.getElementById("call-quality-indicator");

    // PiP windows
    this.localPip = document.getElementById("localPip");
    this.localPipVideo = document.getElementById("localPipVideo");

    this.remotePip = document.getElementById("remotePip");
    this.remotePipVideo = document.getElementById("remotePipVideo");

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

    // Debug toggle + overlay
    this.debugToggleBtn = document.getElementById("call-debug-toggle");
    this.debugOverlay = document.getElementById("call-debug-overlay");

    // Video upgrade overlay
    this.videoUpgradeOverlay = document.getElementById("video-upgrade-overlay");
    this.videoUpgradeAcceptBtn = document.getElementById("video-upgrade-accept");
    this.videoUpgradeDeclineBtn = document.getElementById("video-upgrade-decline");
    this.videoUpgradeAcceptDesktopBtn = document.getElementById("video-upgrade-accept-desktop");
    this.videoUpgradeDeclineDesktopBtn = document.getElementById("video-upgrade-decline-desktop");

    // Voicemail modal
    this.voicemailModal = document.getElementById("voicemailModal");
    this.vmRecordBtn = document.getElementById("vmRecordBtn");
    this.vmStopBtn = document.getElementById("vmStopBtn");
    this.vmPlayBtn = document.getElementById("vmPlayBtn");
    this.vmSendBtn = document.getElementById("vmSendBtn");
    this.vmDeleteBtn = document.getElementById("vmDeleteBtn");
    this.vmCancelBtn = document.getElementById("vmCancelBtn");

    // Toasts
    this.secondaryIncomingToast = document.getElementById("secondaryIncomingToast");
    this.unavailableToast = document.getElementById("unavailableToast");
    this.genericToast = document.getElementById("genericToast");
    this.mediaToast = document.getElementById("mediaToast");

    this.utVoiceBtn = document.getElementById("utVoiceBtn");
    this.utVideoBtn = document.getElementById("utVideoBtn");
    this.utTextBtn = document.getElementById("utTextBtn");

    // Audio cues
    this.ringtone = document.getElementById("ringtone");
    this.ringback = document.getElementById("ringback");
    this.cameraOnBeep = document.getElementById("cameraOnBeep");

    // -------------------------------------------------------
    // LAYOUT STATE
    // -------------------------------------------------------
    this._primaryIsRemote = true;

    // PiP position (JS‑controlled) — null means "needs default"
    this._pipPos = null;
    this._pipDefault = null;

    // Drag state
    this._dragState = null;

    // Controls visibility state (tap-to-toggle + auto-hide)
    this._controlsVisible = true;
    this._controlsHideTimeout = null;

    // Timer
    this._callStartTime = null;
    this._timerInterval = null;

    // Analytics hook placeholder
    this._analytics = (event, payload = {}) => {
      // Drop-in hook for production analytics
      // console.log("[Analytics]", event, payload);
    };

    // Hide local grid tile by default
    if (this.localWrapper) this.localWrapper.classList.add("hidden");
    if (this.remotePip) this.remotePip.classList.add("hidden");

    this._bindButtons();
    this._bindControllerEvents();
    this._initPipDrag();
    this._bindTapToToggleControls();
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
    this._analytics("call_start_voice", { peerId });

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
    this._analytics("call_start_video", { peerId });

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
    this._analytics("call_inbound", { peerId, isVideo });
  }

  answerCall() {
    log("answerCall");

    // Accepting video upgrade
    if (this.videoContainer?.classList.contains("video-upgrade-mode")) {
      this._exitVideoUpgradePreview();
      rtcState.audioOnly = false;
      this.rtc.answerCall();
      this._enterActiveVideoMode();
      this._analytics("call_answer_upgrade", { peerId: rtcState.peerId });
      return;
    }

    this._stopRinging();
    this.rtc.answerCall();
    this._callStartTime = Date.now();
    this._analytics("call_answer", {
      peerId: rtcState.peerId,
      audioOnly: rtcState.audioOnly,
    });

    if (rtcState.audioOnly) this._enterActiveVoiceMode();
    else this._enterActiveVideoMode();
  }

  endCall(reason = "local_end") {
    log("endCall", reason);
    this._stopRinging();
    this.rtc.endCall(reason);
    this._analytics("call_end", { peerId: rtcState.peerId, reason });
    this._resetUI();
  }

  async upgradeToVideo() {
    log("upgradeToVideo");
    this._analytics("call_upgrade_to_video_click", { peerId: rtcState.peerId });

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
      this._callStartTime = Date.now();
      this._analytics("call_started_media", {
        peerId: rtcState.peerId,
        audioOnly: rtcState.audioOnly,
      });

      if (rtcState.audioOnly) this._enterActiveVoiceMode();
      else this._enterActiveVideoMode();
    };

    this.rtc.onCallEnded = (reason = "remote_end") => {
      this._stopRinging();
      this._analytics("call_ended_media", { peerId: rtcState.peerId, reason });
      this._resetUI();
    };

    this.rtc.onRemoteJoin = () => {
      this._setStatus("Connected");
      this._applyPrimaryLayout();
      this._analytics("remote_join", { peerId: rtcState.peerId });
    };

    this.rtc.onRemoteLeave = () => {
      this._setStatus("Remote left");
      this._analytics("remote_leave", { peerId: rtcState.peerId });
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
      this._analytics("remote_upgraded_to_video", { peerId: rtcState.peerId });
    };

    this.rtc.onQualityUpdate = (score) => {
      if (this.qualityEl) {
        this.qualityEl.textContent = score;
        this._updateQualityLevel(score);
      }
      if (this.debugOverlay) {
        this.debugOverlay.textContent = `Quality: ${score}`;
      }
    };

    // Screen share hooks
    this.rtc.onScreenShareStarted = () => {
      this.videoContainer?.classList.add("screen-sharing");
      this._enterStageMode();
      this._analytics("screen_share_started", { peerId: rtcState.peerId });
    };
    this.rtc.onScreenShareStopped = () => {
      this.videoContainer?.classList.remove("screen-sharing");
      this._exitStageMode();
      this._analytics("screen_share_stopped", { peerId: rtcState.peerId });
    };

    // Unavailability → toast/voicemail
    this.rtc.onPeerUnavailable = (reason) => {
      this._analytics("peer_unavailable", { peerId: rtcState.peerId, reason });
      this._showUnavailableToast(reason || "User is unavailable");
    };
  }

  // -------------------------------------------------------
  // BUTTON LOGIC — FIXED + PRODUCTION‑READY
  // -------------------------------------------------------
  _bindButtons() {
    // ANSWER
    this.answerBtn?.addEventListener("click", () => {
      this._stopRinging();
      this.answerCall();
    });

    // DECLINE (REAL DECLINE → CLOSE WINDOW → VOICEMAIL)
    this.declineBtn?.addEventListener("click", () => {
      log("Decline inbound call");

      this._stopRinging();

      this.socket.emit("call:declined", {
        from: rtcState.selfId,
        to: rtcState.peerId,
        callId: rtcState.callId,
      });

      this._closeWindow();
      this._openVoicemailModal();

      this._analytics("call_decline", { peerId: rtcState.peerId });
    });

    // END CALL (ACTIVE CALL ONLY)
    this.endBtn?.addEventListener("click", () => {
      log("End active call");
      this._stopRinging();
      this.endCall("end_button");
    });

    // MUTE
    this.muteBtn?.addEventListener("click", () => {
      const stream = rtcState.localStream;
      if (!stream) return;
      const enabled = stream.getAudioTracks().some((t) => t.enabled);
      stream.getAudioTracks().forEach((t) => (t.enabled = !enabled));
      this.muteBtn.classList.toggle("active", !enabled);
      this._analytics("toggle_mute", { enabled: !enabled });
    });

    // CAMERA TOGGLE (UPGRADE OR TOGGLE)
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

      if (!newEnabled) this.videoContainer?.classList.add("camera-off");
      else this.videoContainer?.classList.remove("camera-off");

      this._analytics("toggle_camera", { enabled: newEnabled });
    });

    // MORE MENU
    this.moreBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!this.moreMenu) return;
      const isOpen = this.moreMenu.classList.contains("show");
      this.moreMenu.classList.toggle("show", !isOpen);
      this.moreMenu.classList.toggle("hidden", isOpen);
    });

    document.addEventListener("click", (e) => {
      if (!this.moreMenu) return;
      const target = e.target;
      if (!this.moreMenu.contains(target) && target !== this.moreBtn) {
        this.moreMenu.classList.remove("show");
        this.moreMenu.classList.add("hidden");
      }
    });

    // SCREEN SHARE
    this.shareBtn?.addEventListener("click", () => {
      this.rtc.startScreenShare();
      if (this.moreMenu) {
        this.moreMenu.classList.remove("show");
        this.moreMenu.classList.add("hidden");
      }
    });

    // AI NOISE
    this.noiseBtn?.addEventListener("click", () => {
      this.noiseBtn.classList.toggle("active");
      this._analytics("toggle_ai_noise", {
        active: this.noiseBtn.classList.contains("active"),
      });
    });

    // RECORDING UI
    this.recordBtn?.addEventListener("click", () => {
      this.recordBtn.classList.toggle("active");
      this._analytics("toggle_recording_ui", {
        active: this.recordBtn.classList.contains("active"),
      });
    });

    // CALL HISTORY
    this.historyBtn?.addEventListener("click", () => {
      this.historyBtn.classList.toggle("active");
      this._analytics("toggle_call_history", {
        active: this.historyBtn.classList.contains("active"),
      });
    });

    // DEBUG OVERLAY
    this.debugToggleBtn?.addEventListener("click", () => {
      this.debugToggleBtn.classList.toggle("active");
      const active = this.debugToggleBtn.classList.contains("active");
      if (this.debugOverlay) {
        this.debugOverlay.classList.toggle("hidden", !active);
      }
      this._analytics("toggle_debug_overlay", { active });
    });

    // VIDEO UPGRADE OVERLAY
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

    // VOICEMAIL MODAL
    this.vmCancelBtn?.addEventListener("click", () => this._closeVoicemailModal());

    // UNAVAILABLE TOAST → VOICEMAIL
    this.utVoiceBtn?.addEventListener("click", () => {
      this._hideUnavailableToast();
      this._openVoicemailModal();
    });

    this.utVideoBtn?.addEventListener("click", () => {
      this._hideUnavailableToast();
    });

    this.utTextBtn?.addEventListener("click", () => {
      this._hideUnavailableToast();
    });

    // DOUBLE TAP SWAP
    if (this.localPip) {
      this._bindDoubleTap(this.localPip, () => {
        const firstRemote = this._firstRemoteTile();
        this._togglePrimary(firstRemote);
      });
    }

    if (this.callGrid) {
      this.callGrid.addEventListener("click", (e) => {
        const tile = e.target.closest(".participant.remote");
        if (!tile) return;
        this._handleRemoteDoubleTap(tile);
      });
    }
  }

  _firstRemoteTile() {
    return this.callGrid?.querySelector(".participant.remote") || null;
  }

  _handleRemoteDoubleTap(tile) {
    if (!tile) return;
    if (!this._remoteTapState) this._remoteTapState = { lastTap: 0, lastEl: null };

    const now = Date.now();
    const { lastTap, lastEl } = this._remoteTapState;

    if (tile === lastEl && now - lastTap < 300) {
      this._togglePrimary(tile);
      this._remoteTapState.lastTap = 0;
      this._remoteTapState.lastEl = null;
    } else {
      this._remoteTapState.lastTap = now;
      this._remoteTapState.lastEl = tile;
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
  // TAP-TO-TOGGLE CONTROLS + AUTO-HIDE
  // -------------------------------------------------------
  _bindTapToToggleControls() {
    if (!this.callBody || !this.callControls) return;

    this.callBody.addEventListener("click", (e) => {
      const target = e.target;

      if (
        this.callControls.contains(target) ||
        this.localPip?.contains(target) ||
        this.remotePip?.contains(target) ||
        this.videoUpgradeOverlay?.contains(target)
      ) {
        return;
      }

      this._toggleControlsVisibility();
    });
  }

  _toggleControlsVisibility(forceVisible = null) {
    if (!this.callControls) return;

    const shouldShow =
      typeof forceVisible === "boolean" ? forceVisible : !this._controlsVisible;

    this._controlsVisible = shouldShow;
    this.callControls.classList.toggle("hidden-soft", !shouldShow);

    if (shouldShow) {
      this._scheduleControlsAutoHide();
    } else if (this._controlsHideTimeout) {
      clearTimeout(this._controlsHideTimeout);
      this._controlsHideTimeout = null;
    }
  }

  _scheduleControlsAutoHide() {
    if (!this.callControls) return;
    if (this._controlsHideTimeout) {
      clearTimeout(this._controlsHideTimeout);
    }
    this._controlsHideTimeout = setTimeout(() => {
      this._toggleControlsVisibility(false);
    }, 3000);
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

    if (!this.videoContainer) return;

    this.videoContainer.classList.add("video-upgrade-mode", "inbound-mode");
    this.videoContainer.classList.remove("active-mode");

    this.answerBtn?.classList.remove("hidden");
    this.declineBtn?.classList.remove("hidden");
    this.muteBtn?.classList.add("hidden");
    this.camBtn?.classList.add("hidden");
    this.endBtn?.classList.add("hidden");

    if (this.callGrid) {
      if (isMobile()) {
        this.callGrid.classList.add("mobile-video-preview");
        this.callGrid.classList.remove("desktop-video-preview");
      } else {
        this.callGrid.classList.add("desktop-video-preview");
        this.callGrid.classList.remove("mobile-video-preview");
      }
    }

    if (this.videoUpgradeOverlay) {
      this.videoUpgradeOverlay.classList.remove("hidden");
      this.videoUpgradeOverlay.classList.add("show");
    }
  }

  _exitVideoUpgradePreview() {
    if (!this.videoContainer) return;

    this.videoContainer.classList.remove("video-upgrade-mode");
    if (this.callGrid) {
      this.callGrid.classList.remove("mobile-video-preview", "desktop-video-preview");
    }
    if (this.videoUpgradeOverlay) {
      this.videoUpgradeOverlay.classList.remove("show");
      this.videoUpgradeOverlay.classList.add("hidden");
    }
  }

  // -------------------------------------------------------
  // WINDOW + MODES
  // -------------------------------------------------------
  _openWindow() {
    if (!this.videoContainer) return;

    this.videoContainer.classList.remove("hidden");
    this.videoContainer.classList.add("is-open", "call-opening");

    setTimeout(() => {
      this.videoContainer?.classList.remove("call-opening");
    }, 300);

    this.callControls?.classList.remove("hidden");
    this._controlsVisible = true;
    this.callControls?.classList.remove("hidden-soft");
    this._scheduleControlsAutoHide();

    this._primaryIsRemote = true;

    this._pipPos = null;
    this._pipDefault = null;
    this._resetPipToDefault();

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
      "video-upgrade-mode",
      "screen-sharing"
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

    if (isVoiceOnly) {
      this.videoContainer.classList.remove("camera-off");
    }

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
    this._callStartTime = null;

    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }

    if (this.moreMenu) {
      this.moreMenu.classList.remove("show");
      this.moreMenu.classList.add("hidden");
    }

    this._primaryIsRemote = true;

    this._pipPos = null;
    this._pipDefault = null;

    if (this.localPip) this.localPip.classList.add("hidden");
    if (this.remotePip) this.remotePip.classList.add("hidden");

    if (this.localWrapper) this.localWrapper.classList.add("hidden");

    this._applyPrimaryLayout();
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
  // TOASTS + VOICEMAIL
  // -------------------------------------------------------
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

  // -------------------------------------------------------
  // PRIMARY / PIP + SWAP ANIMATION + DRAG
  // -------------------------------------------------------
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

    const pipEl = this._primaryIsRemote ? this.localPip : this.remotePip;
    const primaryEl = this._primaryIsRemote ? remoteEl : this.localWrapper;

    this._primaryIsRemote = !this._primaryIsRemote;

    this._animateSwap(pipEl, primaryEl);
  }

  _resetPipToDefault() {
    if (!this.callBody) return;

    const pipEl = this._primaryIsRemote ? this.localPip : this.remotePip;
    if (!pipEl) return;

    const parent = this.callBody.getBoundingClientRect();
    const pipRect = pipEl.getBoundingClientRect();

    const margin = 16;
    const x = Math.max(0, parent.width - pipRect.width - margin);
    const y = margin;

    this._pipPos = { x, y };
    this._pipDefault = { x, y };

    pipEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  _applyPrimaryLayout(remoteElOverride = null) {
    const remoteEl =
      remoteElOverride ||
      this.callGrid?.querySelector(".participant.remote") ||
      null;

    // If no remote tile yet, show local as primary and hide PiPs
    if (!remoteEl) {
      if (this.localWrapper) this.localWrapper.classList.remove("hidden");
      if (this.localPip) this.localPip.classList.add("hidden");
      if (this.remotePip) this.remotePip.classList.add("hidden");
      return;
    }

    if (!this._pipPos) {
      this._resetPipToDefault();
    }

    const applyPipTransform = (pipEl) => {
      if (!pipEl || !this._pipPos) return;
      pipEl.style.transform = `translate3d(${this._pipPos.x}px, ${this._pipPos.y}px, 0)`;
    };

    if (this._primaryIsRemote) {
      if (this.localWrapper) this.localWrapper.classList.add("hidden");
      if (remoteEl) remoteEl.classList.remove("hidden");

      if (this.localPip) {
        this.localPip.classList.remove("hidden");
        applyPipTransform(this.localPip);
      }
      if (this.remotePip) this.remotePip.classList.add("hidden");
    } else {
      if (this.localWrapper) this.localWrapper.classList.remove("hidden");
      if (remoteEl) remoteEl.classList.add("hidden");

      if (this.remotePip) {
        this.remotePip.classList.remove("hidden");
        applyPipTransform(this.remotePip);
      }
      if (this.localPip) this.localPip.classList.add("hidden");
    }
  }

  _initPipDrag() {
    const pipTargets = [this.localPip, this.remotePip].filter(Boolean);
    pipTargets.forEach((pipEl) => {
      pipEl.addEventListener("pointerdown", (e) => this._onPipPointerDown(e, pipEl));
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

    const currentX = this._pipPos?.x ?? pipRect.left - parentRect.left;
    const currentY = this._pipPos?.y ?? pipRect.top - parentRect.top;

    this._dragState = {
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
    if (!this._dragState) return;
    if (e.pointerId !== this._dragState.pointerId) return;

    const dx = e.clientX - this._dragState.startX;
    const dy = e.clientY - this._dragState.startY;

    let x = this._dragState.startPosX + dx;
    let y = this._dragState.startPosY + dy;

    const margin = 8;
    const maxX =
      this._dragState.parentRect.width - this._dragState.pipRect.width - margin;
    const maxY =
      this._dragState.parentRect.height - this._dragState.pipRect.height - margin;

    x = Math.max(margin, Math.min(maxX, x));
    y = Math.max(margin, Math.min(maxY, y));

    this._pipPos = { x, y };
    this._dragState.pipEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  _onPipPointerUp(e, moveHandler, upHandler) {
    if (!this._dragState) return;
    if (e.pointerId !== this._dragState.pointerId) return;

    const pipEl = this._dragState.pipEl;
    pipEl.classList.remove("dragging");
    pipEl.releasePointerCapture(this._dragState.pointerId);

    window.removeEventListener("pointermove", moveHandler);
    window.removeEventListener("pointerup", upHandler);
    window.removeEventListener("pointercancel", upHandler);

    this._snapPipToEdge();
    this._dragState = null;
  }

  _snapPipToEdge() {
    if (!this._pipPos || !this.callBody) return;

    const parentRect = this.callBody.getBoundingClientRect();
    const pipEl = this._primaryIsRemote ? this.localPip : this.remotePip;
    if (!pipEl) return;

    const pipRect = pipEl.getBoundingClientRect();
    const margin = 16;

    const centerX = this._pipPos.x + pipRect.width / 2;
    const centerY = this._pipPos.y + pipRect.height / 2;

    const distLeft = centerX;
    const distRight = parentRect.width - centerX;
    const distTop = centerY;
    const distBottom = parentRect.height - centerY;

    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    let x = this._pipPos.x;
    let y = this._pipPos.y;

    if (minDist === distLeft) {
      x = margin;
    } else if (minDist === distRight) {
      x = parentRect.width - pipRect.width - margin;
    } else if (minDist === distTop) {
      y = margin;
    } else {
      y = parentRect.height - pipRect.height - margin;
    }

    this._pipPos = { x, y };
    pipEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  // -------------------------------------------------------
  // TIMER + QUALITY MONITOR
  // -------------------------------------------------------
  _startTimerLoop() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
    }

    this._timerInterval = setInterval(() => {
      if (!this._callStartTime || !this.timerEl) return;
      const elapsed = Date.now() - this._callStartTime;
      this.timerEl.textContent = formatDuration(elapsed);
    }, 1000);
  }

  _startQualityMonitor() {
    // UI-only; actual quality updates come from WebRTCController.onQualityUpdate
    if (!this.qualityEl) return;
    this._updateQualityLevel(rtcState.lastQualityLevel || "poor");
  }

  _updateQualityLevel(level) {
    if (!this.qualityEl) return;
    const normalized = String(level || "").toLowerCase();
    this.qualityEl.dataset.level = normalized;
  }

  // -------------------------------------------------------
  // STAGE MODE (SCREEN SHARE)
  // -------------------------------------------------------
  _enterStageMode() {
    if (!this.callGrid) return;
    this.callGrid.classList.add("screen-share-mode");
  }

  _exitStageMode() {
    if (!this.callGrid) return;
    this.callGrid.classList.remove("screen-share-mode");
  }
}






































