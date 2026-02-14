// public/js/webrtc/CallUI.js
import { rtcState } from "./WebRTCState.js";
import { WebRTCController } from "./WebRTCController.js";

const isMobile =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

function log(...args) {
  console.log("[CallUI]", ...args);
}

export class CallUI {
  constructor(socket) {
    this.socket = socket;
    this.controller = new WebRTCController(socket);

    this.callWindow = document.getElementById("callWindow");
    this.callGrid = document.getElementById("callGrid");
    this.callStatus = document.getElementById("call-status");
    this.callTimer = document.getElementById("call-timer");
    this.qualityIndicator = document.getElementById("call-quality-indicator");
    this.localPip = document.getElementById("localPip");
    this.moreBtn = document.getElementById("more-controls-btn");
    this.moreMenu = document.getElementById("more-controls-menu");

    this.muteBtn = document.getElementById("mute-call");
    this.camBtn = document.getElementById("camera-toggle");
    this.endBtn = document.getElementById("end-call");
    this.answerBtn = document.getElementById("answer-call");
    this.declineBtn = document.getElementById("decline-call");
    this.upgradeBtn = document.getElementById("upgrade-to-video");

    this.cameraOnBeep = document.getElementById("cameraOnBeep");

    this._activeStageIsLocal = false;

    this._bindButtons();
    this._bindControllerEvents();
    this._startQualityMonitor();
    this._startTimerLoop();
    this._initPipDrag();
  }

  /* -------------------------------------------------------
     BUTTON WIRING
  ------------------------------------------------------- */
  _bindButtons() {
    this.muteBtn?.addEventListener("click", () => this.toggleMute());
    this.camBtn?.addEventListener("click", () => this.toggleCamera());
    this.endBtn?.addEventListener("click", () => this.endCall());
    this.answerBtn?.addEventListener("click", () => this.answerCall());
    this.declineBtn?.addEventListener("click", () => this.endCall());
    this.moreBtn?.addEventListener("click", () => this._toggleMoreMenu());
    this.upgradeBtn?.addEventListener("click", () => this.upgradeToVideo());

    const localStage = document.getElementById("localParticipant");
    const remoteStage = document.getElementById("callGrid");

    localStage?.addEventListener("dblclick", () => this._swapStage());
    localStage?.addEventListener("touchend", (e) => {
      if (e.detail === 2) this._swapStage();
    });

    remoteStage?.addEventListener("dblclick", () => this._swapStage());
    remoteStage?.addEventListener("touchend", (e) => {
      if (e.detail === 2) this._swapStage();
    });
  }

  _toggleMoreMenu() {
    if (!this.moreMenu) return;
    this.moreMenu.classList.toggle("hidden");
    this.moreMenu.classList.toggle("show");
  }

  /* -------------------------------------------------------
     CONTROLLER EVENT HOOKS
  ------------------------------------------------------- */
  _bindControllerEvents() {
    this.controller.onCallStarted = () => {
      this._enterActiveCallMode();
    };

    this.controller.onCallEnded = () => {
      this._exitCallMode();
    };

    this.controller.onIncomingOffer = (peerId, offer) => {
      this._handleIncomingOffer(peerId, offer);
    };

    this.controller.onRemoteUpgradedToVideo = () => {
      this._handleRemoteUpgradedToVideo();
    };

    this.controller.onRemoteJoin = (peerId) => {
      log("Remote joined:", peerId);
    };

    this.controller.onRemoteLeave = (peerId) => {
      log("Remote left:", peerId);
    };

    this.controller.onQualityUpdate = (level) => {
      this._updateQualityIndicator(level);
    };
  }

  /* -------------------------------------------------------
     PUBLIC API FOR OUTSIDE CODE
  ------------------------------------------------------- */
  startVoiceCall(peerId) {
    rtcState.audioOnly = true;
    this._openWindow();
    this._enterOutboundVoiceMode();
    this.controller.startCall(peerId, { audio: true, video: false });
  }

  startVideoCall(peerId) {
    rtcState.audioOnly = false;
    this._openWindow();
    this._enterOutboundVideoMode();
    this.controller.startCall(peerId, { audio: true, video: true });
  }

