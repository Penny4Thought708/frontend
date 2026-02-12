// public/js/webrtc/WebRTCController.js
// Production‑grade WebRTC controller aligned with new Call UI + media engine.

import { rtcState } from "./WebRTCState.js";
rtcState.answering = false;

import {
  setLocalAvatar,
  setRemoteAvatar,
  showLocalAvatar,
  showRemoteAvatar,
} from "./AvatarFallback.js";

import {
  getLocalMedia,
  attachRemoteTrack,
  cleanupMedia,
} from "./WebRTCMedia.js";

import { addCallLogEntry } from "../call-log.js";

import {
  getMyUserId,
  getMyFullname,
  getMyAvatar,
  ringback,
  ringtone,
  getVoiceBtn,
  getVideoBtn,
  remoteAudioEl,
} from "../session.js";

import { getIceServers } from "../ice.js";
import { getReceiver } from "../messaging.js";

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

function stopAudio(el) {
  if (!el) return;
  try {
    el.pause();
    el.currentTime = 0;
  } catch {}
}

/* -------------------------------------------------------
   WebRTC Controller
------------------------------------------------------- */

export class WebRTCController {
  constructor(socket) {
    this.socket = socket;
    this.pc = null;
    this.localStream = null;

    this.pendingRemoteCandidates = [];

    this.localVideo = null;
    this.remoteAudio = remoteAudioEl || document.getElementById("remoteAudio");
    if (!this.remoteAudio) {
      console.warn("[WebRTC] remoteAudio element not found");
    }

    // UI callbacks (wired by CallUI)
    this.onOutgoingCall = null;
    this.onIncomingCall = null;
    this.onCallStarted = null;
    this.onCallEnded = null;
    this.onCallFailed = null;
    this.onQualityChange = null;
    this.onSecondaryIncomingCall = null;
    this.onVoicemailPrompt = null;
    this.onScreenShareStarted = null;
    this.onScreenShareStopped = null;
    this.onLocalStream = null;
    this._bindSocketEvents();

    // Wire call buttons
    const voiceBtn = getVoiceBtn();
    const videoBtn = getVideoBtn();

    if (voiceBtn) {
      voiceBtn.onclick = () => {
        const peerId = getReceiver();
        if (!peerId) {
          console.warn("[WebRTC] Voice call attempted with no receiver");
          return;
        }
        this.startCall(peerId, true);
      };
    }

    if (videoBtn) {
      videoBtn.onclick = () => {
        const peerId = getReceiver();
        if (!peerId) {
          console.warn("[WebRTC] Video call attempted with no receiver");
          return;
        }
        this.startCall(peerId, false);
      };
    }

    // Initialize local avatar
    setLocalAvatar(getMyAvatar());
    showLocalAvatar();

    // Network change → ICE restart
    window.addEventListener("online", () => {
      if (this.pc) {
        try {
          this.pc.restartIce();
        } catch {}
      }
    });
  }

  /* ---------------------------------------------------
     Media elements wiring (optional override)
  --------------------------------------------------- */
  attachMediaElements({ localVideo, remoteAudio }) {
    if (localVideo) this.localVideo = localVideo;
    if (remoteAudio) this.remoteAudio = remoteAudio;
  }

  /* ---------------------------------------------------
     Entry points: voice / video
  --------------------------------------------------- */
  startVoiceCall() {
    const peerId = getReceiver();
    if (!peerId) return;
    this._startCallInternal(peerId, true, { relayOnly: false });
  }

  startVideoCall() {
    const peerId = getReceiver();
    if (!peerId) return;
    this._startCallInternal(peerId, false, { relayOnly: false });
  }

