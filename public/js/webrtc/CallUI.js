// public/js/webrtc/CallUI.js
// ============================================================
// CallUI: orchestrates call window, controls, and WebRTCController
// FaceTime‑style A1‑Swap with PiP persistence + JS positioning
// Features:
//   - Remote-primary layout with local/remote PiP
//   - PiP drag + edge snapping + snap-away from controls
//   - Double-tap swap with smooth animations
//   - Tap-to-toggle controls + auto-hide
//   - Screen-share mode hooks
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
    this._analytics("call_answer", { peerId: rtcState.peerId, audioOnly: rtcState.audioOnly });

    if (rtcState.audioOnly) this._enterActiveVoiceMode();
    else this._enterActiveVideoMode();
  }

  endCall(reason = "local_end") {
    log("endCall", reason);
    this._stopRinging();
    this.rtc.endCall();
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
      this._analytics("call_started_media", { peerId: rtcState.peerId, audioOnly: rtcState.audioOnly });

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
      if (this.qualityEl) this.qualityEl.textContent = score;
      if (this.debugOverlay) {
        this.debugOverlay.textContent = `Quality: ${score}`;
      }
    };

    // Optional hooks for screen share (if WebRTCController exposes them)
    this.rtc.onScreenShareStarted = () => {
      this.videoContainer?.classList.add("screen-sharing");
      this._analytics("screen_share_started", { peerId: rtcState.peerId });
    };
    this.rtc.onScreenShareStopped = () => {
      this.videoContainer?.classList.remove("screen-sharing");
      this._analytics("screen_share_stopped", { peerId: rtcState.peerId });
    };

    // Optional hooks for unavailability → toast/voicemail
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

    // Notify remote side explicitly
    this.socket.emit("call:declined", {
      from: rtcState.selfId,
      to: rtcState.peerId,
      callId: rtcState.callId,
    });

    // Close call window immediately
    this._closeWindow();

    // Show voicemail queue card
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

      // Ignore taps on controls, PiP, overlays
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
    } else {
      if (this._controlsHideTimeout) {
        clearTimeout(this._controlsHideTimeout);
        this._controlsHideTimeout = null;
      }
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

    // Reset PiP to default top‑right
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

    // Reset primary state
    this._primaryIsRemote = true;

    // Reset PiP position to default top‑right
    this._pipPos = null;
    this._pipDefault = null;

    // Hide both PiPs until next call
    if (this.localPip) this.localPip.classList.add("hidden");
    if (this.remotePip) this.remotePip.classList.add("hidden");

    // Hide local grid tile
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

      // Apply new layout
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

    pipEl.style.transform = `translate(${x}px, ${y}px)`;
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
      pipEl.style.transform = `translate(${this._pipPos.x}px, ${this._pipPos.y}px)`;
      pipEl.classList.add("pip-anim");
    };

    if (this._primaryIsRemote) {
      // Remote = primary, local = PiP
      if (this.localWrapper) this.localWrapper.classList.add("hidden");
      if (this.localPip) {
        this.localPip.classList.remove("hidden");
        applyPipTransform(this.localPip);
      }
      if (this.remotePip) this.remotePip.classList.add("hidden");

      remoteEl.classList.remove("hidden");
    } else {
      // Local = primary, remote = PiP
      if (this.localWrapper) this.localWrapper.classList.remove("hidden");
      if (this.localPip) this.localPip.classList.add("hidden");

      if (this.remotePip) {
        this.remotePip.classList.remove("hidden");
        applyPipTransform(this.remotePip);
      }

      remoteEl.classList.add("hidden");
    }
  }

  _initPipDrag() {
    const makeDraggable = (pipEl) => {
      if (!pipEl || !this.callBody) return;

      const startDrag = (x, y) => {
        const rect = pipEl.getBoundingClientRect();
        const parent = this.callBody.getBoundingClientRect();
        this._dragState = {
          offsetX: x - rect.left,
          offsetY: y - rect.top,
          parent,
          pipEl,
        };
        pipEl.classList.add("dragging");
        pipEl.classList.add("pip-anim");
      };

      const moveDrag = (x, y) => {
        if (!this._dragState) return;
        const { offsetX, offsetY, parent, pipEl } = this._dragState;

        let newX = x - offsetX - parent.left;
        let newY = y - offsetY - parent.top;

        // Clamp within call body
        newX = Math.max(0, Math.min(parent.width - pipEl.offsetWidth, newX));
        newY = Math.max(0, Math.min(parent.height - pipEl.offsetHeight, newY));

        pipEl.style.transform = `translate(${newX}px, ${newY}px)`;
        this._pipPos = { x: newX, y: newY };

        // Snap-warning if near controls
        if (this.callControls) {
          const controlsRect = this.callControls.getBoundingClientRect();
          const pipRect = pipEl.getBoundingClientRect();
          const overlapsHoriz =
            pipRect.right > controlsRect.left && pipRect.left < controlsRect.right;
          const overlapsVert =
            pipRect.bottom > controlsRect.top && pipRect.top < controlsRect.bottom;
          if (overlapsHoriz && overlapsVert) {
            pipEl.classList.add("snap-warning");
          } else {
            pipEl.classList.remove("snap-warning");
          }
        }
      };

      const endDrag = () => {
        if (!this._dragState) return;
        const { parent, pipEl } = this._dragState;

        // Edge snapping + snap-away from controls
        const pipRect = pipEl.getBoundingClientRect();
        const parentRect = parent;
        const controlsRect = this.callControls
          ? this.callControls.getBoundingClientRect()
          : null;

        let newX = this._pipPos?.x || 0;
        let newY = this._pipPos?.y || 0;

        const margin = 16;
        const snapThreshold = 32;

        // Snap to left/right fixed zones with margin
        const centerX = newX + pipRect.width / 2;
        const midX = parentRect.width / 2;
        if (centerX <= midX) {
          newX = margin;
        } else {
          newX = Math.max(
            margin,
            parentRect.width - pipRect.width - margin
          );
        }

        // Snap to top/bottom edges if near
        if (newY < snapThreshold) {
          newY = margin;
        } else if (parentRect.height - (newY + pipRect.height) < snapThreshold) {
          newY = Math.max(
            margin,
            parentRect.height - pipRect.height - margin
          );
        }

        // Snap-away from controls: if overlapping controls area, push up
        if (controlsRect) {
          const pipBottom = parentRect.top + newY + pipRect.height;
          const controlsTop = controlsRect.top;
          const controlsBottom = controlsRect.bottom;

          const pipLeft = parentRect.left + newX;
          const pipRight = pipLeft + pipRect.width;

          const controlsLeft = controlsRect.left;
          const controlsRight = controlsRect.right;

          const overlapsHoriz =
            pipRight > controlsLeft && pipLeft < controlsRight;
          const overlapsVert =
            pipBottom > controlsTop && parentRect.top + newY < controlsBottom;

          if (overlapsHoriz && overlapsVert) {
            // Move PiP just above controls
            const safeY =
              controlsTop - parentRect.top - pipRect.height - margin;
            newY = Math.max(margin, safeY);

            // Re-snap horizontally to left/right zones
            const centerX2 = newX + pipRect.width / 2;
            const midX2 = parentRect.width / 2;
            if (centerX2 <= midX2) {
              newX = margin;
            } else {
              newX = Math.max(
                margin,
                parentRect.width - pipRect.width - margin
              );
            }
          }
        }

        this._pipPos = { x: newX, y: newY };
        pipEl.style.transform = `translate(${newX}px, ${newY}px)`;
        pipEl.classList.remove("dragging");
        pipEl.classList.remove("snap-warning");
        this._dragState = null;
      };

      // Mouse events
      pipEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
        const move = (ev) => moveDrag(ev.clientX, ev.clientY);
        const up = () => {
          endDrag();
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });

      // Touch events
      pipEl.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        if (!t) return;
        startDrag(t.clientX, t.clientY);
      });

      pipEl.addEventListener("touchmove", (e) => {
        const t = e.touches[0];
        if (!t) return;
        moveDrag(t.clientX, t.clientY);
      });

      pipEl.addEventListener("touchend", () => {
        endDrag();
      });
    };

    makeDraggable(this.localPip);
    makeDraggable(this.remotePip);
  }

  // -------------------------------------------------------
  // TIMER + QUALITY MONITOR
  // -------------------------------------------------------
  _startTimerLoop() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
    }
    this._timerInterval = setInterval(() => {
      if (!this.timerEl) return;
      if (!this._callStartTime) {
        this.timerEl.textContent = "00:00";
        return;
      }
      const elapsed = Date.now() - this._callStartTime;
      this.timerEl.textContent = formatDuration(elapsed);
    }, 1000);
  }

  _startQualityMonitor() {
    // Already wired via this.rtc.onQualityUpdate → this.qualityEl
  }
}

























































