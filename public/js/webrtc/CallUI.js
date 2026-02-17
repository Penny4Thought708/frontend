// ============================================================
// CallUI.js — Compact, Full, Enhanced
// ============================================================

import { WebRTCController } from "./WebRTCController.js";
import * as RemoteParticipants from "./RemoteParticipants.js";
import { attachLocalStream } from "./WebRTCMedia.js";
import { rtcState } from "./WebRTCState.js";

export class CallUI {
  // WINDOW + DOM + STATE
  constructor(socket) {
    this.socket = socket;

    // DOM
    this.callWindow = document.getElementById("callWindow");
    this.callBody = this.callWindow?.querySelector(".call-body");
    this.callGrid = document.getElementById("callGrid");

    this.localTile = document.getElementById("localParticipant");
    this.localVideo = document.getElementById("localVideo");
    this.localAvatar = this.localTile?.querySelector(".avatar-wrapper");

    this.localPip = document.getElementById("localPip");
    this.localPipVideo = document.getElementById("localPipVideo");

    this.remotePip = document.getElementById("remotePip");
    this.remotePipVideo = document.getElementById("remotePipVideo");

    this.callControls = document.getElementById("call-controls");
    this.callStatus = document.getElementById("call-status");
    this.callTimer = document.getElementById("call-timer");

    this.videoUpgradeOverlay = document.getElementById("video-upgrade-overlay");

    // STATE
    this.primaryIsRemote = false;
    this.pipPos = { x: 0, y: 0 };
    this.remoteAnswered = false;
    this.remoteHasVideo = false;
    this.isAnimatingSwap = false;
    this._timerStart = 0;
    this._timerInterval = null;
    this._controlsHideTimeout = null;
    this._lastPointerMove = 0;

    // CONTROLLER
    this.rtc = new WebRTCController(socket);

    this._bindControllerEvents();
    this._bindUIEvents();
    this._hideCallWindow();
    this._init();
  }

  // WINDOW
  _showCallWindow() {
    if (!this.callWindow) return;
    this.callWindow.classList.remove("hidden");
    requestAnimationFrame(() => {
      this.callWindow.classList.add("is-open", "call-opening");
      this._scheduleControlsAutoHide();
    });
  }

  _hideCallWindow() {
    if (!this.callWindow) return;
    this.callWindow.classList.remove("is-open");
    setTimeout(() => {
      this.callWindow.classList.add("hidden");
    }, 220);
  }

  // STATUS + TIMER
  _setStatus(text) {
    if (this.callStatus) this.callStatus.textContent = text;
  }

  _startTimer() {
    this._timerStart = Date.now();
    clearInterval(this._timerInterval);
    this._timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this._timerStart) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const s = String(elapsed % 60).padStart(2, "0");
      if (this.callTimer) this.callTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  _stopTimer() {
    clearInterval(this._timerInterval);
    this._timerInterval = null;
  }

  // CONTROLLER → UI
  _bindControllerEvents() {
    const rtc = this.rtc;

    rtc.onLocalStream = (stream) => {
      attachLocalStream(stream);
      this._onLocalVideoReady();
    };

    rtc.onRemoteStream = (peerId, stream) => {
      this._onRemoteVideoReady(peerId, stream);
    };

    rtc.onCallAnswered = () => {
      this._onRemoteAnswered();
    };

    rtc.onCallEnded = () => {
      this._endCall();
    };

    rtc.onScreenShareStarted = (peerId) => {
      this._enterScreenShareMode(peerId);
    };

    rtc.onScreenShareStopped = () => {
      this._exitScreenShareMode();
    };

    rtc.onRequestVideoUpgrade = () => {
      this._showVideoUpgradeOverlay();
    };
  }

