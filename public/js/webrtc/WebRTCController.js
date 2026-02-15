// public/js/webrtc/WebRTCController.js
// ============================================================
// WebRTCController: signaling, peer connection, media, upgrades,
// screen share, and remote track handling.
// Aligned with CallUI.js (voice/video, upgrade overlay, screen share).
// ============================================================

import { rtcState } from "./WebRTCState.js";
import {
  getLocalMedia,
  attachLocalStream,
  attachRemoteTrack,
  startScreenShare,
  cleanupMedia,
  upgradeLocalToVideo,
} from "./WebRTCMedia.js";

function log(...args) {
  console.log("[WebRTC]", ...args);
}

export class WebRTCController {
  constructor(socket) {
    this.socket = socket;

    // Single-peer map (future‑proof for multi‑peer)
    this.pcMap = new Map();

    // Screen share
    this.screenTrack = null;
    this.screenSender = null;

    // Callbacks (wired by CallUI)
    this.onCallStarted = () => {};
    this.onCallEnded = () => {};
    this.onRemoteJoin = () => {};
    this.onRemoteLeave = () => {};
    this.onQualityUpdate = () => {};
    this.onIncomingOffer = () => {};
    this.onRemoteUpgradedToVideo = () => {};

    this._bindSocket();
  }

  /* -------------------------------------------------------
     SOCKET SIGNALING
  ------------------------------------------------------- */
  _bindSocket() {
    this.socket.on("webrtc:signal", async (msg) => {
      const { type, from, offer, answer, candidate, isVideoUpgrade } = msg;

      switch (type) {
        case "offer":
          await this._handleOffer(from, offer, !!isVideoUpgrade);
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
     CREATE / GET PEER CONNECTION
  ------------------------------------------------------- */
  _ensurePC(peerId) {
    peerId = String(peerId);

    if (this.pcMap.has(peerId)) {
      return this.pcMap.get(peerId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
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
      const state = pc.connectionState;
      log("pc state", peerId, state);

      // Simple quality mapping
      if (this.onQualityUpdate) {
        this.onQualityUpdate(state);
      }

      if (state === "failed") {
        pc.restartIce();
      }

      if (state === "disconnected" || state === "closed") {
        this._handleLeave(peerId);
      }
    };

    return pc;
  }

  /* -------------------------------------------------------
     START CALL (CALLER)
  ------------------------------------------------------- */
  async startCall(peerId, { audio = true, video = true } = {}) {
    peerId = String(peerId);
    rtcState.isCaller = true;
    rtcState.peerId = peerId;
    rtcState.audioOnly = audio && !video;

    const stream = await getLocalMedia(audio, video);
    attachLocalStream(stream);

    const pc = this._ensurePC(peerId);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.socket.emit("webrtc:signal", {
      type: "offer",
      to: peerId,
      offer,
      isVideoUpgrade: false,
    });

    rtcState.inCall = true;
    rtcState.callStartTs = Date.now();
    this.onCallStarted(peerId);
  }

  /* -------------------------------------------------------
     HANDLE INCOMING OFFER (CALLEE)
     - Initial call (voice or video)
     - Voice → video upgrade (isVideoUpgrade = true)
     We DO NOT auto-answer here; CallUI decides.
  ------------------------------------------------------- */
  async _handleOffer(peerId, offer, isVideoUpgrade = false) {
    peerId = String(peerId);
    rtcState.peerId = peerId;
    rtcState.incomingOffer = offer;

    const sdp = offer?.sdp || "";
    const hasVideoInSdp = sdp.includes("m=video");
    rtcState.incomingIsVideo = hasVideoInSdp || isVideoUpgrade;

    // Do NOT touch local media here for upgrade preview.
    // CallUI will call rtc.answerCall() when user accepts.
    this.onIncomingOffer(peerId, offer);
  }

  /* -------------------------------------------------------
     ANSWER CALL (CALLEE ACCEPTS)
     - Handles both initial call and video upgrade accept.
  ------------------------------------------------------- */
  async answerCall() {
    const peerId = rtcState.peerId;
    const offer = rtcState.incomingOffer;
    if (!peerId || !offer) return;

    const pc = this._ensurePC(peerId);

    await pc.setRemoteDescription(offer);

    let stream = rtcState.localStream;

    // If no local stream yet, get appropriate media
    if (!stream) {
      if (rtcState.incomingIsVideo) {
        stream = await getLocalMedia(true, true);
      } else {
        stream = await getLocalMedia(true, false);
      }
      attachLocalStream(stream);
    } else if (rtcState.incomingIsVideo && rtcState.audioOnly) {
      // We were audio-only and are now accepting a video upgrade
      stream = await upgradeLocalToVideo();
    }

    rtcState.localStream = stream;
    rtcState.audioOnly = !rtcState.incomingIsVideo;

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.socket.emit("webrtc:signal", {
      type: "answer",
      to: peerId,
      answer,
    });

    rtcState.inCall = true;
    rtcState.callStartTs = rtcState.callStartTs || Date.now();
    this.onCallStarted(peerId);
  }

  /* -------------------------------------------------------
     HANDLE ANSWER (CALLER)
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
     SCREEN SHARE (OPTION B: simple track replace)
  ------------------------------------------------------- */
  async startScreenShare() {
    const result = await startScreenShare();
    if (!result) return null;

    const { stream, track } = result;

    const pc = this.pcMap.get(rtcState.peerId);
    if (!pc) return null;

    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) {
      await sender.replaceTrack(track);
      this.screenSender = sender;
      this.screenTrack = track;

      track.onended = () => this.stopScreenShare();
      return true;
    }

    return null;
  }

  async stopScreenShare() {
    if (!this.screenSender || !this.screenTrack) return;

    const pc = this.pcMap.get(rtcState.peerId);
    if (!pc) return;

    const camTrack = rtcState.localStream?.getVideoTracks()[0];
    if (camTrack) {
      await this.screenSender.replaceTrack(camTrack);
    }

    this.screenTrack.stop();
    this.screenTrack = null;
    this.screenSender = null;
  }

  /* -------------------------------------------------------
     UPGRADE VOICE → VIDEO (CALLER INITIATES)
  ------------------------------------------------------- */
  async upgradeToVideo() {
    const peerId = rtcState.peerId;
    if (!peerId) return;

    const pc = this._ensurePC(peerId);

    const newStream = await upgradeLocalToVideo();
    rtcState.localStream = newStream;
    rtcState.audioOnly = false;

    newStream.getVideoTracks().forEach((track) => {
      const sender = pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");
      if (sender) {
        sender.replaceTrack(track);
      } else {
        pc.addTrack(track, newStream);
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.socket.emit("webrtc:signal", {
      type: "offer",
      to: peerId,
      offer,
      isVideoUpgrade: true,
    });
  }

  /* -------------------------------------------------------
     END CALL (LOCAL HANGUP)
  ------------------------------------------------------- */
  endCall() {
    const peerId = rtcState.peerId;

    for (const [, pc] of this.pcMap.entries()) {
      pc.close();
    }
    this.pcMap.clear();

    cleanupMedia();

    rtcState.inCall = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.incomingIsVideo = false;

    if (peerId) {
      this.socket.emit("webrtc:signal", {
        type: "leave",
        to: peerId,
      });
    }

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
    this.onCallEnded();
  }
}










































































































































































































