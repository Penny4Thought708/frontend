// public/js/webrtc/WebRTCController.js
import { rtcState } from "./WebRTCState.js";
import {
  getLocalMedia,
  attachLocalStream,
  attachRemoteTrack,
  startScreenShare,
  cleanupMedia,
} from "./WebRTCMedia.js";

function log(...args) {
  console.log("[WebRTC]", ...args);
}

/* -------------------------------------------------------
   CONTROLLER CLASS
------------------------------------------------------- */
export class WebRTCController {
  constructor(socket) {
    this.socket = socket;

    // peerId → RTCPeerConnection
    this.pcMap = new Map();

    // screen share
    this.screenTrack = null;
    this.screenSender = null;

    // event callbacks for UI
    this.onCallStarted = () => {};
    this.onCallEnded = () => {};
    this.onRemoteJoin = () => {};
    this.onRemoteLeave = () => {};
    this.onQualityUpdate = () => {};

    this._bindSocket();
  }

  /* -------------------------------------------------------
     SOCKET SIGNALING
  ------------------------------------------------------- */
  _bindSocket() {
    this.socket.on("webrtc:signal", async (msg) => {
      const { type, from, offer, answer, candidate } = msg;

      switch (type) {
        case "offer":
          await this._handleOffer(from, offer);
          break;

        case "answer":
          await this._handleAnswer(from, answer);
          break;

        case "ice":
          await this._handleIce(from, candidate);
          break;

        case "leave":
          this._handleLeave(from);
          break;
      }
    });
  }

  /* -------------------------------------------------------
     CREATE PEER CONNECTION
  ------------------------------------------------------- */
  _ensurePC(peerId) {
    peerId = String(peerId);

    if (this.pcMap.has(peerId)) {
      return this.pcMap.get(peerId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        // You can add TURN here
      ],
    });

    this.pcMap.set(peerId, pc);

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        this.socket.emit("webrtc:signal", {
          type: "ice",
          to: peerId,
          candidate: evt.candidate,
        });
      }
    };

    pc.ontrack = (evt) => {
      log("ontrack from", peerId, evt.track.kind);
      attachRemoteTrack(peerId, evt);
      this.onRemoteJoin(peerId);
    };

    pc.onconnectionstatechange = () => {
      log("pc state", peerId, pc.connectionState);
      if (pc.connectionState === "failed") {
        pc.restartIce();
      }
      if (pc.connectionState === "disconnected") {
        this._handleLeave(peerId);
      }
    };

    return pc;
  }

  /* -------------------------------------------------------
     START CALL (CALLER)
  ------------------------------------------------------- */
  async startCall(peerId) {
    rtcState.isCaller = true;
    rtcState.peerId = String(peerId);

    const stream = await getLocalMedia(true, true);
    attachLocalStream(stream);

    const pc = this._ensurePC(peerId);

    // Add tracks
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.socket.emit("webrtc:signal", {
      type: "offer",
      to: peerId,
      offer,
    });

    rtcState.inCall = true;
    rtcState.callStartTs = Date.now();
    this.onCallStarted(peerId);
  }

  /* -------------------------------------------------------
     HANDLE INCOMING OFFER (CALLEE)
  ------------------------------------------------------- */
  async _handleOffer(peerId, offer) {
    peerId = String(peerId);
    rtcState.peerId = peerId;

    const pc = this._ensurePC(peerId);

    if (!rtcState.localStream) {
      const stream = await getLocalMedia(true, true);
      attachLocalStream(stream);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }

    await pc.setRemoteDescription(offer);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.socket.emit("webrtc:signal", {
      type: "answer",
      to: peerId,
      answer,
    });

    rtcState.inCall = true;
    rtcState.callStartTs = Date.now();
    this.onCallStarted(peerId);
  }

  /* -------------------------------------------------------
     HANDLE ANSWER
  ------------------------------------------------------- */
  async _handleAnswer(peerId, answer) {
    peerId = String(peerId);
    const pc = this._ensurePC(peerId);

    await pc.setRemoteDescription(answer);
  }

  /* -------------------------------------------------------
     HANDLE ICE CANDIDATE
  ------------------------------------------------------- */
  async _handleIce(peerId, candidate) {
    peerId = String(peerId);
    const pc = this._ensurePC(peerId);

    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      log("ICE error:", err);
    }
  }

  /* -------------------------------------------------------
     SCREEN SHARE
  ------------------------------------------------------- */
  async startScreenShare() {
    const result = await startScreenShare();
    if (!result) return;

    const { stream, track } = result;

    const pc = this.pcMap.get(rtcState.peerId);
    if (!pc) return;

    // Replace outgoing video track
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) {
      await sender.replaceTrack(track);
      this.screenSender = sender;
      this.screenTrack = track;

      track.onended = () => this.stopScreenShare();
    }
  }

  async stopScreenShare() {
    if (!this.screenSender || !this.screenTrack) return;

    const pc = this.pcMap.get(rtcState.peerId);
    if (!pc) return;

    // Restore camera
    const camTrack = rtcState.localStream.getVideoTracks()[0];
    await this.screenSender.replaceTrack(camTrack);

    this.screenTrack.stop();
    this.screenTrack = null;
    this.screenSender = null;
  }

  /* -------------------------------------------------------
     END CALL
  ------------------------------------------------------- */
  endCall() {
    for (const [peerId, pc] of this.pcMap.entries()) {
      pc.close();
    }
    this.pcMap.clear();

    cleanupMedia();

    rtcState.inCall = false;
    rtcState.peerId = null;

    this.onCallEnded();
  }

  /* -------------------------------------------------------
     REMOTE LEAVE
  ------------------------------------------------------- */
  _handleLeave(peerId) {
    peerId = String(peerId);

    const pc = this.pcMap.get(peerId);
    if (pc) pc.close();
    this.pcMap.delete(peerId);

    this.onRemoteLeave(peerId);
  }
}







































































































































































