  // LOCAL VIDEO READY (MEDIA)
  _onLocalVideoReady() {
    if (this.localTile) this.localTile.classList.remove("hidden");
    if (this.localAvatar) this.localAvatar.classList.add("hidden");
    if (this.localVideo) this.localVideo.classList.add("show");
    this.primaryIsRemote = false;
    this._showCallWindow();
    this._setStatus("Calling…");
    this._applyPrimaryLayout();
  }

  // REMOTE ANSWERED (CONTROLLER EVENT)
  _onRemoteAnswered() {
    this.remoteAnswered = true;
    this._setStatus("Connected");
    this._startTimer();
    if (this.remoteHasVideo && !this.primaryIsRemote && this.callGrid) {
      const remotes = this.callGrid.querySelectorAll(".participant.remote");
      if (remotes.length > 0) this._animateRemoteBecomingPrimary(remotes[0]);
    }
  }

  // REMOTE VIDEO READY
  _onRemoteVideoReady(peerId, stream) {
    this.remoteHasVideo = true;
    const entry = RemoteParticipants.attachParticipantStream(peerId, stream);
    if (this.remoteAnswered && !this.primaryIsRemote && entry?.el) {
      this._animateRemoteBecomingPrimary(entry.el);
    } else {
      this._applyPrimaryLayout();
    }
  }

