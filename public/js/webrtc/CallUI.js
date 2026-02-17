// ============================================================
// CallUI.js — Full, Modern, Wired to WebRTCController
// ============================================================

import { WebRTCController } from "./WebRTCController.js";
import * as RemoteParticipants from "./RemoteParticipants.js";

export class CallUI {
  constructor(socket) {
    this.socket = socket;

    // DOM
    this.callWindow = document.getElementById("callWindow");
    this.callGrid = document.getElementById("callGrid");
    this.callControls = document.getElementById("call-controls");
    this.callStatus = document.getElementById("call-status");
    this.callTimer = document.getElementById("call-timer");

    this.localTile = document.getElementById("localParticipant");
    this.localVideo = document.getElementById("localVideo");
    this.localAvatar = this.localTile?.querySelector(".avatar-wrapper");

    this.localPip = document.getElementById("localPip");
    this.localPipVideo = document.getElementById("localPipVideo");

    this.remotePip = document.getElementById("remotePip");
    this.remotePipVideo = document.getElementById("remotePipVideo");

    this.videoUpgradeOverlay = document.getElementById("video-upgrade-overlay");

    this.ringtone = document.getElementById("ringtone");
    this.ringback = document.getElementById("ringback");

    // STATE
    this.primaryIsRemote = false;
    this.remoteAnswered = false;
    this.remoteHasVideo = false;
    this.isAnimatingSwap = false;
    this.pipPos = { x: 0, y: 0 };
    this._timerStart = 0;
    this._timerInterval = null;
    this._controlsHideTimeout = null;

    // CONTROLLER
    this.rtc = new WebRTCController(socket);

    this._bindControllerEvents();
    this._bindUIEvents();
    this._bindGlobalCallButtons();
    this._hideCallWindow();
    this._init();
  }

