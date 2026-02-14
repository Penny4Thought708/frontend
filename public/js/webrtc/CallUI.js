// public/js/webrtc/CallUI.js
import { rtcState } from "./WebRTCState.js";
import { WebRTCController } from "./WebRTCController.js";

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

    this._bindButtons();
    this._bindControllerEvents();
    this._startQualityMonitor();
    this._startTimerLoop();
  }

  /* -------------------------------------------------------
     BUTTON WIRING
  ------------------------------------------------------- */
  _bindButtons() {
    const muteBtn = document.getElementById("mute-call");
    const camBtn = document.getElementById("camera-toggle");
    const endBtn = document.getElementById("end-call");
    const answerBtn = document.getElementById("answer-call");
    const declineBtn = document.getElementById("decline-call");
    const shareBtn = document.getElementById("share-screen");
    const moreBtn = document.getElementById("more-controls-btn");
    const moreMenu = document.getElementById("more-controls-menu");

    muteBtn?.addEventListener("click", () => this.toggleMute());
    camBtn?.addEventListener("click", () => this.toggleCamera());
    endBtn?.addEventListener("click", () => this.endCall());
    answerBtn?.addEventListener("click", () => this.answerCall());
    declineBtn?.addEventListener("click", () => this.endCall());
    shareBtn?.addEventListener("click", () => this.toggleScreenShare());

    moreBtn?.addEventListener("click", () => {
      moreMenu.classList.toggle("hidden");
      moreMenu.classList.toggle("show");
    });
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
  startOutboundCall(peerId) {
    this._openWindow();
    this._enterInboundMode(false);
    this.controller.startCall(peerId);
  }

  receiveInboundCall(peerId) {
    rtcState.peerId = peerId;
    this._openWindow();
    this._enterInboundMode(true);
  }

  answerCall() {
    this.controller._handleOffer(rtcState.peerId, rtcState.incomingOffer);
  }

  endCall() {
    this.controller.endCall();
  }

  /* -------------------------------------------------------
     UI MODE SWITCHING
  ------------------------------------------------------- */
  _openWindow() {
    this.callWindow.classList.remove("hidden");
    this.callWindow.classList.add("is-open", "call-opening");
    setTimeout(() => this.callWindow.classList.remove("call-opening"), 300);
  }

  _enterInboundMode(isInbound) {
    this.callWindow.classList.toggle("inbound-mode", isInbound);
    this.callWindow.classList.toggle("active-mode", !isInbound);
    this.callStatus.textContent = isInbound ? "Incoming call…" : "Calling…";
  }

  _enterActiveCallMode() {
    this.callWindow.classList.remove("inbound-mode");
    this.callWindow.classList.add("active-mode");

    this.callStatus.textContent = "Connected";
    rtcState.callStartTs = Date.now();
  }

  _exitCallMode() {
    this.callWindow.classList.remove("is-open");
    this.callWindow.classList.add("hidden");

    this.callStatus.textContent = "Call ended";
    this.callTimer.textContent = "00:00";
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
     SCREEN SHARE
  ------------------------------------------------------- */
  async toggleScreenShare() {
    if (this.controller.screenTrack) {
      await this.controller.stopScreenShare();
      this.callGrid.classList.remove("screen-share-mode");
      return;
    }

    const result = await this.controller.startScreenShare();
    if (result) {
      this.callGrid.classList.add("screen-share-mode");
    }
  }

  /* -------------------------------------------------------
     QUALITY INDICATOR
  ------------------------------------------------------- */
  _updateQualityIndicator(level) {
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

      this.callTimer.textContent = `${m}:${s}`;
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
















