  // ANIMATION: REMOTE BECOMES PRIMARY
  _animateRemoteBecomingPrimary(remoteEl) {
    if (!remoteEl || this.isAnimatingSwap) return;
    this.isAnimatingSwap = true;

    remoteEl.classList.add("pre-enter");
    if (this.localPip) this.localPip.classList.add("pre-enter");

    remoteEl.classList.remove("hidden");

    if (this.localPipVideo && this.localVideo)
      this.localPipVideo.srcObject = this.localVideo.srcObject;
    if (this.localPip) this.localPip.classList.remove("hidden");
    if (this.localTile) this.localTile.classList.add("hidden");

    requestAnimationFrame(() => {
      remoteEl.classList.add("enter-active");
      if (this.localPip) this.localPip.classList.add("enter-active");
    });

    setTimeout(() => {
      remoteEl.classList.remove("pre-enter", "enter-active");
      if (this.localPip) this.localPip.classList.remove("pre-enter", "enter-active");
      this.primaryIsRemote = true;
      this.isAnimatingSwap = false;
      this._applyPrimaryLayout();
    }, 350);
  }
}
// ============================================================
// LAYOUT ENGINE + PIP + DRAG + SWAP + AUTO‑HIDE CONTROLS
// ============================================================

  // PRIMARY LAYOUT ENGINE
  _applyPrimaryLayout() {
    if (this.isAnimatingSwap || !this.callGrid) return;

    let remoteEl = null;
    const allRemotes = this.callGrid.querySelectorAll(".participant.remote");
    for (const el of allRemotes) {
      const entry = RemoteParticipants.getParticipant(el.dataset.peerId);
      if (entry?.stream) {
        remoteEl = el;
        break;
      }
    }

    const hasRemote = !!remoteEl;
    const count = hasRemote ? 2 : 1;

    this.callGrid.classList.remove(
      "participants-1","participants-2","participants-3","participants-4",
      "participants-5","participants-6","participants-7","participants-8",
      "participants-9","participants-many"
    );
    this.callGrid.classList.add(`participants-${count}`);

    if (!hasRemote) {
      this.primaryIsRemote = false;
      if (this.localTile) this.localTile.classList.remove("hidden");
      if (remoteEl) remoteEl.classList.add("hidden");
      if (this.localPip) this.localPip.classList.add("hidden");
      if (this.remotePip) this.remotePip.classList.add("hidden");
      return;
    }

    if (this.primaryIsRemote) {
      remoteEl.classList.remove("hidden");
      if (this.localTile) this.localTile.classList.add("hidden");
      if (this.localPip) this.localPip.classList.remove("hidden");
      if (this.remotePip) this.remotePip.classList.add("hidden");
      if (this.localPipVideo && this.localVideo)
        this.localPipVideo.srcObject = this.localVideo.srcObject;
      this._applyPipTransform(this.localPip);
    } else {
      if (this.localTile) this.localTile.classList.remove("hidden");
      remoteEl.classList.add("hidden");
      if (this.remotePip) this.remotePip.classList.remove("hidden");
      if (this.localPip) this.localPip.classList.add("hidden");

      const entry = RemoteParticipants.getParticipant(remoteEl.dataset.peerId);
      if (entry?.videoEl?.srcObject)
        this.remotePipVideo.srcObject = entry.videoEl.srcObject;

      this._applyPipTransform(this.remotePip);
    }
  }

  // APPLY PIP TRANSFORM
  _applyPipTransform(pipEl) {
    if (!pipEl) return;
    if (!this.pipPos || typeof this.pipPos.x !== "number")
      this.pipPos = { x: 0, y: 0 };
    pipEl.style.transform = `translate3d(${this.pipPos.x}px,${this.pipPos.y}px,0)`;
  }

  // SWAP PRIMARY
  _swapPrimary() {
    if (this.isAnimatingSwap) return;
    this.primaryIsRemote = !this.primaryIsRemote;
    this._applyPrimaryLayout();
  }

  // DRAG HANDLER FOR PIP
  _enablePipDrag(pipEl) {
    if (!pipEl) return;
    let dragging = false, startX = 0, startY = 0;

    pipEl.addEventListener("pointerdown", (e) => {
      dragging = true;
      pipEl.classList.add("dragging");
      startX = e.clientX - this.pipPos.x;
      startY = e.clientY - this.pipPos.y;
      pipEl.setPointerCapture(e.pointerId);
      this._showControls();
    });

    pipEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.pipPos.x = e.clientX - startX;
      this.pipPos.y = e.clientY - startY;
      pipEl.style.transform = `translate3d(${this.pipPos.x}px,${this.pipPos.y}px,0)`;
    });

    pipEl.addEventListener("pointerup", (e) => {
      dragging = false;
      pipEl.classList.remove("dragging");
      pipEl.releasePointerCapture(e.pointerId);
      this._snapPipToEdges(pipEl);
      this._scheduleControlsAutoHide();
    });
  }

  // PIP SNAP (MAGNETIC EDGES)
  _snapPipToEdges(pipEl) {
    if (!pipEl) return;
    const margin = 12;
    const rect = pipEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const snapLeft = rect.left < vw / 2;
    const snapTop = rect.top < vh / 2;

    this.pipPos.x = snapLeft ? margin : vw - rect.width - margin;
    this.pipPos.y = snapTop ? margin : vh - rect.height - margin;

    pipEl.style.transition = "transform 0.18s cubic-bezier(.25,.8,.25,1)";
    pipEl.style.transform = `translate3d(${this.pipPos.x}px,${this.pipPos.y}px,0)`;
    setTimeout(() => (pipEl.style.transition = ""), 200);
  }

  // AUTO‑HIDE CONTROLS
  _scheduleControlsAutoHide() {
    clearTimeout(this._controlsHideTimeout);
    this._controlsHideTimeout = setTimeout(() => {
      if (this.callControls) this.callControls.classList.add("auto-hide");
    }, 2500);
  }

  _showControls() {
    if (this.callControls)
      this.callControls.classList.remove("auto-hide");
    this._scheduleControlsAutoHide();
  }

  // UI → CONTROLLER EVENTS
  _bindUIEvents() {
    const answerBtn = document.getElementById("answer-call");
    if (answerBtn)
      answerBtn.addEventListener("click", () => {
        this.rtc.answerCall();
        this._setStatus("Connecting…");
        this.callWindow.classList.remove("inbound-mode");
        this.callWindow.classList.add("active-mode");
      });

    const declineBtn = document.getElementById("decline-call");
    if (declineBtn)
      declineBtn.addEventListener("click", () => {
        this.rtc.endCall();
        this._endCall();
      });

    const endBtn = document.getElementById("end-call");
    if (endBtn)
      endBtn.addEventListener("click", () => {
        this.rtc.endCall();
        this._endCall();
      });

    const muteBtn = document.getElementById("mute-call");
    if (muteBtn)
      muteBtn.addEventListener("click", () => {
        const muted = this.rtc.toggleMute();
        muteBtn.classList.toggle("active", muted);
        this._showControls();
      });

    const camBtn = document.getElementById("camera-toggle");
    if (camBtn)
      camBtn.addEventListener("click", () => {
        const off = this.rtc.toggleCamera();
        camBtn.classList.toggle("active", off);
        if (off) {
          this.localAvatar?.classList.remove("hidden");
          this.localVideo?.classList.remove("show");
        } else {
          this.localAvatar?.classList.add("hidden");
          this.localVideo?.classList.add("show");
        }
        this._applyPrimaryLayout();
        this._showControls();
      });

    const moreBtn = document.getElementById("more-controls-btn");
    const moreMenu = document.getElementById("more-controls-menu");
    if (moreBtn && moreMenu) {
      moreBtn.addEventListener("click", () => {
        const open = moreMenu.classList.contains("show");
        moreMenu.classList.toggle("show", !open);
        moreMenu.classList.toggle("hidden", open);
        this._showControls();
      });

      document.addEventListener("click", (e) => {
        if (!moreBtn.contains(e.target) && !moreMenu.contains(e.target)) {
          moreMenu.classList.add("hidden");
          moreMenu.classList.remove("show");
        }
      });
    }

    this._enablePipDrag(this.localPip);
    this._enablePipDrag(this.remotePip);

    let lastTap = 0;
    const dbl = () => {
      const now = Date.now();
      if (now - lastTap < 300) this._swapPrimary();
      lastTap = now;
    };
    this.localPip?.addEventListener("pointerdown", dbl);
    this.remotePip?.addEventListener("pointerdown", dbl);

    document.addEventListener("pointermove", () => this._showControls());
    document.addEventListener("pointerdown", () => this._showControls());
  }

