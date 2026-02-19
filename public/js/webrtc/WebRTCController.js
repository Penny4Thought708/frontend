// public/js/webrtc/WebRTCController.js
// High-performance, multi-peer WebRTC controller for FaceTime / Meet / Discord UX

import { rtcState } from "./WebRTCState.js";
import {
  getLocalMedia,
  attachLocalStream,
  attachRemoteTrack,
  startScreenShare,
  cleanupMedia,
  upgradeLocalToVideo,
} from "./WebRTCMedia.js";
import {
  setParticipantOrientation,
  setPrimaryRemote,
} from "./RemoteParticipants.js";

function log(...args) {
  console.log("[WebRTC]", ...args);
}

function warn(...args) {
  console.warn("[WebRTC]", ...args);
}

function err(...args) {
  console.error("[WebRTC]", ...args);
}

// Base ICE config; will be overridden/extended by rtcState.iceServers if present
const ICE_CONFIG_BASE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    // Example TURN — replace with your own in production
    // {
    //   urls: "turn:global.relay.metered.ca:80",
    //   username: "yourUsername",
    //   credential: "yourPassword",
    // },
  ],
  iceCandidatePoolSize: 4,
};

function buildIceConfig() {
  if (rtcState.iceServers && Array.isArray(rtcState.iceServers)) {
    return {
      ...ICE_CONFIG_BASE,
      iceServers: rtcState.iceServers,
    };
  }
  return ICE_CONFIG_BASE;
}

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

    // Orientation data channels (peerId -> RTCDataChannel)
    this.orientationChannels = new Map();

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
          if (rtcState.inCall) {
            log("Ignoring 'unavailable' signal during active call");
            break;
          }
          if (this.onPeerUnavailable) {
            this.onPeerUnavailable(reason || "User unavailable");
          }
          break;

        case "video-upgrade-accepted":
          log("[WebRTC] Caller: video-upgrade-accepted");
          window.callUIInstance?._hideCallerVideoUpgrade?.();
          window.callUIInstance?._enterActiveVideoMode?.();
          break;

        case "video-upgrade-declined":
          log("[WebRTC] Caller: video-upgrade-declined");
          window.callUIInstance?._hideCallerVideoUpgrade?.();
          break;

        default:
          warn("Unknown webrtc:signal type:", type, msg);
          break;
      }
    });
  }

  /* -------------------------------------------------------
     INTERNAL STATE HELPERS
  ------------------------------------------------------- */
  _setStatus(status) {
    rtcState.status = status;
    try {
      this.onCallStatusChange?.(status);
    } catch (e) {
      warn("onCallStatusChange handler error:", e);
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

    try {
      this.onParticipantUpdate?.(peerId, merged);
    } catch (e) {
      warn("onParticipantUpdate handler error:", e);
    }
  }

  _removeParticipant(peerId) {
    peerId = String(peerId);
    if (!rtcState.participants) return;

    rtcState.participants.delete(peerId);

    try {
      this.onParticipantUpdate?.(peerId, null);
    } catch (e) {
      warn("onParticipantUpdate handler error:", e);
    }
  }

  _hasActiveParticipants() {
    return rtcState.participants && rtcState.participants.size > 0;
  }

  _getPc(peerId) {
  peerId = String(peerId);

  // Return existing PC if present
  let pc = this.pcMap.get(peerId);
  if (pc) return pc;

  // Create new RTCPeerConnection
  pc = new RTCPeerConnection(buildIceConfig());
  this.pcMap.set(peerId, pc);

  log("Created RTCPeerConnection for peer:", peerId, buildIceConfig());

  /* -------------------------------------------------------
     ICE CANDIDATES
  ------------------------------------------------------- */
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

  /* -------------------------------------------------------
     CONNECTION STATE
  ------------------------------------------------------- */
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    log("PeerConnection state:", peerId, state);

    if (this.onQualityUpdate) {
      try {
        this.onQualityUpdate(PC_STATE_MAP[state] || state);
      } catch (e) {
        warn("onQualityUpdate handler error:", e);
      }
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

  /* -------------------------------------------------------
     REMOTE TRACKS
  ------------------------------------------------------- */
  pc.ontrack = (evt) => {
    log("ontrack from", peerId, evt.track.kind, evt.track.id);
    attachRemoteTrack(peerId, evt);
    this._addParticipant(peerId, { state: "connected" });

    try {
      setPrimaryRemote(String(peerId));
    } catch (e) {
      warn("setPrimaryRemote error:", e);
    }

    try {
      this.onRemoteJoin?.(peerId);
    } catch (e) {
      warn("onRemoteJoin handler error:", e);
    }
  };

  /* -------------------------------------------------------
     NEGOTIATION NEEDED
  ------------------------------------------------------- */
  pc.onnegotiationneeded = async () => {
    log("onnegotiationneeded for peer:", peerId);
    // (You currently don't auto‑renegotiate here — correct for your flow)
  };

  return pc;
}


  /* -------------------------------------------------------
     ORIENTATION DATA CHANNEL
  ------------------------------------------------------- */
  _wireOrientationChannel(peerId, dc) {
    if (!dc) return;
    peerId = String(peerId);

    this.orientationChannels.set(peerId, dc);

    dc.onopen = () => {
      log("Orientation channel open for peer", peerId);
    };

    dc.onclose = () => {
      log("Orientation channel closed for peer", peerId);
      this.orientationChannels.delete(peerId);
    };

    dc.onerror = (e) => {
      warn("Orientation channel error for peer", peerId, e);
    };

    dc.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data?.type === "orientation" && data.orientation) {
          const orientation =
            data.orientation === "portrait" ? "portrait" : "landscape";
          setParticipantOrientation(peerId, orientation);
        }
      } catch (e) {
        warn("Orientation message parse error:", e);
      }
    };
  }

  // Called by mobile UI when device orientation changes
  sendOrientation(orientation) {
    const value = orientation === "portrait" ? "portrait" : "landscape";
    for (const [, dc] of this.orientationChannels.entries()) {
      if (dc.readyState === "open") {
        try {
          dc.send(JSON.stringify({ type: "orientation", orientation: value }));
        } catch (e) {
          warn("Failed to send orientation:", e);
        }
      }
    }
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
      offerToReceiveVideo: video,   // 🔥 FIXED
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
    this.onCallStarted?.(peerId);
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

  await this._softAcceptVideoUpgrade(peerId, offer);

  // ✅ tell CallUI this *is* a video upgrade
  this.onIncomingOffer?.(peerId, offer, true);
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
      this.onIncomingOfferQueued?.(peerId, offer, callId || rtcState.callId);
      return;
    }

    // Normal inbound path
    rtcState.peerId = peerId;
    rtcState.incomingOffer = offer;
    rtcState.incomingIsVideo = incomingIsVideo;
    this._setStatus("ringing");

    this.onIncomingOffer?.(peerId, offer, isVideoUpgrade);

  }
  
  async _softAcceptVideoUpgrade(peerId, offer) {
  const pc = this._ensurePC(peerId);

  // Apply the remote offer
  await pc.setRemoteDescription(offer);

  // Add local tracks (upgrade if needed)
  let stream = rtcState.localStream;

  if (!stream) {
    stream = await getLocalMedia(true, false); // audio only
  }

  if (rtcState.audioOnly) {
    // Upgrade local stream to include video
    stream = await upgradeLocalToVideo();
  }

  rtcState.localStream = stream;

  // Replace or add tracks
  stream.getTracks().forEach((track) => {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === track.kind);
    if (sender) sender.replaceTrack(track);
    else pc.addTrack(track, stream);
  });

  // Create and send answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  this.socket.emit("webrtc:signal", {
    type: "answer",
    to: peerId,
    from: rtcState.selfId,
    callId: rtcState.callId,
    answer,
  });

  // ⭐ IMPORTANT:
  // Do NOT call onCallStarted
  // Do NOT flip UI
  // Do NOT change rtcState.audioOnly yet
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
    // Upgrade existing audio-only stream to video
    stream = await upgradeLocalToVideo();
  }

  rtcState.localStream = stream;
  rtcState.audioOnly = !rtcState.incomingIsVideo;

  // Replace or add tracks safely
  stream.getTracks().forEach((track) => {
    const kind = track.kind;
    const sender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === kind);

    if (sender) {
      sender.replaceTrack(track);
    } else {
      pc.addTrack(track, stream);
    }
  });

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
  this.onCallStarted?.(peerId);

  // 🔥 If this was a video upgrade, tell UI to flip to video mode
  if (rtcState.incomingIsVideo && rtcState.audioOnly === false) {
    try {
      this.onRemoteUpgradedToVideo?.(peerId);
    } catch (e) {
      warn("onRemoteUpgradedToVideo handler error (callee):", e);
    }
  }
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

  // 🔥 If this answer includes video and we were audio-only, treat as upgrade
  const sdp = answer?.sdp || "";
  const hasVideo = sdp.includes("m=video");
  if (hasVideo && rtcState.audioOnly) {
    rtcState.audioOnly = false;
    try {
      this.onRemoteUpgradedToVideo?.(peerId);
    } catch (e) {
      warn("onRemoteUpgradedToVideo handler error (caller):", e);
    }
  }
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

  // Get upgraded local stream (audio → audio+video)
  const newStream = await upgradeLocalToVideo();
  rtcState.localStream = newStream;
  rtcState.audioOnly = false;
  rtcState.cameraOff = false;

  // Replace or add video track
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

  // 🔥 Now that rtcState.localStream is upgraded, reattach to UI
  if (window.callUIInstance?._attachLocalStreamFromState) {
    window.callUIInstance._attachLocalStreamFromState();
  }

  // Create and send renegotiation offer
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

