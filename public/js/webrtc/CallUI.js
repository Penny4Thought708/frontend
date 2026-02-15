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

export class CallUI {
  constructor(socket) {
    this.socket = socket;
    this.rtc = new WebRTCController(socket);

    // -------------------------------------------------------
    // DOM REFERENCES (MATCHING YOUR HTML / CSS)
    // -------------------------------------------------------
    this.videoContainer = document.getElementById("callWindow"); // <call-window id="callWindow" class="call-window">
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

    // Local PiP window
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

    // Audio cues (elsewhere in DOM)
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

    // Notify backend
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

    // Notify backend
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
  // CONTROLLER EVENT WIRING
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
  // BUTTON WIRING
  // -------------------------------------------------------
  _bindButtons() {
    // Answer / decline / end
    if (this.answerBtn) {
      this.answerBtn.addEventListener("click", () => this.answerCall());
    }

    if (this.declineBtn) {
      this.declineBtn.addEventListener("click", () => this.endCall());
    }

    if (this.endBtn) {
      this.endBtn.addEventListener("click", () => this.endCall());
    }

    // Mute
    if (this.muteBtn) {
      this.muteBtn.addEventListener("click", () => {
        const stream = rtcState.localStream;
        if (!stream) return;
        const enabled = stream.getAudioTracks().some((t) => t.enabled);
        stream.getAudioTracks().forEach((t) => (t.enabled = !enabled));
        this.muteBtn.classList.toggle("active", !enabled);
      });
    }

    // Camera toggle (ties into .camera-off / .voice-only-call CSS)
    if (this.camBtn) {
      this.camBtn.addEventListener("click", () => {
        const stream = rtcState.localStream;
        if (!stream) return;
        const enabled = stream.getVideoTracks().some((t) => t.enabled);
        stream.getVideoTracks().forEach((t) => (t.enabled = !enabled));
        this.camBtn.classList.toggle("active", !enabled);

        if (!this.videoContainer) return;
        if (!enabled) {
          // turning camera off
          this.videoContainer.classList.add("camera-off");
        } else {
          this.videoContainer.classList.remove("camera-off");
        }
      });
    }

    // More controls menu
    if (this.moreBtn && this.moreMenu) {
      this.moreBtn.addEventListener("click", (e) => {
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
    }

    // More menu actions
    if (this.shareBtn) {
      this.shareBtn.addEventListener("click", () => {
        this.rtc.startScreenShare();
        this.moreMenu?.classList.remove("show");
        this.moreMenu?.classList.add("hidden");
      });
    }

    if (this.noiseBtn) {
      this.noiseBtn.addEventListener("click", () => {
        this.noiseBtn.classList.toggle("active");
      });
    }

    if (this.recordBtn) {
      this.recordBtn.addEventListener("click", () => {
        this.recordBtn.classList.toggle("active");
      });
    }

    if (this.historyBtn) {
      this.historyBtn.addEventListener("click", () => {
        this.historyBtn.classList.toggle("active");
      });
    }

    // Double-tap swap (local vs first remote tile)
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
  // WINDOW + LAYOUT MODES (MATCHING .call-window CSS)
  // -------------------------------------------------------
  _openWindow() {
    if (!this.videoContainer) return;
    log("_openWindow");

    this.videoContainer.classList.remove("hidden");
    this.videoContainer.classList.add("is-open", "call-opening");

    // Remove call-opening after animation
    setTimeout(() => {
      this.videoContainer?.classList.remove("call-opening");
    }, 300);

    if (this.callControls) {
      this.callControls.classList.remove("hidden");
    }

    // Default layout: remote primary, local PiP (CSS handles local as PIP)
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
      "camera-off"
    );
    this.videoContainer.classList.add("hidden");

    if (this.callControls) {
      this.callControls.classList.add("hidden");
    }
  }

  _enterOutboundVoiceMode() {
    this._setStatus("Calling…");
    this._showControlsForVoice({ outbound: true });
    this._applyModeFlags({ inbound: false, active: false, video: false });
  }

  _enterOutboundVideoMode() {
    this._setStatus("Video calling…");
    this._showControlsForVideo({ outbound: true });
    this._applyModeFlags({ inbound: false, active: false, video: true });
  }

  _enterInboundVoiceMode() {
    this._setStatus("Incoming call");
    this._showControlsForVoice({ inbound: true });
    this._applyModeFlags({ inbound: true, active: false, video: false });
  }

  _enterInboundVideoMode() {
    this._setStatus("Incoming video");
    this._showControlsForVideo({ inbound: true });
    this._applyModeFlags({ inbound: true, active: false, video: true });
  }

  _enterActiveVoiceMode() {
    this._setStatus("In call");
    this._showControlsForVoice({ active: true });
    this._applyModeFlags({ inbound: false, active: true, video: false });
  }

  _enterActiveVideoMode() {
    this._setStatus("In video call");
    this._showControlsForVideo({ active: true });
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

    if (this.callControls) {
      this.callControls.classList.remove("hidden");
    }
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
  // CONTROLS VISIBILITY (WORKS WITH .inbound-mode / .active-mode)
  // -------------------------------------------------------
  _showControlsForVoice({ outbound, inbound, active } = {}) {
    // CSS already hides inbound-only / active-only based on .call-window.inbound-mode / .active-mode
    // Here we only handle any extra tweaks if needed.
    if (!this.callControls) return;

    // Voice mode: hide camera button visually if you want
    if (this.camBtn) {
      this.camBtn.classList.add("hidden-soft");
    }
  }

  _showControlsForVideo({ outbound, inbound, active } = {}) {
    if (!this.callControls) return;

    if (this.camBtn) {
      this.camBtn.classList.remove("hidden-soft");
    }
  }

  // -------------------------------------------------------
  // STATUS
  // -------------------------------------------------------
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
  _togglePrimary(remoteEl) {
    // For now, we just swap CSS roles between local and one remote tile
    if (!this.localWrapper || !remoteEl) return;

    this._primaryIsRemote = !this._primaryIsRemote;
    this._applyPrimaryLayout(remoteEl);
  }

  _applyPrimaryLayout(remoteEl) {
    // Desktop CSS already treats .participant.local as PIP; for now we just rely on that.
    // If you later want explicit .primary/.pip classes, you can add them here.
    // Keeping hook so behavior is extendable.
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



















