// ============================================================
// CALL LIFECYCLE + VOICE MODE + VIDEO UPGRADE + SCREEN SHARE
// ============================================================

  // START OUTBOUND CALL
  startOutboundCall() {
    this._resetCallUI();
    this._showCallWindow();
    this.callWindow.classList.remove("inbound-mode");
    this.callWindow.classList.add("active-mode");
    this.primaryIsRemote = false;
    this._setStatus("Calling…");
    this._applyPrimaryLayout();
  }

  // INBOUND CALL
  showInboundCall(callerName = "Incoming Call") {
    this._resetCallUI();
    this._showCallWindow();
    this.callWindow.classList.add("inbound-mode");
    this.callWindow.classList.remove("active-mode");
    this._setStatus(callerName);
  }

  // ANSWERED (UI SIDE)
  onAnswered() {
    this.callWindow.classList.remove("inbound-mode");
    this.callWindow.classList.add("active-mode");
    this._setStatus("Connecting…");
  }

  // END CALL
  _endCall() {
    this._stopTimer();
    this._setStatus("Call Ended");
    this.callWindow.classList.remove("is-open");
    setTimeout(() => this.callWindow.classList.add("hidden"), 220);

    RemoteParticipants.clearAllParticipants();

    this.remoteAnswered = false;
    this.remoteHasVideo = false;
    this.primaryIsRemote = false;

    this._resetCallUI();
  }

  // RESET UI
  _resetCallUI() {
    this.callWindow.classList.remove(
      "inbound-mode","active-mode","voice-only-call","camera-off",
      "meet-mode","discord-mode","ios-voice-mode","video-upgrade-mode",
      "screen-share-mode"
    );

    this.localPip?.classList.add("hidden");
    this.remotePip?.classList.add("hidden");

    this.pipPos = { x: 0, y: 0 };
    if (this.localPip) this.localPip.style.transform = "";
    if (this.remotePip) this.remotePip.style.transform = "";

    this.localTile?.classList.add("hidden");
    this.localAvatar?.classList.remove("hidden");
    this.localVideo?.classList.remove("show");

    const remotes = this.callGrid?.querySelectorAll(".participant.remote") || [];
    remotes.forEach((el) => el.classList.add("hidden"));

    this._setStatus("Connecting…");
    if (this.callTimer) this.callTimer.textContent = "00:00";
    this._stopTimer();
  }

  // ============================================================
  // iOS VOICE MODE
  // ============================================================

  _enterIOSVoiceMode() {
    this.callWindow.classList.add("ios-voice-mode","voice-only-call");

    this.localVideo?.classList.remove("show");
    this.localAvatar?.classList.remove("hidden");

    const remotes = this.callGrid?.querySelectorAll(".participant.remote") || [];
    remotes.forEach((el) => {
      const entry = RemoteParticipants.getParticipant(el.dataset.peerId);
      entry?.videoEl?.classList.remove("show");
      entry?.avatarEl?.classList.remove("hidden");
    });

    this.localPip?.classList.add("hidden");
    this.remotePip?.classList.add("hidden");

    this._setStatus("Audio Call");
  }

  _exitIOSVoiceMode() {
    this.callWindow.classList.remove("ios-voice-mode","voice-only-call");

    if (!this.rtc.isCameraOff) {
      this.localVideo?.classList.add("show");
      this.localAvatar?.classList.add("hidden");
    }

    const remotes = this.callGrid?.querySelectorAll(".participant.remote") || [];
    remotes.forEach((el) => {
      const entry = RemoteParticipants.getParticipant(el.dataset.peerId);
      if (!entry?.cameraOff) {
        entry?.videoEl?.classList.add("show");
        entry?.avatarEl?.classList.add("hidden");
      }
    });

    this._applyPrimaryLayout();
  }

  // ============================================================
  // VIDEO UPGRADE
  // ============================================================

  _showVideoUpgradeOverlay() {
    this.callWindow.classList.add("video-upgrade-mode");
    this.callGrid?.classList.add("desktop-video-preview");
    this.videoUpgradeOverlay?.classList.remove("hidden");
    requestAnimationFrame(() => {
      this.videoUpgradeOverlay?.classList.add("show");
    });
  }

  _hideVideoUpgradeOverlay() {
    this.callWindow.classList.remove("video-upgrade-mode");
    this.callGrid?.classList.remove("desktop-video-preview");
    this.videoUpgradeOverlay?.classList.remove("show");
    setTimeout(() => {
      this.videoUpgradeOverlay?.classList.add("hidden");
    }, 220);
  }

  _acceptVideoUpgrade() {
    this._hideVideoUpgradeOverlay();
    this._exitIOSVoiceMode();
    this.rtc.enableCamera();
    this._setStatus("Switching to video…");
  }

  _declineVideoUpgrade() {
    this._hideVideoUpgradeOverlay();
    this._enterIOSVoiceMode();
    this.rtc.declineVideoUpgrade();
    this._setStatus("Audio Only");
  }

  _bindVideoUpgradeButtons() {
    const acceptMobile = document.getElementById("video-upgrade-accept");
    const declineMobile = document.getElementById("video-upgrade-decline");
    const acceptDesktop = document.getElementById("video-upgrade-accept-desktop");
    const declineDesktop = document.getElementById("video-upgrade-decline-desktop");

    acceptMobile?.addEventListener("click", () => this._acceptVideoUpgrade());
    declineMobile?.addEventListener("click", () => this._declineVideoUpgrade());
    acceptDesktop?.addEventListener("click", () => this._acceptVideoUpgrade());
    declineDesktop?.addEventListener("click", () => this._declineVideoUpgrade());
  }

  // ============================================================
  // SCREEN SHARE MODE
  // ============================================================

  _enterScreenShareMode(peerId) {
    this.callGrid?.classList.add("screen-share-mode");

    const entry = RemoteParticipants.getParticipant(peerId);
    entry?.el?.classList.add("stage");

    const remotes = this.callGrid?.querySelectorAll(".participant.remote") || [];
    remotes.forEach((el) => {
      if (el.dataset.peerId !== peerId) el.classList.add("filmstrip");
    });

    if (peerId !== "local") this.localTile?.classList.add("filmstrip");

    this.localPip?.classList.add("hidden");
    this.remotePip?.classList.add("hidden");
  }

  _exitScreenShareMode() {
    this.callGrid?.classList.remove("screen-share-mode");

    const all = this.callGrid?.querySelectorAll(".participant") || [];
    all.forEach((el) => el.classList.remove("stage","filmstrip"));

    this._applyPrimaryLayout();
  }

