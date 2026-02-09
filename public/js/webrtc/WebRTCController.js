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

  // --- State setup ---------------------------------------------------------
  rtcState.peerId = peerId;
  rtcState.peerName = rtcState.peerName || `User ${peerId}`;
  rtcState.audioOnly = !!audioOnly;
  rtcState.isCaller = true;
  rtcState.busy = true;
  rtcState.inCall = false;
  rtcState.incomingOffer = null;
  rtcState.usedRelayFallback = !!relayOnly;

  // --- Create PeerConnection -----------------------------------------------
  const pc = await this._createPC({ relayOnly });

  // --- Acquire local media --------------------------------------------------
  const stream = await getLocalMedia(true, !audioOnly);
  this.localStream = stream;
  rtcState.localStream = stream;

  if (stream) {
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  } else {
    console.warn("[WebRTC] No local media — continuing call anyway");
  }

  // --- Notify UI ------------------------------------------------------------
  this.onOutgoingCall?.({
    targetName: rtcState.peerName,
    voiceOnly: audioOnly,
  });

  // --- Create Offer ---------------------------------------------------------
  let offer = await pc.createOffer();

  // ========================================================================
  //  DISCORD‑STYLE CODEC PRIORITY (VP9 > VP8 > H264)
  // ========================================================================
  if (offer.sdp) {
    // Reorder payload types so VP9 is first if available
    offer.sdp = offer.sdp.replace(
      /(m=video .*?)(96 97 98)/,
      (match, prefix, list) => {
        // VP9 = 98, VP8 = 96, H264 = 97
        return `${prefix}98 96 97`;
      }
    );
  }

  // Apply modified SDP
  await pc.setLocalDescription(offer);

  // ========================================================================
  //  GOOGLE MEET–STYLE BITRATE CONTROL (Stable HD, no pixelation)
  // ========================================================================
  const videoSender = pc
    .getSenders()
    .find((s) => s.track && s.track.kind === "video");

  if (videoSender) {
    const params = videoSender.getParameters();
    params.encodings = [{
      maxBitrate: 1_500_000,   // 1.5 Mbps — stable HD
      minBitrate:   300_000,   // prevents pixelation
      maxFramerate: 30,         // Meet-style stability
    }];

    try {
      await videoSender.setParameters(params);
    } catch (err) {
      console.warn("[WebRTC] setParameters failed", err);
    }
  }

  // --- Send Offer -----------------------------------------------------------
  this.socket.emit("webrtc:signal", {
    type: "offer",
    to: peerId,
    from: myId,
    offer,
    audioOnly: !!audioOnly,
    fromName: getMyFullname(),
  });

  // --- Play ringback --------------------------------------------------------
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

  // --- Create PeerConnection -----------------------------------------------
  const pc = await this._createPC({ relayOnly: false });

  // --- Apply remote offer ---------------------------------------------------
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  await this._flushPendingRemoteCandidates();

  // --- Acquire local media --------------------------------------------------
  const stream = await getLocalMedia(true, !rtcState.audioOnly);
  this.localStream = stream;
  rtcState.localStream = stream;

  if (stream) {
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  }

  // --- Create answer --------------------------------------------------------
  let answer = await pc.createAnswer();

  // ========================================================================
  //  DISCORD‑STYLE CODEC PRIORITY (VP9 > VP8 > H264)
  // ========================================================================
  if (answer.sdp) {
    answer.sdp = answer.sdp.replace(
      /(m=video .*?)(96 97 98)/,
      (match, prefix, list) => {
        return `${prefix}98 96 97`; // VP9 first
      }
    );
  }

  await pc.setLocalDescription(answer);

  // ========================================================================
  //  GOOGLE MEET–STYLE BITRATE CONTROL (Stable HD)
  // ========================================================================
  const videoSender = pc
    .getSenders()
    .find((s) => s.track && s.track.kind === "video");

  if (videoSender) {
    const params = videoSender.getParameters();
    params.encodings = [{
      maxBitrate: 1_500_000,   // 1.5 Mbps HD
      minBitrate:   300_000,   // prevents pixelation
      maxFramerate: 30,
    }];

    try {
      await videoSender.setParameters(params);
    } catch (err) {
      console.warn("[WebRTC] setParameters failed", err);
    }
  }

  // --- Send answer ----------------------------------------------------------
  this.socket.emit("webrtc:signal", {
    type: "answer",
    to: from,
    from: getMyUserId(),
    answer,
  });

  rtcState.incomingOffer = null;

  // --- Notify UI ------------------------------------------------------------
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
        frameRate: { ideal: 15, max: 30 }, // Meet-style clarity
      },
      audio: false,
    });

    const screenTrack = screenStream.getVideoTracks()[0];
    screenTrack.contentHint = "detail"; // Meet-style sharpness

    const sender = this.pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");

    if (sender) {
      await sender.replaceTrack(screenTrack);

      // Discord-style bitrate for screen share
      const params = sender.getParameters();
      params.encodings = [{
        maxBitrate: 2_500_000, // 2.5 Mbps for crisp text
        minBitrate:   500_000,
        maxFramerate: 30,
      }];
      await sender.setParameters(params);
    }

    screenTrack.onended = async () => {
      console.log("[WebRTC] Screen share stopped");

      // Restore camera
      const camStream = rtcState.localStream;
      const camTrack = camStream?.getVideoTracks()[0];

      if (camTrack && sender) {
        await sender.replaceTrack(camTrack);

        // Restore Meet-style camera bitrate
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
     Camera toggle
  --------------------------------------------------- */
  switchCamera() {
    const stream = this.localStream || rtcState.localStream;
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) return;

    const enabled = videoTracks.some((t) => t.enabled);
    videoTracks.forEach((t) => (t.enabled = !enabled));

    return enabled;
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

  /* ---------------------------------------------------
       TURN Keepalive (Meet-style stability)
  --------------------------------------------------- */
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

  /* ---------------------------------------------------
       DataChannel Keepalive (Discord-style)
  --------------------------------------------------- */
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

  /* ---------------------------------------------------
       ICE Candidate Handling
  --------------------------------------------------- */
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

  /* ---------------------------------------------------
       Remote Track Handling
  --------------------------------------------------- */
  pc.ontrack = (event) => {
    const peerId = rtcState.peerId || "default";
    attachRemoteTrack(peerId, event);
  };

  /* ---------------------------------------------------
       ICE State (Meet + Discord hybrid)
  --------------------------------------------------- */
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

    // Meet-style adaptive fallback
    if (state === "disconnected") {
      console.warn("[WebRTC] Disconnected — applying fallback");

      try { pc.restartIce(); } catch {}

      const sender = pc.getSenders().find(s => s.track?.kind === "video");
      if (sender) {
        const params = sender.getParameters();
        params.encodings = [{
          maxBitrate: 800_000,   // fallback bitrate
          minBitrate: 150_000,
          maxFramerate: 24,
        }];
        sender.setParameters(params).catch(() => {});
      }
    }

    if (state === "failed") {
      this.onCallFailed?.("ice failed");
      this.endCall(false);
    }
  };

  /* ---------------------------------------------------
       Connection State
  --------------------------------------------------- */
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;

    if (state === "connected") {
      this.onQualityChange?.("excellent", "Connected");
    }

    if (state === "failed") {
      this.onCallFailed?.("connection failed");
      this.endCall(false);
    }
  };

  /* ---------------------------------------------------
       Renegotiation (Discord-style)
  --------------------------------------------------- */
  pc.onnegotiationneeded = async () => {
    try {
      console.log("[WebRTC] Renegotiation needed");

      let offer = await pc.createOffer();

      // VP9 priority again
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

        case "busy":
          stopAudio(ringback);
          this.onCallFailed?.("busy");
          break;

        default:
          break;
      }
    });

    this.socket.on("call:restore", ({ callerId, receiverId, status }) => {
      const me = String(getMyUserId());
      const callerStr = String(callerId);
      const receiverStr = String(receiverId);

      const isCaller = me === callerStr;
      const peerId = isCaller ? receiverStr : callerStr;

      rtcState.peerId = peerId;
      rtcState.isCaller = isCaller;
      rtcState.inCall = status === "active";
      rtcState.busy = status === "active";

      if (status === "active" && isCaller) {
        this._resumeAsCallerAfterRestore(peerId);
      }
    });

    /* -------------------------------------------------------
       VOICEMAIL + SECONDARY INCOMING (CARRIER‑STYLE)
    ------------------------------------------------------- */

    const playUnreachableTone = () => {
      try {
        const tone = new Audio("uploads/audio/user_unreachable.mp3");
        tone.play().catch(() => {});
      } catch (err) {
        console.warn("[WebRTC] Unreachable tone failed:", err);
      }
    };

    const playBeepTone = () => {
      try {
        const beep = new Audio("/audio/beep.mp3");
        beep.play().catch(() => {});
      } catch (err) {
        console.warn("[WebRTC] Beep tone failed:", err);
      }
    };

    // Simple per‑caller debounce so we don’t spam toasts/voicemail
    const lastCallerEvents = new Map();
    const EVENT_DEBOUNCE_MS = 8000;

    const shouldProcessCallerEvent = (from) => {
      const now = Date.now();
      const last = lastCallerEvents.get(from) || 0;
      if (now - last < EVENT_DEBOUNCE_MS) return false;
      lastCallerEvents.set(from, now);
      return true;
    };

    const triggerVoicemailFlow = (from, message) => {
      if (!shouldProcessCallerEvent(from)) {
        console.log("[WebRTC] Skipping voicemail (debounced) for", from);
        return;
      }

      // Only allow voicemail when we’re truly free
      if (rtcState.inCall || rtcState.answering || rtcState.busy) {
        console.log(
          "[WebRTC] Ignoring voicemail flow (inCall/answering/busy)",
          { inCall: rtcState.inCall, answering: rtcState.answering, busy: rtcState.busy }
        );
        return;
      }

      stopAudio(ringback);

      playUnreachableTone();
      setTimeout(() => playBeepTone(), 1200);

      // Let UI decide how to present this (toast + recorder)
      this.onVoicemailPrompt?.({
        peerId: from,
        message,
      });
    };

    const handleSecondaryIncoming = (from, message) => {
      if (!shouldProcessCallerEvent(from)) {
        console.log("[WebRTC] Skipping secondary incoming (debounced) for", from);
        return;
      }

      const inCallOrRinging = rtcState.busy || rtcState.inCall;

      // Same peer as active call → ignore as duplicate
      if (inCallOrRinging && from === rtcState.peerId) {
        console.log("[WebRTC] Ignoring secondary from active peer", from);
        return;
      }

      // Already on a call with someone else → show secondary toast
      if (inCallOrRinging) {
        this.onSecondaryIncomingCall?.({
          fromName: rtcState.peerName || `User ${from}`,
          audioOnly: rtcState.audioOnly,
          fromId: from,
          message,
        });
        return;
      }

      // Not in call, not ringing → treat as voicemail opportunity
      triggerVoicemailFlow(from, message);
    };

    this.socket.on("call:timeout", ({ from }) => {
      handleSecondaryIncoming(from, "No answer. Leave a voicemail…");
    });

    this.socket.on("call:declined", ({ from }) => {
      handleSecondaryIncoming(from, "Call declined. Leave a voicemail…");
    });

    this.socket.on("call:missed", ({ from }) => {
      handleSecondaryIncoming(from, "Missed call. Leave a voicemail…");
    });

    this.socket.on("call:dnd", ({ from }) => {
      handleSecondaryIncoming(
        from,
        "User is in Do Not Disturb. Leave a voicemail…"
      );
    });

    this.socket.on("call:voicemail", ({ from, reason }) => {
      const msg =
        reason === "callee-dnd"
          ? "User is in Do Not Disturb. Leave a voicemail…"
          : "Leave a voicemail…";

      handleSecondaryIncoming(from, msg);
    });

    this.socket.on("disconnect", () => {
      if (rtcState.inCall) {
        this.endCall(false);
      }
    });
  }
}













































































































































