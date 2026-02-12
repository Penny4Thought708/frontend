// public/js/webrtc/WebRTCController.js
// Premium, production‑grade WebRTC controller
// Aligned with:
// - node-backend/src/sockets/webrtc.js (webrtc:signal + call:* events)
// - WebRTCMedia.js (getLocalMedia, attachRemoteTrack, cleanupMedia, flipLocalCamera)
// - CallUI.js (Aurora‑Orbit Call UI)

import { rtcState } from "./WebRTCState.js";
import {
  getLocalMedia,
  attachRemoteTrack,
  cleanupMedia,
  refreshLocalAvatarVisibility,
  flipLocalCamera,
} from "./WebRTCMedia.js";

const log = (...args) => console.log("[WebRTC]", ...args);

export class WebRTCController {
  constructor(socket, currentUserId, helpers = {}) {
    this.socket = socket;
    this.currentUserId = String(currentUserId || "");
    this.helpers = helpers;

    // Core state
    this.localPeerId = this.currentUserId;
    this.remotePeerId = null;

    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;

    this.pendingRemoteCandidates = new Map(); // key: peerId -> [candidates]
    this.callState = {
      active: false,
      ringing: false,
      direction: null, // "outgoing" | "incoming"
      voiceOnly: false,
    };

    // Media elements (wired by CallUI)
    this.mediaElements = {
      localVideo: null,
      remoteVideo: null,
      remoteAudio: null,
    };

    // UI callbacks (wired by CallUI)
    this.onOutgoingCall = null;
    this.onIncomingCall = null;
    this.onCallStarted = null;
    this.onCallEnded = null;
    this.onCallFailed = null;
    this.onQualityChange = null;
    this.onRemoteCameraOff = null;
    this.onRemoteCameraOn = null;
    this.onRemoteSpeaking = null;
    this.onScreenShareStarted = null;
    this.onScreenShareStopped = null;
    this.onNoiseSuppressionChanged = null;
    this.onRecordingChanged = null;
    this.onVoicemailPrompt = null;
    this.onSecondaryIncomingCall = null;
    this.onLocalStream = null;

    // Internal flags
    this._muted = false;
    this._voiceOnly = false;
    this._statsTimer = null;

    // Audio processing / recording
    this._noiseSuppression = false;
    this._recording = false;
    this._recorder = null;
    this._recordedChunks = [];

    this._wireSocketEvents();
  }

  /* -------------------------------------------------------
     Public: attach media elements (from CallUI)
  ------------------------------------------------------- */
  attachMediaElements({ localVideo, remoteVideo, remoteAudio } = {}) {
    this.mediaElements.localVideo = localVideo || null;
    this.mediaElements.remoteVideo = remoteVideo || null;
    this.mediaElements.remoteAudio = remoteAudio || null;

    if (this.localStream && localVideo) {
      localVideo.srcObject = this.localStream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.classList.add("show");
      localVideo.style.display = "block";
      localVideo.style.opacity = "1";
    }
  }