// ============================================================
// MODES + ADAPTIVE LAYOUT + DEBUG + INIT + EXPORT
// ============================================================

  // MODE HELPERS
  _setMeetMode() {
    this.callWindow.classList.add("meet-mode");
    this.callWindow.classList.remove("discord-mode");
  }

  _setDiscordMode() {
    this.callWindow.classList.add("discord-mode");
    this.callWindow.classList.remove("meet-mode");
  }

  _setIOSVoiceMode() {
    this._enterIOSVoiceMode();
  }

  _exitIOSMode() {
    this._exitIOSVoiceMode();
  }

  // ============================================================
  // ADAPTIVE LAYOUT (PORTRAIT / LANDSCAPE)
  // ============================================================

  _handleResizeOrientation() {
    if (!this.callWindow) return;
    const portrait = window.innerHeight >= window.innerWidth;
    this.callWindow.classList.toggle("portrait-layout", portrait);
    this.callWindow.classList.toggle("landscape-layout", !portrait);
  }

  _bindAdaptiveLayout() {
    this._handleResizeOrientation();
    let resizeTimeout = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => this._handleResizeOrientation(), 120);
    });
    window.addEventListener("orientationchange", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => this._handleResizeOrientation(), 120);
    });
  }

  // ============================================================
  // ACCESSIBILITY
  // ============================================================

  _applyAccessibility() {
    if (this.callWindow) {
      this.callWindow.setAttribute("role", "dialog");
      this.callWindow.setAttribute("aria-modal", "true");
    }
    if (this.callControls)
      this.callControls.setAttribute("role", "toolbar");
    if (this.callStatus)
      this.callStatus.setAttribute("role", "status");
  }

  // ============================================================
  // DEBUG PANEL TOGGLE
  // ============================================================

  _toggleDebug() {
    const debugBtn = document.getElementById("call-debug-toggle");
    if (!debugBtn) return;
    debugBtn.addEventListener("click", () => {
      document.body.classList.toggle("debug-call-ui");
    });
  }

  // ============================================================
  // FINAL INITIALIZATION
  // ============================================================

  _init() {
    this._bindVideoUpgradeButtons();
    this._bindAdaptiveLayout();
    this._applyAccessibility();
    this._toggleDebug();
    this._setMeetMode();
  }
}