  receiveInboundCall(peerId, isVideo = false) {
    rtcState.peerId = peerId;
    rtcState.audioOnly = !isVideo;

    this._openWindow();
    if (isVideo) {
      this._enterInboundVideoMode();
    } else {
      this._enterInboundVoiceMode();
    }
  }

  answerCall() {
    this.controller.answerCall();
  }

  endCall() {
    this.controller.endCall();
  }

  async upgradeToVideo() {
    await this.controller.upgradeToVideo();
    rtcState.audioOnly = false;
    this._enterVideoControlsMode();
  }

  /* -------------------------------------------------------
     INBOUND OFFER HANDLING
  ------------------------------------------------------- */
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
  }

  /* -------------------------------------------------------
     UI MODE SWITCHING
  ------------------------------------------------------- */
  _openWindow() {
    if (!this.callWindow) return;
    this.callWindow.classList.remove("hidden");
    this.callWindow.classList.add("is-open", "call-opening");
    setTimeout(() => this.callWindow.classList.remove("call-opening"), 300);
  }

  _enterInboundVoiceMode() {
    this._setModeClasses({ inbound: true, active: false, video: false });
    this.callStatus.textContent = "Incoming voice call…";
    this._showControls({ answer: true, decline: true, mute: false, cam: false, end: false, upgrade: false });
  }

  _enterInboundVideoMode() {
    this._setModeClasses({ inbound: true, active: false, video: true });

    if (isMobile) {
      this.callStatus.textContent = "Incoming video call…";
      this.callWindow.classList.add("mobile-fullscreen-preview");
    } else {
      this.callStatus.textContent = "Incoming video call…";
      this.callWindow.classList.add("desktop-blurred-preview");
    }

    this._showControls({ answer: true, decline: true, mute: false, cam: false, end: false, upgrade: false });
  }

  _enterOutboundVoiceMode() {
    this._setModeClasses({ inbound: false, active: false, video: false });
    this.callStatus.textContent = "Calling…";
    this._showControls({ answer: false, decline: false, mute: true, cam: false, end: true, upgrade: true });
  }

  _enterOutboundVideoMode() {
    this._setModeClasses({ inbound: false, active: false, video: true });
    this.callStatus.textContent = "Calling…";
    this._showControls({ answer: false, decline: false, mute: true, cam: true, end: true, upgrade: false });
  }

  _enterActiveCallMode() {
    this._setModeClasses({ inbound: false, active: true, video: !rtcState.audioOnly });

    this.callStatus.textContent = "Connected";
    rtcState.callStartTs = Date.now();

    if (isMobile) {
      this.callWindow.classList.remove("mobile-fullscreen-preview");
    } else {
      this.callWindow.classList.remove("desktop-blurred-preview");
    }

    if (rtcState.audioOnly) {
      this._showControls({ answer: false, decline: false, mute: true, cam: false, end: true, upgrade: true });
    } else {
      this._showControls({ answer: false, decline: false, mute: true, cam: true, end: true, upgrade: false });
    }
  }

  _enterVideoControlsMode() {
    this._setModeClasses({ inbound: false, active: true, video: true });
    this._showControls({ answer: false, decline: false, mute: true, cam: true, end: true, upgrade: false });
  }

  _exitCallMode() {
    if (!this.callWindow) return;
    this.callWindow.classList.remove("is-open");
    this.callWindow.classList.add("hidden");

    this.callStatus.textContent = "Call ended";
    this.callTimer.textContent = "00:00";
  }

  _setModeClasses({ inbound, active, video }) {
    if (!this.callWindow) return;

    this.callWindow.classList.toggle("inbound-mode", inbound);
    this.callWindow.classList.toggle("active-mode", active);
    this.callWindow.classList.toggle("video-mode", video);
    this.callWindow.classList.toggle("voice-only-call", !video);
  }

  _showControls({ answer, decline, mute, cam, end, upgrade }) {
    if (this.answerBtn) this.answerBtn.classList.toggle("hidden", !answer);
    if (this.declineBtn) this.declineBtn.classList.toggle("hidden", !decline);
    if (this.muteBtn) this.muteBtn.classList.toggle("hidden", !mute);
    if (this.camBtn) this.camBtn.classList.toggle("hidden", !cam);
    if (this.endBtn) this.endBtn.classList.toggle("hidden", !end);
    if (this.upgradeBtn) this.upgradeBtn.classList.toggle("hidden", !upgrade);
  }

  /* -------------------------------------------------------
     MUTE / CAMERA
  ------------------------------------------------------- */
  toggleMute() {
    rtcState.micMuted = !rtcState.micMuted;

    const stream = rtcState.localStream;
    if (!stream) return;

    stream.getAudioTracks().forEach((t) => (t.enabled = !rtcState.micMuted));
  }

  toggleCamera() {
    rtcState.cameraOff = !rtcState.cameraOff;

    const stream = rtcState.localStream;
    if (!stream) return;

    stream.getVideoTracks().forEach((t) => (t.enabled = !rtcState.cameraOff));

    this.callWindow.classList.toggle("camera-off", rtcState.cameraOff);
  }

  /* -------------------------------------------------------
     STAGE SWAP (DOUBLE TAP / DOUBLE CLICK)
  ------------------------------------------------------- */
  _swapStage() {
    this._activeStageIsLocal = !this._activeStageIsLocal;

    const localTile = document.getElementById("localParticipant");
    const grid = this.callGrid;

    if (!localTile || !grid) return;

    localTile.classList.toggle("stage", this._activeStageIsLocal);
    localTile.classList.toggle("pip", !this._activeStageIsLocal);

    grid.classList.toggle("stage-remote", !this._activeStageIsLocal);
    grid.classList.toggle("stage-local", this._activeStageIsLocal);
  }

  /* -------------------------------------------------------
     DRAGGABLE PIP (MOBILE)
  ------------------------------------------------------- */
  _initPipDrag() {
    if (!isMobile) return;
    const pip = this.localPip;
    if (!pip) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;

    const onTouchStart = (e) => {
      const touch = e.touches[0];
      dragging = true;
      startX = touch.clientX;
      startY = touch.clientY;
      const rect = pip.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
    };

    const onTouchMove = (e) => {
      if (!dragging) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      pip.style.transform = `translate(${origX + dx}px, ${origY + dy}px)`;
    };

    const onTouchEnd = () => {
      dragging = false;
    };

    pip.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
  }

  /* -------------------------------------------------------
     QUALITY INDICATOR
  ------------------------------------------------------- */
  _updateQualityIndicator(level) {
    if (!this.qualityIndicator) return;
    this.qualityIndicator.dataset.level = level;
    this.qualityIndicator.textContent =
      level.charAt(0).toUpperCase() + level.slice(1);
  }

  /* -------------------------------------------------------
     TIMER LOOP
  ------------------------------------------------------- */
  _startTimerLoop() {
    setInterval(() => {
      if (!rtcState.inCall || !rtcState.callStartTs) return;

      const secs = Math.floor((Date.now() - rtcState.callStartTs) / 1000);
      rtcState.callTimerSeconds = secs;

      const m = String(Math.floor(secs / 60)).padStart(2, "0");
      const s = String(secs % 60).padStart(2, "0");

      if (this.callTimer) {
        this.callTimer.textContent = `${m}:${s}`;
      }
    }, 1000);
  }

  /* -------------------------------------------------------
     QUALITY MONITOR (STATS)
  ------------------------------------------------------- */
  _startQualityMonitor() {
    setInterval(async () => {
      if (!rtcState.inCall) return;

      const pc = this.controller.pcMap.get(rtcState.peerId);
      if (!pc) return;

      const stats = await pc.getStats(null);

      let videoLoss = 0;
      let rtt = 0;
      let outgoingBitrate = 0;

      stats.forEach((report) => {
        if (report.type === "remote-inbound-rtp" && report.kind === "video") {
          if (report.packetsLost && report.packetsReceived) {
            videoLoss =
              report.packetsLost /
              (report.packetsLost + report.packetsReceived);
          }
        }
        if (report.type === "candidate-pair" && report.currentRoundTripTime) {
          rtt = report.currentRoundTripTime;
        }
        if (report.type === "outbound-rtp" && report.kind === "video") {
          outgoingBitrate = report.bitrateMean || 0;
        }
      });

      const level = rtcState.updateFromStats({
        videoLoss,
        rtt,
        outgoingBitrate,
      });

      this._updateQualityIndicator(level);
    }, 2000);
  }
}














