  async startCall(peerId, audioOnly) {
    return this._startCallInternal(peerId, audioOnly, { relayOnly: false });
  }
/* ---------------------------------------------------
   Outgoing Call (Hybrid Google‑Meet + Discord Upgrade)
--------------------------------------------------- */
async _startCallInternal(peerId, audioOnly, { relayOnly }) {
  console.log("[WebRTC] _startCallInternal", { peerId, audioOnly, relayOnly });
  const myId = getMyUserId();
  if (!myId) return;

  rtcState.peerId = peerId;
  rtcState.peerName = rtcState.peerName || `User ${peerId}`;
  rtcState.audioOnly = !!audioOnly;
  rtcState.isCaller = true;
  rtcState.busy = true;
  rtcState.inCall = false;
  rtcState.incomingOffer = null;
  rtcState.usedRelayFallback = !!relayOnly;

  const pc = await this._createPC({ relayOnly });

  // Acquire local media
  const stream = await getLocalMedia(true, !audioOnly);
  this.localStream = stream;
  rtcState.localStream = stream;

  // 🔥 Notify CallUI so it can bind the stream to #localVideo
  this.onLocalStream?.(stream);

  // Add tracks to PeerConnection
  if (stream) {
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  } else {
    console.warn("[WebRTC] No local media — continuing call anyway");
  }

  this.onOutgoingCall?.({
    targetName: rtcState.peerName,
    voiceOnly: audioOnly,
  });

  // Create offer
  let offer = await pc.createOffer();

  // VP9 priority
  if (offer.sdp) {
    offer.sdp = offer.sdp.replace(
      /(m=video .*?)(96 97 98)/,
      (match, prefix, list) => `${prefix}98 96 97`
    );
  }

  await pc.setLocalDescription(offer);

  // Meet-style bitrate
  const videoSender = pc
    .getSenders()
    .find((s) => s.track && s.track.kind === "video");

  if (videoSender) {
    const params = videoSender.getParameters();
    params.encodings = [{
      maxBitrate: 1_500_000,
      minBitrate:   300_000,
      maxFramerate: 30,
    }];
    try {
      await videoSender.setParameters(params);
    } catch (err) {
      console.warn("[WebRTC] setParameters failed", err);
    }
  }

  this.socket.emit("webrtc:signal", {
    type: "offer",
    to: peerId,
    from: myId,
    offer,
    audioOnly: !!audioOnly,
    fromName: getMyFullname(),
  });

  ringback?.play().catch(() => {});
}


  /* ---------------------------------------------------
     Resume after restore
  --------------------------------------------------- */
  async _resumeAsCallerAfterRestore(peerId) {
    const relayOnly = !!rtcState.usedRelayFallback;
    const audioOnly = !!rtcState.audioOnly;
    await this._startCallInternal(peerId, audioOnly, { relayOnly });
  }