export default CallUI;

// ============================================================
// PERFORMANCE + HAPTICS + ADVANCED GRID LOGIC
// ============================================================

// PERFORMANCE: RAF BATCHING FOR LAYOUT
_updateLayoutRAF() {
  if (this._layoutScheduled) return;
  this._layoutScheduled = true;
  requestAnimationFrame(() => {
    this._layoutScheduled = false;
    this._applyPrimaryLayout();
  });
}

// PERFORMANCE: DEBOUNCED GRID UPDATE
_updateGridDebounced() {
  clearTimeout(this._gridTimeout);
  this._gridTimeout = setTimeout(() => this._applyDynamicGrid(), 80);
}

// ADVANCED GRID LOGIC (3–9 PARTICIPANTS)
_applyDynamicGrid() {
  if (!this.callGrid) return;
  const remotes = this.callGrid.querySelectorAll(".participant.remote");
  const count = remotes.length + 1; // + local

  this.callGrid.classList.remove(
    "grid-1","grid-2","grid-3","grid-4","grid-5",
    "grid-6","grid-7","grid-8","grid-9"
  );

  if (count <= 1) this.callGrid.classList.add("grid-1");
  else if (count === 2) this.callGrid.classList.add("grid-2");
  else if (count === 3) this.callGrid.classList.add("grid-3");
  else if (count === 4) this.callGrid.classList.add("grid-4");
  else if (count === 5) this.callGrid.classList.add("grid-5");
  else if (count === 6) this.callGrid.classList.add("grid-6");
  else if (count === 7) this.callGrid.classList.add("grid-7");
  else if (count === 8) this.callGrid.classList.add("grid-8");
  else this.callGrid.classList.add("grid-9");
}

