// public/js/webrtc/WebRTCController.js
// ============================================================
// WebRTCController: signaling, peer connection, media, upgrades,
// screen share, remote track handling, call waiting, inbound queue,
// and group-call–ready architecture.
//
// UI owns:
//   - PiP, swap, layouts, toasts, voicemail, etc.
// This file focuses on:
//   - signaling
//   - peer connection lifecycle
//   - media routing
//   - screen share
//   - call queue + status
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

// Expected rtcState extensions (in WebRTCState.js):
// rtcState.callId = null;
// rtcState.participants = new Map(); // peerId -> { joinedAt, state }
// rtcState.status = "idle"; // "idle" | "ringing" | "in-call" | "on-hold"
// rtcState.inboundQueue = []; // [{ from, offer, incomingIsVideo, callId }]

export class WebRTCController {
  constructor(socket) {
    this.socket = socket;

    // Multi-peer map (group-call ready)
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
    this.onIncomingOfferQueued = () => {};
    this.onRemoteUpgradedToVideo = () => {};
    this.onCallStatusChange = () => {};
    this.onParticipantUpdate = () => {};

    // New UI hooks
    this.onScreenShareStarted = () => {};
    this.onScreenShareStopped = () => {};
    this.onPeerUnavailable = () => {};

    this._bindSocket();
  }

  /* -------------------------------------------------------
     INTERNAL STATE HELPERS
  ------------------------------------------------------- */
  _setStatus(status) {
    rtcState.status = status;
    if (this.onCallStatusChange) {
      this.onCallStatusChange(status);
    }
  }

  _addParticipant(peerId, extra = {}) {
    peerId = String(peerId);
    if (!rtcState.participants) rtcState.participants = new Map();
    const existing = rtcState.participants.get(peerId) || {};
    const merged = {
      ...existing,
      peerId,
      joinedAt: existing.joinedAt || Date.now(),
      state: extra.state || existing.state || "connected",
      ...extra,
    };
    rtcState.participants.set(peerId, merged);
    if (this.onParticipantUpdate) {
      this.onParticipantUpdate(peerId, merged);
    }
  }

  _removeParticipant(peerId) {
    peerId = String(peerId);
    if (!rtcState.participants) return;
    rtcState.participants.delete(peerId);
    if (this.onParticipantUpdate) {
      this.onParticipantUpdate(peerId, null);
    }
  }

  _hasActiveParticipants() {
    return rtcState.participants && rtcState.participants.size > 0;
  }

