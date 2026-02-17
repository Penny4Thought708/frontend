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
//   - clean decline/timeout/busy semantics
//   - TURN-ready ICE + robust diagnostics
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

function warn(...args) {
  console.warn("[WebRTC]", ...args);
}

function err(...args) {
  console.error("[WebRTC]", ...args);
}

// High-end ICE configuration (STUN + TURN-ready)
// Replace TURN config with your own credentials in production.
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    // Example TURN — replace with your own
    // {
    //   urls: "turn:global.relay.metered.ca:80",
    //   username: "yourUsername",
    //   credential: "yourPassword",
    // },
  ],
  iceCandidatePoolSize: 4,
};

// Connection state mapping for UI/analytics
const PC_STATE_MAP = {
  new: "new",
  checking: "checking",
  connected: "connected",
  completed: "completed",
  failed: "failed",
  disconnected: "disconnected",
  closed: "closed",
};

export class WebRTCController {
  constructor(socket) {
    this.socket = socket;

    // Multi-peer map (group-call ready)
    this.pcMap = new Map();

    // Screen share
    this.screenTrack = null;
    this.screenSender = null;

    // ICE candidate buffering (per peer)
    this._pendingCandidates = {};

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

    // UI hooks
    this.onScreenShareStarted = () => {};
    this.onScreenShareStopped = () => {};
    this.onPeerUnavailable = () => {};

    // Internal flags
    this._destroyed = false;

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

  _getPc(peerId) {
    peerId = String(peerId);
    return this.pcMap.get(peerId) || null;
  }

  /* -------------------------------------------------------
     SOCKET SIGNALING
  ------------------------------------------------------- */
  _bindSocket() {
    if (!this.socket) {
      err("No socket provided to WebRTCController");
      return;
    }

    this.socket.on("webrtc:signal", async (msg) => {
      if (this._destroyed) return;

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
      } = msg || {};

      if (!from && type !== "unavailable") {
        warn("Received webrtc:signal without 'from':", msg);
      }

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
            // If we're already in a call, ignore late "unavailable" noise
            if (rtcState.inCall) {
              log("Ignoring 'unavailable' signal during active call");
              break;
            }
            if (this.onPeerUnavailable) {
              this.onPeerUnavailable(reason || "User unavailable");
            }
            break;
        default:
          warn("Unknown webrtc:signal type:", type, msg);
          break;
      }
    });

    // Dedicated decline/busy/timeout channels from server
     this.socket.on("call:declined", (msg) => {
      if (this._destroyed) return;
      const { from, reason } = msg || {};
    
      // If we're already in a call, this is stale noise — ignore
      if (rtcState.inCall) {
        log("Ignoring call:declined during active call from", from, reason);
        return;
      }
    
      log("call:declined from", from, reason);
      if (this.onPeerUnavailable) {
        this.onPeerUnavailable(reason || "Call declined");
      }
      this._remoteEndWithoutPc(from, reason || "declined");
    });


       this.socket.on("call:busy", (msg) => {
      if (this._destroyed) return;
      const { from, reason } = msg || {};
    
      if (rtcState.inCall) {
        log("Ignoring call:busy during active call from", from, reason);
        return;
      }
    
      log("call:busy from", from, reason);
      if (this.onPeerUnavailable) {
        this.onPeerUnavailable(reason || "User busy");
      }
      this._remoteEndWithoutPc(from, reason || "busy");
    });