  /* -------------------------------------------------------
     Public: start outgoing call
  ------------------------------------------------------- */
  async callUser(targetId, { audioOnly = false } = {}) {
    const peerId = String(targetId);
    this.remotePeerId = peerId;
    this.callState.direction = "outgoing";
    this.callState.ringing = true;
    this.callState.active = false;
    this.callState.voiceOnly = !!audioOnly;
    this._voiceOnly = !!audioOnly;

    log("Placing call to", peerId, "audioOnly=", audioOnly);

    try {
      await this._ensurePeerConnection(peerId);

      const audio = true;
      const video = !audioOnly;
      const stream = await getLocalMedia(audio, video);
      this.localStream = stream;
      rtcState.localStream = stream;

      if (this.onLocalStream) {
        this.onLocalStream(stream);
      } else {
        this._bindLocalPreview(stream);
      }

      stream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, stream);
      });

      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: !audioOnly,
      });
      await this.peerConnection.setLocalDescription(offer);

      this._sendSignal({
        type: "offer",
        to: peerId,
        offer,
        audioOnly,
        renegotiate: false,
      });

      if (this.onOutgoingCall) {
        this.onOutgoingCall({
          targetId: peerId,
          targetName: this.helpers.getUserName?.(peerId) || "",
          voiceOnly: audioOnly,
        });
      }
    } catch (err) {
      log("callUser failed:", err);
      this._failCall("Failed to start call");
    }
  }

  /* -------------------------------------------------------
     Public: answer incoming call
  ------------------------------------------------------- */
  async answerIncomingCall() {
    if (!this.remotePeerId) {
      log("answerIncomingCall: no remotePeerId");
      return;
    }

    const peerId = this.remotePeerId;
    log("Answering call from", peerId);

    try {
      await this._ensurePeerConnection(peerId);

      const audio = true;
      const video = !this._voiceOnly;
      const stream = await getLocalMedia(audio, video);
      this.localStream = stream;
      rtcState.localStream = stream;

      if (this.onLocalStream) {
        this.onLocalStream(stream);
      } else {
        this._bindLocalPreview(stream);
      }

      stream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, stream);
      });

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this._sendSignal({
        type: "answer",
        to: peerId,
        answer,
      });

      // Explicit backend accept path
      this.socket.emit("call:accept", { to: peerId });

      this.callState.active = true;
      this.callState.ringing = false;

      if (this.onCallStarted) {
        this.onCallStarted();
      }

      this._startStatsMonitor();
    } catch (err) {
      log("answerIncomingCall failed:", err);
      this._failCall("Failed to answer call");
    }
  }

  /* -------------------------------------------------------
     Public: decline incoming call
  ------------------------------------------------------- */
  declineIncomingCall() {
    if (!this.remotePeerId) {
      log("declineIncomingCall: no remotePeerId");
      return;
    }

    const peerId = this.remotePeerId;
    log("Declining call from", peerId);

    this.socket.emit("call:decline", { to: peerId });
    this._endCallInternal("declined", true);
  }

  /* -------------------------------------------------------
     Public: end call
  ------------------------------------------------------- */
  endCall(localOnly = false) {
    if (!this.remotePeerId) {
      log("endCall: no remotePeerId");
      this._endCallInternal("ended", true);
      return;
    }

    const peerId = this.remotePeerId;
    log("Ending call with", peerId, "localOnly=", localOnly);

    if (!localOnly) {
      this._sendSignal({
        type: "end",
        to: peerId,
        reason: "hangup",
      });
    }

    this.socket.emit("call:end", { to: peerId });
    this._endCallInternal("ended", true);
  }

  /* -------------------------------------------------------
     Public: toggle mute
  ------------------------------------------------------- */
  toggleMute() {
    this._muted = !this._muted;

    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => {
        t.enabled = !this._muted;
      });
    }

    return this._muted;
  }

  /* -------------------------------------------------------
     Public: camera flip (front/back) — used by CallUI
  ------------------------------------------------------- */
  async switchCamera() {
    try {
      const ok = await flipLocalCamera(this);
      return !ok ? false : false; // keep API: returns false (camera logically "on")
    } catch (err) {
      log("switchCamera failed:", err);
      return false;
    }
  }

  /* -------------------------------------------------------
     Public: audio processing (echo, AGC, noise suppression)
  ------------------------------------------------------- */
  applyAudioProcessing() {
    try {
      this.localStream?.getAudioTracks().forEach((track) => {
        track.applyConstraints({
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: this._noiseSuppression,
        });
      });

      this.onNoiseSuppressionChanged?.(this._noiseSuppression);
    } catch (err) {
      log("applyAudioProcessing failed:", err);
    }
  }

  toggleNoiseSuppression() {
    this._noiseSuppression = !this._noiseSuppression;
    this.applyAudioProcessing();
    return this._noiseSuppression;
  }

  /* -------------------------------------------------------
     Public: screen share (local) — used by CallUI
  ------------------------------------------------------- */
  async startScreenShare() {
    if (!this.peerConnection) return;

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        log("getDisplayMedia not supported");
        return;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      if (!track) {
        log("startScreenShare: no video track");
        return;
      }

      const sender = this.peerConnection
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");

      if (sender) {
        await sender.replaceTrack(track);
      }

      track.onended = () => this.stopScreenShare();

      this.onScreenShareStarted?.(this.localPeerId);
    } catch (err) {
      log("Screen share failed:", err);
    }
  }

  async stopScreenShare() {
    if (!this.peerConnection) return;

    try {
      const camTrack = this.localStream?.getVideoTracks()[0];
      const sender = this.peerConnection
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");

      if (sender && camTrack) {
        await sender.replaceTrack(camTrack);
      }

      this.onScreenShareStopped?.(this.localPeerId);
    } catch (err) {
      log("stopScreenShare failed:", err);
    }
  }

  /* -------------------------------------------------------
     Public: recording (local + remote mixed) — used by CallUI
  ------------------------------------------------------- */
  toggleRecording() {
    try {
      if (!this._recording) {
        const mixed = new MediaStream();

        this.localStream?.getTracks().forEach((t) => mixed.addTrack(t));

        if (rtcState.remoteStreams) {
          Object.values(rtcState.remoteStreams).forEach((s) => {
            s.getTracks().forEach((t) => mixed.addTrack(t));
          });
        }

        this._recordedChunks = [];
        this._recorder = new MediaRecorder(mixed, {
          mimeType: "video/webm; codecs=vp9",
        });

        this._recorder.ondataavailable = (e) => {
          if (e.data.size > 0) this._recordedChunks.push(e.data);
        };

        this._recorder.onstop = () => {
          const blob = new Blob(this._recordedChunks, {
            type: "video/webm",
          });
          const url = URL.createObjectURL(blob);
          log("Recording ready:", url);
          // hook for upload/save if desired
        };

        this._recorder.start();
        this._recording = true;
        this.onRecordingChanged?.({ active: true });
        return true;
      }

      this._recorder?.stop();
      this._recording = false;
      this.onRecordingChanged?.({ active: false });
      return false;
    } catch (err) {
      log("toggleRecording failed:", err);
      return false;
    }
  }

  /* -------------------------------------------------------
     Internal: ensure RTCPeerConnection
  ------------------------------------------------------- */
  async _ensurePeerConnection(peerId) {
    if (this.peerConnection) return this.peerConnection;

    const pc = new RTCPeerConnection({
      iceServers: rtcState.iceServers || [
        { urls: "stun:stun.l.google.com:19302" },
      ],
      iceCandidatePoolSize: 4,
    });

    this.peerConnection = pc;

    pc.onicecandidate = (evt) => {
      if (!evt.candidate) return;
      if (!this.remotePeerId) return;

      this._sendSignal({
        type: "ice",
        to: this.remotePeerId,
        candidate: evt.candidate,
      });
    };

    pc.ontrack = (evt) => {
      const pid = this.remotePeerId || peerId || "default";
      attachRemoteTrack(pid, evt);

      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }
      this.remoteStream.addTrack(evt.track);
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      log("ICE state:", state);

      if (state === "connected" || state === "completed") {
        this.callState.active = true;
        this.callState.ringing = false;
        if (this.onCallStarted) this.onCallStarted();
      }

      if (state === "disconnected" || state === "failed") {
        log("Disconnected — applying fallback");
        this._handleDisconnectFallback();
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log("PC connectionState:", state);

      if (state === "failed") {
        this._failCall("Connection failed");
      }
    };

    pc.onnegotiationneeded = async () => {
      if (!this.remotePeerId) return;
      log("Renegotiation needed for", this.remotePeerId);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        this._sendSignal({
          type: "offer",
          to: this.remotePeerId,
          offer,
          renegotiate: true,
          audioOnly: this._voiceOnly,
        });

        log("Renegotiation offer handled");
      } catch (err) {
        log("Renegotiation failed:", err);
      }
    };

    return pc;
  }

  /* -------------------------------------------------------
     Internal: socket wiring
  ------------------------------------------------------- */
  _wireSocketEvents() {
    if (!this.socket) return;

    this.socket.on("webrtc:signal", (data) => {
      log("webrtc:signal received", data.type, data);
      this._handleSignal(data);
    });

    this.socket.on("call:accept", ({ from }) => {
      log("call:accept received from", from);

      if (String(from) !== String(this.remotePeerId)) return;

      this.callState.active = true;
      this.callState.ringing = false;

      if (this.onCallStarted) {
        this.onCallStarted();
      }

      this._startStatsMonitor();
    });

    this.socket.on("call:timeout", ({ from }) => {
      log("call:timeout from", from);
      if (String(from) !== String(this.remotePeerId)) return;
      this._failCall("Call timed out");
    });

    this.socket.on("call:missed", ({ from }) => {
      log("call:missed from", from);
      if (String(from) !== String(this.remotePeerId)) return;
      this._failCall("Missed call");
    });

    this.socket.on("call:declined", ({ from }) => {
      log("call:declined from", from);
      if (String(from) !== String(this.remotePeerId)) return;
      this._failCall("Call declined");
    });

    this.socket.on("call:dnd", ({ from }) => {
      log("call:dnd from", from);
      if (String(from) !== String(this.remotePeerId)) return;
      this._failCall("User in Do Not Disturb");
    });

    this.socket.on("call:voicemail", (data) => {
      log("call:voicemail", data);
      if (this.onVoicemailPrompt) {
        this.onVoicemailPrompt({
          peerId: this.remotePeerId,
          message: this._voicemailMessageFromReason(data.reason),
        });
      }
    });
  }

  _voicemailMessageFromReason(reason) {
    switch (reason) {
      case "timeout":
        return "They didn’t answer. Leave a voicemail?";
      case "declined":
        return "They declined your call. Leave a voicemail?";
      case "missed":
        return "They missed your call. Leave a voicemail?";
      case "dnd":
        return "They’re in Do Not Disturb. Leave a voicemail?";
      default:
        return "User unavailable. Leave a voicemail?";
    }
  }

  /* -------------------------------------------------------
     Internal: handle incoming webrtc:signal
  ------------------------------------------------------- */
  async _handleSignal(data) {
    const { type, from, offer, answer, candidate, renegotiate, audioOnly } = data;
    const peerId = String(from);

    if (!peerId || peerId === this.currentUserId) return;

    switch (type) {
      case "offer":
        await this._handleOffer(peerId, offer, {
          renegotiate: !!renegotiate,
          audioOnly: !!audioOnly,
        });
        break;

      case "answer":
        await this._handleAnswer(peerId, answer);
        break;

      case "ice":
        await this._handleRemoteIce(peerId, candidate);
        break;

      case "end":
        this._handleRemoteEnd(peerId, data.reason);
        break;

      default:
        log("Unknown webrtc:signal type:", type);
    }
  }

  /* -------------------------------------------------------
     Internal: handle OFFER
  ------------------------------------------------------- */
  async _handleOffer(peerId, offer, { renegotiate = false, audioOnly = false } = {}) {
    this.remotePeerId = peerId;
    this._voiceOnly = !!audioOnly;
    this.callState.voiceOnly = !!audioOnly;

    if (!renegotiate) {
      this.callState.direction = "incoming";
      this.callState.ringing = true;
      this.callState.active = false;

      if (this.onIncomingCall) {
        this.onIncomingCall({
          fromId: peerId,
          fromName: this.helpers.getUserName?.(peerId) || "",
          audioOnly: !!audioOnly,
        });
      }
    }

    try {
      const pc = await this._ensurePeerConnection(peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      await this._flushPendingRemoteCandidates(peerId, pc);
    } catch (err) {
      log("handleOffer failed:", err);
      this._failCall("Failed to handle offer");
    }
  }

  /* -------------------------------------------------------
     Internal: handle ANSWER
  ------------------------------------------------------- */
  async _handleAnswer(peerId, answer) {
    if (!this.peerConnection) {
      log("handleAnswer: no peerConnection");
      return;
    }

    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );

      await this._flushPendingRemoteCandidates(peerId, this.peerConnection);
    } catch (err) {
      log("handleAnswer failed:", err);
      this._failCall("Failed to handle answer");
    }
  }

  /* -------------------------------------------------------
     Internal: handle remote ICE
  ------------------------------------------------------- */
  async _handleRemoteIce(peerId, candidate) {
    if (!candidate) return;

    const pc = this.peerConnection;
    if (!pc || !pc.remoteDescription) {
      if (!this.pendingRemoteCandidates.has(peerId)) {
        this.pendingRemoteCandidates.set(peerId, []);
      }
      this.pendingRemoteCandidates.get(peerId).push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      log("addIceCandidate failed:", err);
    }
  }

  /* ---------------------------------------------------
     Flush queued ICE
  --------------------------------------------------- */
  async _flushPendingRemoteCandidates(peerId, pc) {
    if (!pc || !pc.remoteDescription) return;

    const list = this.pendingRemoteCandidates.get(peerId);
    if (!list || !list.length) return;

    log("[ICE] Flushing queued remote candidates for", peerId, "count=", list.length);

    for (const cand of list) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        log("addIceCandidate (queued) failed:", err);
      }
    }

    this.pendingRemoteCandidates.delete(peerId);
  }

  /* -------------------------------------------------------
     Internal: remote END
  ------------------------------------------------------- */
  _handleRemoteEnd(peerId, reason) {
    if (String(peerId) !== String(this.remotePeerId)) return;

    log("Remote ended call:", peerId, "reason:", reason);
    this._endCallInternal(reason || "remote-ended", false);
  }

  /* -------------------------------------------------------
     Internal: end call + cleanup
  ------------------------------------------------------- */
  _endCallInternal(reason = "ended", fireCallbacks = true) {
    this.callState.active = false;
    this.callState.ringing = false;

    if (this._statsTimer) {
      clearInterval(this._statsTimer);
      this._statsTimer = null;
    }

    try {
      if (this.peerConnection) {
        this.peerConnection.onicecandidate = null;
        this.peerConnection.ontrack = null;
        this.peerConnection.oniceconnectionstatechange = null;
        this.peerConnection.onconnectionstatechange = null;
        this.peerConnection.onnegotiationneeded = null;
        this.peerConnection.close();
      }
    } catch {}

    this.peerConnection = null;

    cleanupMedia();
    this.localStream = null;
    this.remoteStream = null;
    this.remotePeerId = null;

    refreshLocalAvatarVisibility?.();

    if (!fireCallbacks) return;

    if (
      reason === "failed" ||
      reason === "timeout" ||
      reason === "declined" ||
      reason === "missed"
    ) {
      if (this.onCallFailed) this.onCallFailed(reason);
    } else {
      if (this.onCallEnded) this.onCallEnded();
    }
  }

  /* -------------------------------------------------------
     Internal: fail call
  ------------------------------------------------------- */
  _failCall(reason) {
    log("Call failed:", reason);
    this._endCallInternal("failed", true);
  }

  /* -------------------------------------------------------
     Internal: send signal
  ------------------------------------------------------- */
  _sendSignal(payload) {
    if (!this.socket) return;
    this.socket.emit("webrtc:signal", payload);
  }

  /* -------------------------------------------------------
     Internal: bind local preview
  ------------------------------------------------------- */
  _bindLocalPreview(stream) {
    const localVideo = this.mediaElements.localVideo;
    if (!localVideo || !stream) return;

    localVideo.srcObject = stream;
    localVideo.muted = true;
    localVideo.playsInline = true;
    localVideo.classList.add("show");
    localVideo.style.display = "block";
    localVideo.style.opacity = "1";

    localVideo
      .play()
      .catch((err) => log("Local video play blocked:", err));
  }

  /* -------------------------------------------------------
     Internal: disconnect fallback
  ------------------------------------------------------- */
  _handleDisconnectFallback() {
    this._endCallInternal("failed", true);
  }

  /* -------------------------------------------------------
     Internal: stats / quality monitor
  ------------------------------------------------------- */
  _startStatsMonitor() {
    if (!this.peerConnection) return;
    if (this._statsTimer) clearInterval(this._statsTimer);

    this._statsTimer = setInterval(async () => {
      try {
        const pc = this.peerConnection;
        if (!pc) return;

        const stats = await pc.getStats(null);
        let rtt = null;
        let jitter = null;
        let packetsLost = null;
        let bitrate = null;

        stats.forEach((report) => {
          if (report.type === "remote-inbound-rtp" && report.kind === "audio") {
            rtt = report.roundTripTime;
            jitter = report.jitter;
            packetsLost = report.packetsLost;
          }
          if (report.type === "outbound-rtp" && report.kind === "video") {
            bitrate = report.bitrateMean || report.bytesSent;
          }
        });

        const info = [];
        if (rtt != null) info.push(`RTT: ${(rtt * 1000).toFixed(0)}ms`);
        if (jitter != null) info.push(`Jitter: ${jitter.toFixed(3)}`);
        if (packetsLost != null) info.push(`Lost: ${packetsLost}`);
        if (bitrate != null) info.push(`Bitrate: ${bitrate}`);

        const text = info.join(" | ");

        let level = "unknown";
        if (rtt != null) {
          const ms = rtt * 1000;
          if (ms < 80) level = "excellent";
          else if (ms < 150) level = "good";
          else if (ms < 250) level = "fair";
          else if (ms < 400) level = "poor";
          else level = "bad";
        }

        if (this.onQualityChange) {
          this.onQualityChange(level, text);
        }
      } catch (err) {
        log("Stats monitor error:", err);
      }
    }, 3000);
  }
}

export function createWebRTCController(socket, currentUserId, helpers = {}) {
  return new WebRTCController(socket, currentUserId, helpers);
}




































































































































