  /* -------------------------------------------------------
     SOCKET SIGNALING
  ------------------------------------------------------- */
  _bindSocket() {
    this.socket.on("webrtc:signal", async (msg) => {
      const {
        type,
        from,
        to,
        callId,
        offer,
        answer,
        candidate,
        isVideoUpgrade,
        reason,
      } = msg;

      if (!rtcState.callId && callId) {
        rtcState.callId = callId;
      }

      switch (type) {
        case "offer":
          await this._handleOffer(from, offer, !!isVideoUpgrade, callId);
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
        case "unavailable":
          // Server can emit this when callee is unreachable/busy
          if (this.onPeerUnavailable) {
            this.onPeerUnavailable(reason || "User unavailable");
          }
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
        // TURN-only / custom servers can be added here
      ],
    });

    this.pcMap.set(peerId, pc);

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        this.socket.emit("webrtc:signal", {
          type: "ice",
          to: peerId,
          from: rtcState.selfId,
          callId: rtcState.callId,
          candidate: evt.candidate,
        });
      }
    };

    pc.ontrack = (evt) => {
      log("ontrack from", peerId, evt.track.kind);
      attachRemoteTrack(peerId, evt);
      this._addParticipant(peerId, { state: "connected" });
      this.onRemoteJoin(peerId);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log("pc state", peerId, state);

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
     START CALL (CALLER) — GROUP READY
     options: { audio = true, video = true, callId = null }
  ------------------------------------------------------- */
  async startCall(peerId, options = {}) {
    const { audio = true, video = true, callId = null } = options;

    peerId = String(peerId);
    rtcState.isCaller = true;
    rtcState.peerId = peerId;
    rtcState.audioOnly = audio && !video;

    // Assign or reuse callId
    if (callId) {
      rtcState.callId = callId;
    } else if (!rtcState.callId) {
      rtcState.callId = `${rtcState.selfId || "user"}-${Date.now()}`;
    }

    const stream = await getLocalMedia(audio, video);
    attachLocalStream(stream);
    rtcState.localStream = stream;

    const pc = this._ensurePC(peerId);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.socket.emit("webrtc:signal", {
      type: "offer",
      to: peerId,
      from: rtcState.selfId,
      callId: rtcState.callId,
      offer,
      isVideoUpgrade: false,
    });

    rtcState.inCall = true;
    rtcState.callStartTs = Date.now();
    this._setStatus("in-call");
    this._addParticipant(peerId, { state: "connecting" });
    this.onCallStarted(peerId);
  }

  /* -------------------------------------------------------
     HANDLE INCOMING OFFER (CALLEE)
     - Initial call (voice or video)
     - Voice → video upgrade (isVideoUpgrade = true)
     - Call waiting + inbound queue
  ------------------------------------------------------- */
  async _handleOffer(from, offer, isVideoUpgrade = false, callId = null) {
    const peerId = String(from);
    const sdp = offer?.sdp || "";
    const hasVideoInSdp = sdp.includes("m=video");
    const incomingIsVideo = hasVideoInSdp || isVideoUpgrade;

    if (callId && !rtcState.callId) {
      rtcState.callId = callId;
    }

    // If already in a call (1:1 or group), queue this offer
    if (rtcState.status === "in-call" || rtcState.status === "on-hold") {
      if (!rtcState.inboundQueue) rtcState.inboundQueue = [];
      rtcState.inboundQueue.push({
        from: peerId,
        offer,
        incomingIsVideo,
        callId: callId || rtcState.callId,
      });
      if (this.onIncomingOfferQueued) {
        this.onIncomingOfferQueued(peerId, offer, callId || rtcState.callId);
      }
      return;
    }

    // Normal inbound path
    rtcState.peerId = peerId;
    rtcState.incomingOffer = offer;
    rtcState.incomingIsVideo = incomingIsVideo;
    this._setStatus("ringing");

    // Do NOT touch local media here; CallUI decides via answerCall()
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
      from: rtcState.selfId,
      callId: rtcState.callId,
      answer,
    });

    rtcState.inCall = true;
    rtcState.callStartTs = rtcState.callStartTs || Date.now();
    this._setStatus("in-call");
    this._addParticipant(peerId, { state: "connected" });
    this.onCallStarted(peerId);
  }

  /* -------------------------------------------------------
     HANDLE ANSWER (CALLER)
  ------------------------------------------------------- */
  async _handleAnswer(peerId, answer) {
    peerId = String(peerId);
    const pc = this._ensurePC(peerId);
    await pc.setRemoteDescription(answer);
    this._addParticipant(peerId, { state: "connected" });
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
     SCREEN SHARE (simple track replace)
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

      if (this.onScreenShareStarted) {
        this.onScreenShareStarted();
      }

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

    if (this.onScreenShareStopped) {
      this.onScreenShareStopped();
    }
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
      from: rtcState.selfId,
      callId: rtcState.callId,
      offer,
      isVideoUpgrade: true,
    });
  }

  /* -------------------------------------------------------
     END CALL (LOCAL HANGUP)
  ------------------------------------------------------- */
  endCall() {
    const hadCall = rtcState.inCall;
    const prevCallId = rtcState.callId;

    for (const [, pc] of this.pcMap.entries()) {
      pc.close();
    }
    this.pcMap.clear();

    cleanupMedia();

    rtcState.inCall = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.incomingIsVideo = false;
    rtcState.participants = new Map();

    // Notify remote peers in this call (1:1 or group)
    if (hadCall && prevCallId) {
      this.socket.emit("webrtc:signal", {
        type: "leave",
        from: rtcState.selfId,
        callId: prevCallId,
      });
    }

    this._setStatus("idle");
    this.onCallEnded();

    // After ending, check inbound queue for next call
    this._maybeProcessNextQueuedCall();
  }

  /* -------------------------------------------------------
     REMOTE LEAVE
  ------------------------------------------------------- */
  _handleLeave(peerId) {
    peerId = String(peerId);

    const pc = this.pcMap.get(peerId);
    if (pc) pc.close();
    this.pcMap.delete(peerId);

    this._removeParticipant(peerId);
    this.onRemoteLeave(peerId);

    // If no more participants, treat as call ended
    if (!this._hasActiveParticipants()) {
      cleanupMedia();
      rtcState.inCall = false;
      rtcState.peerId = null;
      rtcState.incomingOffer = null;
      rtcState.incomingIsVideo = false;
      this._setStatus("idle");
      this.onCallEnded();
      this._maybeProcessNextQueuedCall();
    }
  }

  /* -------------------------------------------------------
     INBOUND QUEUE HANDLING
  ------------------------------------------------------- */
  _maybeProcessNextQueuedCall() {
    if (!rtcState.inboundQueue || rtcState.inboundQueue.length === 0) {
      return;
    }

    const next = rtcState.inboundQueue.shift();
    if (!next) return;

    rtcState.callId = next.callId;
    rtcState.peerId = next.from;
    rtcState.incomingOffer = next.offer;
    rtcState.incomingIsVideo = next.incomingIsVideo;

    this._setStatus("ringing");
    this.onIncomingOffer(next.from, next.offer);
  }

  /* -------------------------------------------------------
     OPTIONAL: PUT CURRENT CALL ON HOLD (HOOK ONLY)
     (Actual hold behavior is implemented in media/UI layers)
  ------------------------------------------------------- */
  setOnHold(onHold) {
    if (onHold) {
      this._setStatus("on-hold");
    } else if (rtcState.inCall) {
      this._setStatus("in-call");
    } else {
      this._setStatus("idle");
    }
  }
}












































































































































































