  /* ---------------------------------------------------
     Incoming Offer
  --------------------------------------------------- */
  async handleOffer(data) {
    const { from, offer, fromName, audioOnly, fromUser } = data || {};
    console.log("[WebRTC] handleOffer", data);
    if (!from || !offer) return;

    rtcState.peerId = from;

    rtcState.peerName = fromUser?.fullname || fromName || `User ${from}`;
    rtcState.peerAvatar = fromUser?.avatar || null;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;

    rtcState.busy = true;
    rtcState.inCall = false;
    rtcState.incomingOffer = data;
    rtcState.usedRelayFallback = false;

    if (fromUser?.avatar) {
      setRemoteAvatar(fromUser.avatar);
      showRemoteAvatar();
    }

    ringtone?.play().catch(() => {});

    this.onIncomingCall?.({
      fromName: rtcState.peerName,
      audioOnly: rtcState.audioOnly,
    });
  }

/* ---------------------------------------------------
   Answer Incoming Call (Hybrid Google‑Meet + Discord)
--------------------------------------------------- */
async answerIncomingCall() {
  const offerData = rtcState.incomingOffer;
  if (!offerData) return;

  const { from, offer, audioOnly } = offerData;

  rtcState.audioOnly = !!audioOnly;
  rtcState.inCall = true;
  rtcState.busy = true;

  stopAudio(ringtone);

  const pc = await this._createPC({ relayOnly: false });

  // VP9 priority on remote offer
  if (offer.sdp) {
    offer.sdp = offer.sdp.replace(
      /(m=video .*?)(96 97 98)/,
      (match, prefix, list) => `${prefix}98 96 97`
    );
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  await this._flushPendingRemoteCandidates();

  const stream = await getLocalMedia(true, !rtcState.audioOnly);
  this.localStream = stream;
  rtcState.localStream = stream;

  // 🔥 make receiver’s local preview show
  this.onLocalStream?.(stream);

  if (stream) {
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  }

  let answer = await pc.createAnswer();

  // VP9 priority on answer
  if (answer.sdp) {
    answer.sdp = answer.sdp.replace(
      /(m=video .*?)(96 97 98)/,
      (match, prefix, list) => `${prefix}98 96 97`
    );
  }

  await pc.setLocalDescription(answer);

  // Meet-style bitrate
  const videoSender = pc
    .getSenders()
    .find((s) => s.track && s.track.kind === "video");

  if (videoSender) {
    const params = videoSender.getParameters();
    params.encodings = [{
      maxBitrate: 1_500_000,
      minBitrate:   300_000,
      maxFramerate: 30,
    }];
    try {
      await videoSender.setParameters(params);
    } catch (err) {
      console.warn("[WebRTC] setParameters failed", err);
    }
  }

  this.socket.emit("webrtc:signal", {
    type: "answer",
    to: from,
    from: getMyUserId(),
    answer,
  });

  rtcState.incomingOffer = null;

  this.onCallStarted?.();
}

  /* ---------------------------------------------------
     Decline incoming call
  --------------------------------------------------- */
  declineIncomingCall() {
    const offerData = rtcState.incomingOffer;
    const callerId = offerData?.from || rtcState.currentCallerId;

    if (callerId) {
      this.socket.emit("call:decline", { to: callerId });
    }

    addCallLogEntry({
      logId: Date.now(),
      caller_id: callerId,
      receiver_id: getMyUserId(),
      caller_name: rtcState.peerName || `User ${callerId}`,
      receiver_name: getMyFullname(),
      call_type: rtcState.audioOnly ? "voice" : "video",
      direction: "incoming",
      status: "rejected",
      duration: 0,
      timestamp: new Date().toISOString(),
    });

    rtcState.incomingOffer = null;
    rtcState.inCall = false;
    rtcState.busy = false;

    this.onCallEnded?.();
  }

  /* ---------------------------------------------------
     Remote Answer
  --------------------------------------------------- */
  async handleAnswer(data) {
    if (!this.pc) return;
    if (!data?.answer) return;
    if (!rtcState.isCaller) return;
    if (this.pc.signalingState !== "have-local-offer") return;

    rtcState.answering = true;
    setTimeout(() => (rtcState.answering = false), 800);

    // VP9 priority on remote answer
    if (data.answer.sdp) {
      data.answer.sdp = data.answer.sdp.replace(
        /(m=video .*?)(96 97 98)/,
        (match, prefix, list) => `${prefix}98 96 97`
      );
    }

    await this.pc.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );
    await this._flushPendingRemoteCandidates();

    rtcState.inCall = true;
    rtcState.busy = true;

    stopAudio(ringback);
    this.onCallStarted?.();
  }