  // ============================================================
  // WINDOW
  // ============================================================
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
    setTimeout(() => this.callWindow.classList.add("hidden"), 220);
  }

  // ============================================================
  // STATUS + TIMER
  // ============================================================
  _setStatus(t) {
    if (this.callStatus) this.callStatus.textContent = t;
  }

  _startTimer() {
    if (!this.callTimer) return;
    this._timerStart = Date.now();
    clearInterval(this._timerInterval);
    this._timerInterval = setInterval(() => {
      const e = Math.floor((Date.now() - this._timerStart) / 1000);
      const m = String(Math.floor(e / 60)).padStart(2, "0");
      const s = String(e % 60).padStart(2, "0");
      this.callTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  _stopTimer() {
    clearInterval(this._timerInterval);
    this._timerInterval = null;
  }

  // ============================================================
  // CONTROLLER → UI
  // ============================================================
  _bindControllerEvents() {
    const rtc = this.rtc;

    rtc.onCallStatusChange = (status) => {
      if (status === "in-call") {
        this._onConnected();
      } else if (status === "ringing") {
        this._setStatus("Incoming call…");
      } else if (status === "idle") {
        this._setStatus("Idle");
      }
    };

    rtc.onCallStarted = () => {
      this._onCallStarted();
    };

    rtc.onCallEnded = () => {
      this._endCall();
    };

    rtc.onIncomingOffer = () => {
      this._onIncomingOffer();
    };

    rtc.onRemoteJoin = () => {
      this.remoteHasVideo = true;
      this._applyPrimaryLayout();
    };

    rtc.onRemoteLeave = () => {
      this.remoteHasVideo = false;
      this._applyPrimaryLayout();
    };

    rtc.onScreenShareStarted = () => {
      this._enterScreenShareMode("local");
    };

    rtc.onScreenShareStopped = () => {
      this._exitScreenShareMode();
    };

    rtc.onPeerUnavailable = (reason) => {
      this._setStatus(reason || "User unavailable");
      this._endCall();
    };
  }

  _onCallStarted() {
    this._showCallWindow();
    this.callWindow?.classList.remove("inbound-mode");
    this.callWindow?.classList.add("active-mode");
    this._setStatus("Connecting…");
    this._startTimer();
    this._stopRingtone();
    this._playRingback(false);
    this._applyPrimaryLayout();
  }

  _onConnected() {
    this._setStatus("Connected");
    this._startTimer();
    this._stopRingback();
  }

  _onIncomingOffer() {
    this.showInboundCall("Incoming Call");
    this._playRingtone();
  }

  // ============================================================
  // LAYOUT ENGINE + PIP + DRAG + SWAP
  // ============================================================
  _applyPrimaryLayout() {
    if (this.isAnimatingSwap) return;
    if (!this.callGrid) return;

    let remoteEl = null;
    const remotes = this.callGrid.querySelectorAll(".participant.remote");
    for (const el of remotes) {
      const entry = RemoteParticipants.getParticipant(el.dataset.peerId);
      if (entry?.stream) {
        remoteEl = el;
        break;
      }
    }

    const hasRemote = !!remoteEl;
    const count = hasRemote ? 2 : 1;

    this.callGrid.className = `call-grid participants-${count}`;

    if (!hasRemote) {
      this.primaryIsRemote = false;
      this.localTile?.classList.remove("hidden");
      this.localPip?.classList.add("hidden");
      this.remotePip?.classList.add("hidden");
      this._applyDynamicGrid();
      return;
    }

    if (this.primaryIsRemote) {
      remoteEl.classList.remove("hidden");
      this.localTile?.classList.add("hidden");
      this.localPip?.classList.remove("hidden");
      this.remotePip?.classList.add("hidden");
      if (this.localPipVideo && this.localVideo) {
        this.localPipVideo.srcObject = this.localVideo.srcObject;
      }
      this._applyPipTransform(this.localPip);
    } else {
      this.localTile?.classList.remove("hidden");
      remoteEl.classList.add("hidden");
      this.remotePip?.classList.remove("hidden");
      this.localPip?.classList.add("hidden");

      const entry = RemoteParticipants.getParticipant(remoteEl.dataset.peerId);
      if (entry?.videoEl?.srcObject && this.remotePipVideo) {
        this.remotePipVideo.srcObject = entry.videoEl.srcObject;
      }

      this._applyPipTransform(this.remotePip);
    }

    this._applyDynamicGrid();
  }

  _applyPipTransform(pipEl) {
    if (!pipEl) return;
    pipEl.style.transform = `translate3d(${this.pipPos.x}px,${this.pipPos.y}px,0)`;
  }

  _swapPrimary() {
    if (this.isAnimatingSwap) return;
    this.primaryIsRemote = !this.primaryIsRemote;
    this._applyPrimaryLayout();
  }

  _enablePipDrag(pipEl) {
    if (!pipEl) return;
    let dragging = false,
      startX = 0,
      startY = 0;

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

  _snapPipToEdges(pipEl) {
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

  _scheduleControlsAutoHide() {
    if (!this.callControls) return;
    clearTimeout(this._controlsHideTimeout);
    this._controlsHideTimeout = setTimeout(() => {
      this.callControls.classList.add("auto-hide");
    }, 2500);
  }

  _showControls() {
    if (!this.callControls) return;
    this.callControls.classList.remove("auto-hide");
    this._scheduleControlsAutoHide();
  }

  // ============================================================
  // UI → CONTROLLER EVENTS
  // ============================================================
  _bindUIEvents() {
    const answerBtn = document.getElementById("answer-call");
    const declineBtn = document.getElementById("decline-call");
    const endBtn = document.getElementById("end-call");
    const muteBtn = document.getElementById("mute-call");
    const camBtn = document.getElementById("camera-toggle");
    const shareBtn = document.getElementById("share-screen");

    answerBtn?.addEventListener("click", () => {
      this.rtc.answerCall();
      this._setStatus("Connecting…");
      this.callWindow?.classList.remove("inbound-mode");
      this.callWindow?.classList.add("active-mode");
      this._stopRingtone();
    });

    declineBtn?.addEventListener("click", () => {
      this.rtc.declineCall();
      this._endCall();
    });

    endBtn?.addEventListener("click", () => {
      this.rtc.endCall();
      this._endCall();
    });

    muteBtn?.addEventListener("click", () => {
      const muted = this.rtc.toggleMute?.();
      muteBtn.classList.toggle("active", !!muted);
      this._showControls();
    });

    camBtn?.addEventListener("click", () => {
      const off = this.rtc.toggleCamera?.();
      camBtn.classList.toggle("active", !!off);

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

    shareBtn?.addEventListener("click", async () => {
      if (!this._screenSharing) {
        const ok = await this.rtc.startScreenShare();
        if (ok) this._screenSharing = true;
      } else {
        await this.rtc.stopScreenShare();
        this._screenSharing = false;
      }
    });

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

  _bindGlobalCallButtons() {
    const voiceBtn = document.getElementById("voiceBtn");
    const videoBtn = document.getElementById("videoBtn");

    voiceBtn?.addEventListener("click", () => {
      const peerId = voiceBtn.dataset.peerId;
      if (!peerId) {
        console.warn("[CallUI] voiceBtn missing data-peer-id");
        return;
      }
      this.startVoiceCall(peerId);
    });

    videoBtn?.addEventListener("click", () => {
      const peerId = videoBtn.dataset.peerId;
      if (!peerId) {
        console.warn("[CallUI] videoBtn missing data-peer-id");
        return;
      }
      this.startVideoCall(peerId);
    });
  }

  startVoiceCall(peerId) {
    this._resetCallUI();
    this._showCallWindow();
    this.callWindow?.classList.remove("inbound-mode");
    this.callWindow?.classList.add("active-mode");
    this.primaryIsRemote = false;
    this._setStatus("Calling…");
    this._applyPrimaryLayout();
    this._playRingback(true);

    this.rtc.startCall(String(peerId), { audio: true, video: false });
  }

  startVideoCall(peerId) {
    this._resetCallUI();
    this._showCallWindow();
    this.callWindow?.classList.remove("inbound-mode");
    this.callWindow?.classList.add("active-mode");
    this.primaryIsRemote = false;
    this._setStatus("Calling…");
    this._applyPrimaryLayout();
    this._playRingback(true);

    this.rtc.startCall(String(peerId), { audio: true, video: true });
  }

  // ============================================================
  // CALL LIFECYCLE
  // ============================================================
  startOutboundCall() {
    this._resetCallUI();
    this._showCallWindow();
    this.callWindow?.classList.remove("inbound-mode");
    this.callWindow?.classList.add("active-mode");
    this.primaryIsRemote = false;
    this._setStatus("Calling…");
    this._applyPrimaryLayout();
  }

  showInboundCall(name = "Incoming Call") {
    this._resetCallUI();
    this._showCallWindow();
    this.callWindow?.classList.add("inbound-mode");
    this.callWindow?.classList.remove("active-mode");
    this._setStatus(name);
  }

  onAnswered() {
    this.callWindow?.classList.remove("inbound-mode");
    this.callWindow?.classList.add("active-mode");
    this._setStatus("Connecting…");
  }

  _endCall() {
    this._stopTimer();
    this._setStatus("Call Ended");
    this._stopRingtone();
    this._stopRingback();
    this.callWindow?.classList.remove("is-open");
    setTimeout(() => this.callWindow?.classList.add("hidden"), 220);

    RemoteParticipants.getAllParticipants?.().forEach((p) => {
      if (p?.peerId && p.peerId !== "local") {
        RemoteParticipants.removeParticipant(p.peerId);
      }
    });

    this.remoteAnswered = false;
    this.remoteHasVideo = false;
    this.primaryIsRemote = false;

    this._resetCallUI();
  }

  _resetCallUI() {
    if (!this.callWindow) return;

    this.callWindow.classList.remove(
      "inbound-mode",
      "active-mode",
      "voice-only-call",
      "camera-off",
      "meet-mode",
      "discord-mode",
      "ios-voice-mode",
      "video-upgrade-mode",
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

    if (this.callGrid) {
      const remotes = this.callGrid.querySelectorAll(".participant.remote");
      remotes.forEach((el) => el.classList.add("hidden"));
    }

    this._setStatus("Connecting…");
    if (this.callTimer) this.callTimer.textContent = "00:00";
    this._stopTimer();
  }

  // ============================================================
  // iOS VOICE MODE
  // ============================================================
  _enterIOSVoiceMode() {
    this.callWindow?.classList.add("ios-voice-mode", "voice-only-call");

    this.localVideo?.classList.remove("show");
    this.localAvatar?.classList.remove("hidden");

    if (this.callGrid) {
      const remotes = this.callGrid.querySelectorAll(".participant.remote");
      remotes.forEach((el) => {
        const entry = RemoteParticipants.getParticipant(el.dataset.peerId);
        entry?.videoEl?.classList.remove("show");
        entry?.avatarEl?.classList.remove("hidden");
      });
    }

    this.localPip?.classList.add("hidden");
    this.remotePip?.classList.add("hidden");

    this._setStatus("Audio Call");
  }

  _exitIOSVoiceMode() {
    this.callWindow?.classList.remove("ios-voice-mode", "voice-only-call");

    if (this.localVideo && this.localAvatar) {
      this.localVideo.classList.add("show");
      this.localAvatar.classList.add("hidden");
    }

    if (this.callGrid) {
      const remotes = this.callGrid.querySelectorAll(".participant.remote");
      remotes.forEach((el) => {
        const entry = RemoteParticipants.getParticipant(el.dataset.peerId);
        if (!entry?.cameraOff) {
          entry?.videoEl?.classList.add("show");
          entry?.avatarEl?.classList.add("hidden");
        }
      });
    }

    this._applyPrimaryLayout();
  }

  // ============================================================
  // VIDEO UPGRADE
  // ============================================================
  _showVideoUpgradeOverlay() {
    this.callWindow?.classList.add("video-upgrade-mode");
    this.callGrid?.classList.add("desktop-video-preview");
    this.videoUpgradeOverlay?.classList.remove("hidden");
    requestAnimationFrame(() => {
      this.videoUpgradeOverlay?.classList.add("show");
    });
  }

  _hideVideoUpgradeOverlay() {
    this.callWindow?.classList.remove("video-upgrade-mode");
    this.callGrid?.classList.remove("desktop-video-preview");
    this.videoUpgradeOverlay?.classList.remove("show");
    setTimeout(() => this.videoUpgradeOverlay?.classList.add("hidden"), 220);
  }

  _acceptVideoUpgrade() {
    this._hideVideoUpgradeOverlay();
    this._exitIOSVoiceMode();
    this.rtc.upgradeToVideo?.();
    this._setStatus("Switching to video…");
  }

  _declineVideoUpgrade() {
    this._hideVideoUpgradeOverlay();
    this._enterIOSVoiceMode();
    this._setStatus("Audio Only");
  }

  _bindVideoUpgradeButtons() {
    const aM = document.getElementById("video-upgrade-accept");
    const dM = document.getElementById("video-upgrade-decline");
    const aD = document.getElementById("video-upgrade-accept-desktop");
    const dD = document.getElementById("video-upgrade-decline-desktop");

    aM?.addEventListener("click", () => this._acceptVideoUpgrade());
    dM?.addEventListener("click", () => this._declineVideoUpgrade());
    aD?.addEventListener("click", () => this._acceptVideoUpgrade());
    dD?.addEventListener("click", () => this._declineVideoUpgrade());
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
    all.forEach((el) => el.classList.remove("stage", "filmstrip"));

    this._applyPrimaryLayout();
  }

  // ============================================================
  // ADVANCED GRID LOGIC
  // ============================================================
  _applyDynamicGrid() {
    if (!this.callGrid) return;
    const remotes = this.callGrid.querySelectorAll(".participant.remote");
    const count = remotes.length + 1;

    this.callGrid.classList.remove(
      "grid-1",
      "grid-2",
      "grid-3",
      "grid-4",
      "grid-5",
      "grid-6",
      "grid-7",
      "grid-8",
      "grid-9"
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

  // ============================================================
  // HAPTIC MICRO‑INTERACTIONS
  // ============================================================
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

  // ============================================================
  // AUDIO CUES
  // ============================================================
  _playRingtone() {
    if (!this.ringtone) return;
    try {
      this.ringtone.currentTime = 0;
      this.ringtone.loop = true;
      this.ringtone.play().catch(() => {});
    } catch {}
  }

  _stopRingtone() {
    if (!this.ringtone) return;
    try {
      this.ringtone.pause();
      this.ringtone.currentTime = 0;
    } catch {}
  }

  _playRingback(loop = true) {
    if (!this.ringback) return;
    try {
      this.ringback.currentTime = 0;
      this.ringback.loop = loop;
      this.ringback.play().catch(() => {});
    } catch {}
  }

  _stopRingback() {
    if (!this.ringback) return;
    try {
      this.ringback.pause();
      this.ringback.currentTime = 0;
    } catch {}
  }

  // ============================================================
  // STUBS FOR INIT HOOKS
  // ============================================================
  _bindAdaptiveLayout() {}
  _applyAccessibility() {}
  _toggleDebug() {}
  _setMeetMode() {}

  // ============================================================
  // FINAL INIT
  // ============================================================
  _init() {
    this._bindVideoUpgradeButtons();
    this._bindAdaptiveLayout();
    this._applyAccessibility();
    this._toggleDebug();
    this._setMeetMode();
    this._enableHaptics();
  }
}

export default CallUI;
;