// -------------------------------------------------------
// CALLEE RESPONSES TO VIDEO UPGRADE
// -------------------------------------------------------
sendVideoUpgradeAccepted() {
  console.log("[WebRTC] sendVideoUpgradeAccepted →", {
    to: rtcState.peerId,
    callId: rtcState.callId,
  });

  if (!this.socket || !rtcState.peerId) return;

  this.socket.emit("webrtc:signal", {
    type: "video-upgrade-accepted",
    to: rtcState.peerId,
    from: rtcState.selfId,
    callId: rtcState.callId,
  });
}

sendVideoUpgradeDeclined() {
  console.log("[WebRTC] sendVideoUpgradeDeclined →", {
    to: rtcState.peerId,
    callId: rtcState.callId,
  });

  if (!this.socket || !rtcState.peerId) return;

  this.socket.emit("webrtc:signal", {
    type: "video-upgrade-declined",
    to: rtcState.peerId,
    from: rtcState.selfId,
    callId: rtcState.callId,
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

    // Close orientation channels
    for (const [, dc] of this.orientationChannels.entries()) {
      try {
        dc.close();
      } catch {}
    }
    this.orientationChannels.clear();

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

    // Close orientation channel for this peer
    const dc = this.orientationChannels.get(peerId);
    if (dc) {
      try {
        dc.close();
      } catch {}
      this.orientationChannels.delete(peerId);
    }

    this._removeParticipant(peerId);
    this.onRemoteLeave?.(peerId);

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
    this.onIncomingOffer?.(next.from, next.offer);
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