// HOOK FOR VOICE‑ACTIVITY PULSE (CSS handles visuals)
_updateSpeakingIndicator(peerId, isSpeaking) {
  const entry = RemoteParticipants.getParticipant(peerId);
  if (!entry?.el) return;
  entry.el.classList.toggle("speaking", isSpeaking);
}

// HAPTIC‑STYLE BUTTON FEEDBACK
_enableHaptics() {
  const buttons = document.querySelectorAll(
    "#call-controls button, #more-controls-menu button"
  );
  buttons.forEach((btn) => {
    btn.addEventListener("pointerdown", () => {
      btn.style.transform = "scale(0.92)";
    });
    btn.addEventListener("pointerup", () => {
      btn.style.transform = "scale(1)";
    });
    btn.addEventListener("pointerleave", () => {
      btn.style.transform = "scale(1)";
    });
  });
}

// PERFORMANCE: ZERO‑THRASH PIP MOVEMENT (pointermove batching)
_bindOptimizedPointerMove() {
  let lastX = 0, lastY = 0, activePip = null, dragging = false;

  const move = () => {
    if (!dragging || !activePip) return;
    activePip.style.transform = `translate3d(${lastX}px,${lastY}px,0)`;
    requestAnimationFrame(move);
  };

  const start = (pipEl, e) => {
    dragging = true;
    activePip = pipEl;
    pipEl.classList.add("dragging");
    pipEl.setPointerCapture(e.pointerId);
    requestAnimationFrame(move);
  };

  const end = (pipEl, e) => {
    dragging = false;
    pipEl.classList.remove("dragging");
    pipEl.releasePointerCapture(e.pointerId);
    this.pipPos.x = lastX;
    this.pipPos.y = lastY;
    this._snapPipToEdges(pipEl);
  };

  const bind = (pipEl) => {
    if (!pipEl) return;
    let offsetX = 0, offsetY = 0;

    pipEl.addEventListener("pointerdown", (e) => {
      offsetX = e.clientX - this.pipPos.x;
      offsetY = e.clientY - this.pipPos.y;
      start(pipEl, e);
    });

    pipEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      lastX = e.clientX - offsetX;
      lastY = e.clientY - offsetY;
    });

    pipEl.addEventListener("pointerup", (e) => end(pipEl, e));
  };

  bind(this.localPip);
  bind(this.remotePip);
}

// ============================================================
// FINAL ENHANCEMENT INITIALIZATION HOOK
// ============================================================

_initEnhancements() {
  this._enableHaptics();
  this._bindOptimizedPointerMove();
  this._updateGridDebounced();
}

// Patch into existing init
_init() {
  this._bindVideoUpgradeButtons();
  this._bindAdaptiveLayout();
  this._applyAccessibility();
  this._toggleDebug();
  this._setMeetMode();
  this._initEnhancements();
}