  /* ---------------------------------------------------
     ICE Candidate
  --------------------------------------------------- */
  async handleRemoteIceCandidate(data) {
    if (!data?.candidate) return;

    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingRemoteCandidates.push(data.candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch {}
  }

  /* ---------------------------------------------------
     Remote End
  --------------------------------------------------- */
  handleRemoteEnd() {
    if (rtcState.answering) return;
    this.endCall(false);
  }

  /* ---------------------------------------------------
     End Call
  --------------------------------------------------- */
  endCall(local = true) {
    stopAudio(ringback);
    stopAudio(ringtone);

    const peerId = rtcState.peerId;

    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    cleanupMedia();
    this.localStream = null;

    const direction = rtcState.isCaller ? "outgoing" : "incoming";

    let status = "ended";
    if (!rtcState.inCall && !local) status = "missed";
    if (!rtcState.inCall && local && !rtcState.isCaller) status = "rejected";

    addCallLogEntry({
      logId: Date.now(),
      caller_id: rtcState.isCaller ? getMyUserId() : peerId,
      receiver_id: rtcState.isCaller ? peerId : getMyUserId(),
      caller_name: rtcState.isCaller ? getMyFullname() : rtcState.peerName,
      receiver_name: rtcState.isCaller ? rtcState.peerName : getMyFullname(),
      call_type: rtcState.audioOnly ? "voice" : "video",
      direction,
      status,
      duration: rtcState.callTimerSeconds || 0,
      timestamp: new Date().toISOString(),
    });

    rtcState.inCall = false;
    rtcState.busy = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.answering = false;

    showLocalAvatar();
    showRemoteAvatar();

    if (local && peerId && this.socket) {
      this.socket.emit("webrtc:signal", {
        type: "end",
        to: peerId,
        from: getMyUserId(),
        reason: "hangup",
      });
    }

    this.onCallEnded?.();
  }

  /* ---------------------------------------------------
     Mute toggle
  --------------------------------------------------- */
  toggleMute() {
    const stream = this.localStream || rtcState.localStream;
    if (!stream) return;

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;

    const enabled = audioTracks.some((t) => t.enabled);
    audioTracks.forEach((t) => (t.enabled = !enabled));

    return enabled;
  }

/* ---------------------------------------------------
   Camera Flip (front/back) — delegates to WebRTCMedia.js
--------------------------------------------------- */
async switchCamera() {
  try {
    const ok = await import("./WebRTCMedia.js")
      .then(m => m.flipLocalCamera(this));

    return ok === true ? false : false; 
    // Always return "camera ON" because flip ≠ disable
  } catch (err) {
    console.error("[WebRTC] switchCamera flip failed:", err);
    return false;
  }
}

  /* ---------------------------------------------------
     Screen Share (Hybrid Google‑Meet + Discord)
  --------------------------------------------------- */
  async startScreenShare() {
    if (!navigator.mediaDevices.getDisplayMedia) {
      console.warn("[WebRTC] Screen share not supported");
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 15, max: 30 },
        },
        audio: false,
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      screenTrack.contentHint = "detail";

      const sender = this.pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");

      if (sender) {
        await sender.replaceTrack(screenTrack);

        const params = sender.getParameters();
        params.encodings = [{
          maxBitrate: 2_500_000,
          minBitrate:   500_000,
          maxFramerate: 30,
        }];
        await sender.setParameters(params);
      }

      screenTrack.onended = async () => {
        console.log("[WebRTC] Screen share stopped");

        const camStream = rtcState.localStream;
        const camTrack = camStream?.getVideoTracks()[0];

        if (camTrack && sender) {
          await sender.replaceTrack(camTrack);

          const params = sender.getParameters();
          params.encodings = [{
            maxBitrate: 1_500_000,
            minBitrate:   300_000,
            maxFramerate: 30,
          }];
          await sender.setParameters(params);
        }

        this.onScreenShareStopped?.(rtcState.peerId);
      };

      this.onScreenShareStarted?.(rtcState.peerId);
    } catch (err) {
      console.warn("[WebRTC] Screen share error:", err);
    }
  }

 /* ---------------------------------------------------
     PeerConnection Factory (Hybrid Meet + Discord)
--------------------------------------------------- */
async _createPC({ relayOnly = false } = {}) {
  if (this.pc) {
    try { this.pc.close(); } catch {}
    this.pc = null;
  }

  const iceServers = await getIceServers({ relayOnly });

  const config = {
    iceServers,
    iceTransportPolicy: relayOnly ? "relay" : "all",
  };

  const pc = new RTCPeerConnection(config);
  this.pc = pc;

  /* TURN Keepalive */
  const startTurnKeepAlive = (pcInstance) => {
    let keepAliveTimer = setInterval(() => {
      try { pcInstance.getStats(null); } catch {}
    }, 3000);

    pcInstance.addEventListener("connectionstatechange", () => {
      if (
        pcInstance.connectionState === "closed" ||
        pcInstance.connectionState === "failed"
      ) {
        clearInterval(keepAliveTimer);
      }
    });
  };

  startTurnKeepAlive(pc);

  /* DataChannel Keepalive */
  try {
    const keepAliveChannel = pc.createDataChannel("keepalive");
    keepAliveChannel.onopen = () => {
      setInterval(() => {
        if (keepAliveChannel.readyState === "open") {
          keepAliveChannel.send("ping");
        }
      }, 5000);
    };
  } catch {}

  /* ICE Candidate */
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;

    const c = event.candidate.candidate || "";
    let type = "unknown";
    if (c.includes("relay")) type = "TURN relay";
    else if (c.includes("srflx")) type = "STUN srflx";
    else if (c.includes("host")) type = "Host";

    this.onQualityChange?.("good", `Candidate: ${type}`);

    if (rtcState.peerId && this.socket) {
      this.socket.emit("webrtc:signal", {
        type: "ice",
        to: rtcState.peerId,
        from: getMyUserId(),
        candidate: event.candidate,
      });
    }
  };

  /* Remote Track */
  pc.ontrack = (event) => {
    const peerId = rtcState.peerId || "default";
    attachRemoteTrack(peerId, event);
  };

  /* ICE State */
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;

    const level =
      state === "connected"
        ? "excellent"
        : state === "checking"
        ? "fair"
        : state === "disconnected"
        ? "poor"
        : state === "failed"
        ? "bad"
        : "unknown";

    this.onQualityChange?.(level, `ICE: ${state}`);

    if (rtcState.answering) return;

    if (state === "disconnected") {
      console.warn("[WebRTC] Disconnected — applying fallback");

      try { pc.restartIce(); } catch {}

      const sender = pc.getSenders().find(s => s.track?.kind === "video");
      if (sender) {
        const params = sender.getParameters();
        params.encodings = [{
          maxBitrate: 800_000,
          minBitrate: 150_000,
          maxFramerate: 24,
        }];
        sender.setParameters(params).catch(() => {});
      }
    }

    if (state === "failed") {
      this.stopNetworkMonitor();     // 🔥 NEW
      this.onCallFailed?.("ice failed");
      this.endCall(false);
    }
  };

  /* Connection State */
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;

    if (state === "connected") {
      this.onQualityChange?.("excellent", "Connected");
      this.startNetworkMonitor();     // 🔥 NEW — start adaptive bitrate + stats
    }

    if (state === "failed" || state === "closed") {
      this.stopNetworkMonitor();      // 🔥 NEW — stop when dead
      this.onCallFailed?.("connection failed");
      this.endCall(false);
    }
  };

  /* Renegotiation (Discord-style) */
  pc.onnegotiationneeded = async () => {
    try {
      console.log("[WebRTC] Renegotiation needed");

      let offer = await pc.createOffer();

      if (offer.sdp) {
        offer.sdp = offer.sdp.replace(
          /(m=video .*?)(96 97 98)/,
          (match, prefix, list) => `${prefix}98 96 97`
        );
      }

      await pc.setLocalDescription(offer);

      this.socket.emit("webrtc:signal", {
        type: "offer",
        to: rtcState.peerId,
        from: getMyUserId(),
        offer,
        renegotiate: true,
      });
    } catch (err) {
      console.warn("[WebRTC] Renegotiation failed:", err);
    }
  };

  return pc;
}