      this.socket.on("call:timeout", (msg) => {
      if (this._destroyed) return;
      const { from, reason } = msg || {};
    
      if (rtcState.inCall) {
        log("Ignoring call:timeout during active call from", from, reason);
        return;
      }
    
      log("call:timeout from", from, reason);
      if (this.onPeerUnavailable) {
        this.onPeerUnavailable(reason || "Call timed out");
      }
      this._remoteEndWithoutPc(from, reason || "timeout");
    });

  }

  _remoteEndWithoutPc(peerId, reason) {
    rtcState.inCall = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.incomingIsVideo = false;
    this._setStatus("idle");
    this.onCallEnded?.(reason || "remote_end");
    this._maybeProcessNextQueuedCall();
  }

  /* -------------------------------------------------------
     CREATE / GET PEER CONNECTION
  ------------------------------------------------------- */
  _ensurePC(peerId) {
    peerId = String(peerId);

    if (this.pcMap.has(peerId)) {
      return this.pcMap.get(peerId);
    }

    const pc = new RTCPeerConnection(ICE_CONFIG);
    this.pcMap.set(peerId, pc);

    log("Created RTCPeerConnection for peer:", peerId, ICE_CONFIG);

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

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      log("ICE connection state:", peerId, state);
      if (state === "failed") {
        warn("ICE failed, attempting restart:", peerId);
        try {
          pc.restartIce();
        } catch (e) {
          err("restartIce failed:", e);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log("PeerConnection state:", peerId, state);

      if (this.onQualityUpdate) {
        this.onQualityUpdate(PC_STATE_MAP[state] || state);
      }

      if (state === "failed") {
        try {
          pc.restartIce();
        } catch (e) {
          err("restartIce failed on connectionState 'failed':", e);
        }
      }

      if (state === "disconnected" || state === "closed") {
        this._handleLeave(peerId);
      }
    };

    pc.ontrack = (evt) => {
      log("ontrack from", peerId, evt.track.kind, evt.track.id);
      attachRemoteTrack(peerId, evt);
      this._addParticipant(peerId, { state: "connected" });
      this.onRemoteJoin(peerId);
    };

    pc.onnegotiationneeded = async () => {
      log("onnegotiationneeded for peer:", peerId);
      // Optional renegotiation hook
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

    if (callId) {
      rtcState.callId = callId;
    } else if (!rtcState.callId) {
      rtcState.callId = `${rtcState.selfId || "user"}-${Date.now()}`;
    }

    log("startCall →", {
      peerId,
      audio,
      video,
      callId: rtcState.callId,
    });

    const stream = await getLocalMedia(audio, video);
    attachLocalStream(stream);
    rtcState.localStream = stream;

    const pc = this._ensurePC(peerId);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
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

    log("Incoming offer:", {
      from: peerId,
      isVideoUpgrade,
      incomingIsVideo,
      callId: rtcState.callId,
    });

    // Video upgrade while already in-call
    if (isVideoUpgrade && rtcState.status === "in-call") {
      rtcState.peerId = peerId;
      rtcState.incomingOffer = offer;
      rtcState.incomingIsVideo = true;
      this.onIncomingOffer(peerId, offer);
      return;
    }

    // Already in a call → queue this offer
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

    this.onIncomingOffer(peerId, offer);
  }

  /* -------------------------------------------------------
     ANSWER CALL (CALLEE ACCEPTS)
     - Handles both initial call and video upgrade accept.
  ------------------------------------------------------- */
  async answerCall() {
    const peerId = rtcState.peerId;
    const offer = rtcState.incomingOffer;
    if (!peerId || !offer) {
      warn("answerCall called without peerId or offer");
      return;
    }

    log("answerCall →", { peerId, incomingIsVideo: rtcState.incomingIsVideo });

    const pc = this._ensurePC(peerId);

    await pc.setRemoteDescription(offer);

    // Flush buffered ICE candidates for this peer
    if (this._pendingCandidates[peerId]) {
      for (const c of this._pendingCandidates[peerId]) {
        try {
          await pc.addIceCandidate(c);
        } catch (e) {
          log("Buffered ICE error (answerCall):", e);
        }
      }
      delete this._pendingCandidates[peerId];
    }

    let stream = rtcState.localStream;

    if (!stream) {
      if (rtcState.incomingIsVideo) {
        stream = await getLocalMedia(true, true);
      } else {
        stream = await getLocalMedia(true, false);
      }
      attachLocalStream(stream);
    } else if (rtcState.incomingIsVideo && rtcState.audioOnly) {
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
    log("Received answer from", peerId);

    await pc.setRemoteDescription(answer);

    // Flush buffered ICE candidates for this peer
    if (this._pendingCandidates[peerId]) {
      for (const c of this._pendingCandidates[peerId]) {
        try {
          await pc.addIceCandidate(c);
        } catch (e) {
          log("Buffered ICE error (_handleAnswer):", e);
        }
      }
      delete this._pendingCandidates[peerId];
    }

    this._addParticipant(peerId, { state: "connected" });
  }

  /* -------------------------------------------------------
     DECLINE INBOUND CALL (BEFORE ANSWER)
  ------------------------------------------------------- */
  declineCall(reason = "declined") {
    const peerId = rtcState.peerId;
    const callId = rtcState.callId;

    log("declineCall →", { peerId, callId, reason });

    rtcState.inCall = false;
    rtcState.incomingOffer = null;
    rtcState.incomingIsVideo = false;
    this._setStatus("idle");

    if (peerId && callId) {
      this.socket.emit("call:declined", {
        from: rtcState.selfId,
        to: peerId,
        callId,
        reason,
      });
    }

    this.onCallEnded?.("declined");
  }

  /* -------------------------------------------------------
     HANDLE ICE CANDIDATE (BUFFER UNTIL REMOTE DESCRIPTION)
  ------------------------------------------------------- */
  async _handleIce(peerId, candidate) {
    peerId = String(peerId);
    const pc = this._ensurePC(peerId);

    // Buffer ICE until remote description is set
    if (!pc.remoteDescription) {
      if (!this._pendingCandidates[peerId]) {
        this._pendingCandidates[peerId] = [];
      }
      this._pendingCandidates[peerId].push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(candidate);
      log("ICE candidate added for", peerId);
    } catch (e) {
      log("ICE error for", peerId, e);
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
    if (!pc) {
      warn("startScreenShare: no active PC for peer", rtcState.peerId);
      return null;
    }

    const sender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");
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

    warn("startScreenShare: no video sender found");
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

    try {
      this.screenTrack.stop();
    } catch (e) {
      err("stopScreenShare: failed to stop screenTrack:", e);
    }

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
    if (!peerId) {
      warn("upgradeToVideo called with no peerId");
      return;
    }

    const pc = this._ensurePC(peerId);

    log("upgradeToVideo →", { peerId });

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

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
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
  endCall(reason = "local_hangup") {
    const hadCall = rtcState.inCall;
    const prevCallId = rtcState.callId;
    const peerId = rtcState.peerId;

    log("endCall →", { reason, hadCall, prevCallId, peerId });

    for (const [, pc] of this.pcMap.entries()) {
      try {
        pc.close();
      } catch (e) {
        err("Error closing PC:", e);
      }
    }
    this.pcMap.clear();

    cleanupMedia();

    rtcState.inCall = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.incomingIsVideo = false;
    rtcState.participants = new Map();

    if (hadCall && prevCallId) {
      this.socket.emit("webrtc:signal", {
        type: "leave",
        from: rtcState.selfId,
        to: peerId || null,
        callId: prevCallId,
        reason,
      });
    }

    this._setStatus("idle");
    this.onCallEnded?.(reason);

    this._maybeProcessNextQueuedCall();
  }

  /* -------------------------------------------------------
     REMOTE LEAVE
  ------------------------------------------------------- */
  _handleLeave(peerId) {
    peerId = String(peerId);

    log("Remote leave:", peerId);

    const pc = this.pcMap.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch (e) {
        err("Error closing PC on leave:", e);
      }
    }
    this.pcMap.delete(peerId);

    this._removeParticipant(peerId);
    this.onRemoteLeave(peerId);

    if (!this._hasActiveParticipants()) {
      cleanupMedia();
      rtcState.inCall = false;
      rtcState.peerId = null;
      rtcState.incomingOffer = null;
      rtcState.incomingIsVideo = false;
      this._setStatus("idle");
      this.onCallEnded?.("remote_leave");
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

    log("Processing next queued call:", next);

    this._setStatus("ringing");
    this.onIncomingOffer(next.from, next.offer);
  }

  /* -------------------------------------------------------
     OPTIONAL: PUT CURRENT CALL ON HOLD (HOOK ONLY)
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

  /* -------------------------------------------------------
     DESTROY CONTROLLER (OPTIONAL CLEANUP)
  ------------------------------------------------------- */
  destroy() {
    this._destroyed = true;
    try {
      this.endCall("controller_destroyed");
    } catch (e) {
      err("Error during destroy:", e);
    }
  }
}