/* ---------------------------------------------------
   Flush queued remote ICE
--------------------------------------------------- */
async _flushPendingRemoteCandidates() {
  if (!this.pc || !this.pc.remoteDescription) return;
  if (!this.pendingRemoteCandidates?.length) return;

  console.log(
    "[ICE] Flushing queued remote candidates:",
    this.pendingRemoteCandidates.length
  );

  for (const c of this.pendingRemoteCandidates) {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (err) {
      console.warn("[ICE] Error adding queued candidate:", err);
    }
  }

  this.pendingRemoteCandidates = [];
}

/* ---------------------------------------------------
   Network Monitor + Adaptive Bitrate (NEW)
--------------------------------------------------- */
startNetworkMonitor() {
  if (!this.pc) return;
  if (this._networkInterval) clearInterval(this._networkInterval);

  this._networkInterval = setInterval(async () => {
    try {
      const stats = await this.pc.getStats();
      let videoOutbound = null;
      let videoRemoteInbound = null;
      let candidatePair = null;

      stats.forEach((report) => {
        if (report.type === "outbound-rtp" && report.kind === "video" && !report.isRemote) {
          videoOutbound = report;
        }
        if (report.type === "remote-inbound-rtp" && report.kind === "video") {
          videoRemoteInbound = report;
        }
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          candidatePair = report;
        }
      });

      const videoLoss =
        videoRemoteInbound && videoRemoteInbound.packetsReceived > 0
          ? videoRemoteInbound.packetsLost / videoRemoteInbound.packetsReceived
          : 0;

      const rtt = candidatePair?.currentRoundTripTime || 0;
      const outgoingBitrate = candidatePair?.availableOutgoingBitrate || 0;

      const snapshot = { videoLoss, rtt, outgoingBitrate };
      const level = rtcState.updateFromStats(snapshot);

      this.onQualityChange?.(
        level,
        `loss=${(videoLoss * 100 || 0).toFixed(1)}% rtt=${(rtt || 0).toFixed(3)}s`
      );

      this._applyAdaptiveBitrate(level);
    } catch (err) {
      console.warn("[WebRTC] stats monitor failed", err);
    }
  }, 2000);
}

stopNetworkMonitor() {
  if (this._networkInterval) clearInterval(this._networkInterval);
  this._networkInterval = null;
}

_applyAdaptiveBitrate(level) {
  if (!this.pc) return;

  const sender = this.pc.getSenders().find(
    (s) => s.track && s.track.kind === "video"
  );
  if (!sender) return;

  const params = sender.getParameters();
  if (!params.encodings || !params.encodings.length) {
    params.encodings = [{}];
  }

  const enc = params.encodings[0];

  switch (level) {
    case "excellent":
    case "good":
      enc.maxBitrate = 1_500_000;
      enc.scaleResolutionDownBy = 1;
      break;
    case "fair":
      enc.maxBitrate = 800_000;
      enc.scaleResolutionDownBy = 1.5;
      break;
    case "poor":
      enc.maxBitrate = 400_000;
      enc.scaleResolutionDownBy = 2;
      break;
    case "bad":
      enc.maxBitrate = 200_000;
      enc.scaleResolutionDownBy = 3;
      break;
    default:
      break;
  }

  sender.setParameters(params).catch((err) => {
    console.warn("[WebRTC] adaptive bitrate setParameters failed", err);
  });
}

  /* ---------------------------------------------------
     Socket bindings
  --------------------------------------------------- */
  _bindSocketEvents() {
    if (!this.socket) {
      console.warn("[WebRTC] No socket provided");
      return;
    }

    this.socket.off("webrtc:signal");
    this.socket.off("call:voicemail");
    this.socket.off("call:restore");
    this.socket.off("call:timeout");
    this.socket.off("call:declined");
    this.socket.off("call:missed");
    this.socket.off("call:dnd");

    this.socket.on("webrtc:signal", async (data) => {
      console.log("[WebRTC] webrtc:signal received", data?.type, data);
      if (!data || !data.type) return;

      if (data.fromUser) {
        const { avatar, fullname } = data.fromUser;

        if (avatar) {
          rtcState.peerAvatar = avatar;
          setRemoteAvatar(avatar);
          showRemoteAvatar();
        }

        if (!rtcState.peerName && fullname) {
          rtcState.peerName = fullname;
        }
      }

      switch (data.type) {
        case "offer":
          await this.handleOffer(data);
          break;

        case "answer":
          await this.handleAnswer(data);
          break;

        case "ice":
          await this.handleRemoteIceCandidate(data);
          break;

        case "end":
          this.handleRemoteEnd();
          break;

        default:
          break;
      }
    });
  }
}



















































































































































