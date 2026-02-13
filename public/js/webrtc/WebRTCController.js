// public/js/webrtc/WebRTCController.js
// Pure WebRTC engine — no UI, no DOM, no tones, no avatars.
// Mesh‑ready, polite peer, adaptive bitrate, screen share, and clean lifecycle.

import { rtcState } from "./WebRTCState.js";
rtcState.answering = false;

import {
  getLocalMedia,
  attachRemoteTrack,
  cleanupMedia,
} from "./WebRTCMedia.js";

import { addCallLogEntry } from "../call-log.js";

import {
  getMyUserId,
  getMyFullname,
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

function stopAllTones() {
  // Intentionally empty in pure engine mode.
  // Higher-level UI can wire ringtone/ringback and call this if desired.
}

/* -------------------------------------------------------
   WebRTC Controller (Mesh‑ready, polite peer)
------------------------------------------------------- */

export class WebRTCController {
  constructor(socket) {
    this.socket = socket;

    // Mesh: peerId -> RTCPeerConnection
    this.pcMap = new Map();

    // Local media
    this.localStream = null;

    // Media elements (wired by CallUI via attachMediaElements)
    this.localVideo = null;
    this.remoteAudio = null;

    // Pending ICE candidates per peer
    this.pendingRemoteCandidates = new Map();

    // Network behavior + monitor
    this.networkMode = "meet";
    this._networkInterval = null;

    // Polite peer / glare handling
    this.isPolite = false;
    this.makingOffer = false;
    this.ignoreOffer = false;

    // UI callbacks (wired by CallUI)
    this.onOutgoingCall = null;
    this.onIncomingCall = null;
    this.onCallStarted = null;
    this.onCallEnded = null;
    this.onCallFailed = null;
    this.onQualityChange = null;
    this.onVoicemailPrompt = null;
    this.onScreenShareStarted = null;
    this.onScreenShareStopped = null;
    this.onLocalStream = null;

    this._bindSocketEvents();

    // Network change → ICE restart
    window.addEventListener("online", () => {
      for (const pc of this.pcMap.values()) {
        try {
          pc.restartIce();
        } catch {}
      }
    });
  }

  /* ---------------------------------------------------
     Media elements wiring
  --------------------------------------------------- */
  attachMediaElements({ localVideo, remoteAudio }) {
    if (localVideo) this.localVideo = localVideo;
    if (remoteAudio) this.remoteAudio = remoteAudio;
  }

  /* ---------------------------------------------------
     Entry points
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
     Outgoing Call
  --------------------------------------------------- */
  async _startCallInternal(peerId, audioOnly, { relayOnly }) {
    console.log("[WebRTC] _startCallInternal", { peerId, audioOnly, relayOnly });

    const myId = getMyUserId();
    if (!myId) return;

    stopAllTones();

    rtcState.peerId = peerId;
    rtcState.peerName = rtcState.peerName || `User ${peerId}`;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = true;
    rtcState.busy = true;
    rtcState.inCall = false;
    rtcState.incomingOffer = null;
    rtcState.usedRelayFallback = !!relayOnly;

    this.isPolite = false;
    this.makingOffer = false;
    this.ignoreOffer = false;

    const pc = await this._getOrCreatePC(peerId, { relayOnly });

    let stream = null;
    try {
      stream = await getLocalMedia(true, !audioOnly);
    } catch (err) {
      console.warn("[WebRTCMedia] getLocalMedia failed in _startCallInternal:", err);
    }

    this.localStream = stream;
    rtcState.localStream = stream;

    this.onLocalStream?.(stream || null);

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } else {
      console.warn("[WebRTC] No local media — continuing call anyway");
    }

    this.onOutgoingCall?.({
      targetName: rtcState.peerName,
      voiceOnly: audioOnly,
    });

    this.makingOffer = true;
    let offer = await pc.createOffer();
    this.makingOffer = false;

    if (offer.sdp) {
      offer.sdp = offer.sdp.replace(
        /(m=video .*?)(96 97 98)/,
        (match, prefix, list) => `${prefix}98 96 97`
      );
    }

    await pc.setLocalDescription(offer);

    const videoSender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");

    if (videoSender) {
      const params = videoSender.getParameters();
      params.encodings = [
        {
          maxBitrate: 1_500_000,
          minBitrate: 300_000,
          maxFramerate: 30,
        },
      ];
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
  }

  /* ---------------------------------------------------
     Resume after restore (if you ever wire it)
  --------------------------------------------------- */
  async _resumeAsCallerAfterRestore(peerId) {
    const relayOnly = !!rtcState.usedRelayFallback;
    const audioOnly = !!rtcState.audioOnly;
    await this._startCallInternal(peerId, audioOnly, { relayOnly });
  }

  /* ---------------------------------------------------
     Incoming Offer (polite peer + mesh‑ready)
  --------------------------------------------------- */
  async handleOffer(data) {
    const { from, offer, fromName, audioOnly, fromUser, renegotiate } = data || {};
    console.log("[WebRTC] handleOffer", data);
    if (!from || !offer) return;

    if (!rtcState.peerId) {
      rtcState.peerId = from;
    }

    rtcState.peerName = fromUser?.fullname || fromName || `User ${from}`;
    rtcState.peerAvatar = fromUser?.avatar || null;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;

    rtcState.busy = true;
    rtcState.inCall = false;
    rtcState.incomingOffer = data;
    rtcState.usedRelayFallback = false;

    this.isPolite = true;

    const pc = await this._getOrCreatePC(from, { relayOnly: false });

    const offerCollision =
      offer.type === "offer" &&
      (this.makingOffer || pc.signalingState !== "stable");

    this.ignoreOffer = !this.isPolite && offerCollision;
    if (this.ignoreOffer) {
      console.warn("[WebRTC] Ignoring offer due to glare (impolite side)");
      return;
    }

    if (offer.sdp) {
      offer.sdp = offer.sdp.replace(
        /(m=video .*?)(96 97 98)/,
        (match, prefix, list) => `${prefix}98 96 97`
      );
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this._flushPendingRemoteCandidates(from, pc);

    if (renegotiate) {
      console.log("[WebRTC] Renegotiation offer handled");
      const answer = await pc.createAnswer();
      if (answer.sdp) {
        answer.sdp = answer.sdp.replace(
          /(m=video .*?)(96 97 98)/,
          (match, prefix, list) => `${prefix}98 96 97`
        );
      }
      await pc.setLocalDescription(answer);

      this.socket.emit("webrtc:signal", {
        type: "answer",
        to: from,
        from: getMyUserId(),
        answer,
        renegotiate: true,
      });

      return;
    }

    stopAllTones();

    this.onIncomingCall?.({
      fromName: rtcState.peerName,
      audioOnly: rtcState.audioOnly,
    });
  }

  /* ---------------------------------------------------
     Answer Incoming Call
  --------------------------------------------------- */
  async answerIncomingCall() {
    const offerData = rtcState.incomingOffer;
    if (!offerData) return;

    const { from, offer, audioOnly } = offerData;

    rtcState.audioOnly = !!audioOnly;
    rtcState.inCall = true;
    rtcState.busy = true;
    rtcState.isCaller = false;

    stopAllTones();

    if (this.socket && from) {
      this.socket.emit("call:accept", { to: from, from: getMyUserId() });
    }

    const pc = await this._getOrCreatePC(from, { relayOnly: false });

    if (offer.sdp) {
      offer.sdp = offer.sdp.replace(
        /(m=video .*?)(96 97 98)/,
        (match, prefix, list) => `${prefix}98 96 97`
      );
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this._flushPendingRemoteCandidates(from, pc);

    let stream = null;
    try {
      stream = await getLocalMedia(true, !rtcState.audioOnly);
    } catch (err) {
      console.warn("[WebRTCMedia] getLocalMedia failed in answerIncomingCall:", err);
    }

    this.localStream = stream;
    rtcState.localStream = stream;

    this.onLocalStream?.(stream || null);

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }

    let answer = await pc.createAnswer();

    if (answer.sdp) {
      answer.sdp = answer.sdp.replace(
        /(m=video .*?)(96 97 98)/,
        (match, prefix, list) => `${prefix}98 96 97`
      );
    }

    await pc.setLocalDescription(answer);

    const videoSender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");

    if (videoSender) {
      const params = videoSender.getParameters();
      params.encodings = [
        {
          maxBitrate: 1_500_000,
          minBitrate: 300_000,
          maxFramerate: 30,
        },
      ];
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

    if (callerId && this.socket) {
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

    stopAllTones();
    this.onCallEnded?.();
  }

  /* ---------------------------------------------------
     Remote Answer
  --------------------------------------------------- */
  async handleAnswer(data) {
    if (!data?.answer) return;
    if (!rtcState.isCaller) return;

    const from = data.from;
    if (!from) return;

    const pc = this.pcMap.get(from);
    if (!pc) return;
    if (pc.signalingState !== "have-local-offer" && !data.renegotiate) return;

    rtcState.answering = true;
    setTimeout(() => (rtcState.answering = false), 800);

    if (data.answer.sdp) {
      data.answer.sdp = data.answer.sdp.replace(
        /(m=video .*?)(96 97 98)/,
        (match, prefix, list) => `${prefix}98 96 97`
      );
    }

    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    await this._flushPendingRemoteCandidates(from, pc);

    rtcState.inCall = true;
    rtcState.busy = true;

    if (this.socket) {
      this.socket.emit("call:accept", { to: from });
    }

    stopAllTones();
    this.onCallStarted?.();
  }

  /* ---------------------------------------------------
     ICE Candidate
  --------------------------------------------------- */
  async handleRemoteIceCandidate(data) {
    if (!data?.candidate) return;

    const from = data.from;
    if (!from) return;

    const pc = this.pcMap.get(from);

    if (!pc || !pc.remoteDescription) {
      const list = this.pendingRemoteCandidates.get(from) || [];
      list.push(data.candidate);
      this.pendingRemoteCandidates.set(from, list);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch {}
  }

  /* ---------------------------------------------------
     Remote End
  --------------------------------------------------- */
  handleRemoteEnd(from) {
    if (rtcState.answering) return;

    if (from && this.pcMap.has(from)) {
      const pc = this.pcMap.get(from);
      try {
        pc.close();
      } catch {}
      this.pcMap.delete(from);
      this.pendingRemoteCandidates.delete(from);
    }

    if (this.pcMap.size === 0) {
      this.endCall(false);
    }
  }

  /* ---------------------------------------------------
     End Call
  --------------------------------------------------- */
  endCall(local = true) {
    stopAllTones();

    const peerId = rtcState.peerId;

    for (const [id, pc] of this.pcMap.entries()) {
      try {
        pc.close();
      } catch {}
      this.pendingRemoteCandidates.delete(id);
    }
    this.pcMap.clear();

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
     Camera Flip
  --------------------------------------------------- */
  async switchCamera() {
    try {
      const mod = await import("./WebRTCMedia.js");
      await mod.flipLocalCamera(this);
      // CallUI expects "isCameraOff" style boolean; flipping keeps camera ON
      return false;
    } catch (err) {
      console.error("[WebRTC] switchCamera flip failed:", err);
      return false;
    }
  }

  /* ---------------------------------------------------
     Screen Share
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
      if (!screenTrack) {
        console.warn("[WebRTC] No screen track from getDisplayMedia");
        return;
      }

      try {
        screenTrack.contentHint = "detail";
      } catch {}

      const senders = [];
      for (const pc of this.pcMap.values()) {
        const sender = pc
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");
        if (sender) {
          senders.push(sender);
          await sender.replaceTrack(screenTrack);

          const params = sender.getParameters();
          params.encodings = [
            {
              maxBitrate: 2_500_000,
              minBitrate: 500_000,
              maxFramerate: 30,
            },
          ];
          await sender.setParameters(params);
        }
      }

      screenTrack.onended = async () => {
        console.log("[WebRTC] Screen share stopped");

        const camStream = rtcState.localStream;
        const camTrack = camStream?.getVideoTracks()[0];

        if (camTrack) {
          for (const sender of senders) {
            await sender.replaceTrack(camTrack);

            const params = sender.getParameters();
            params.encodings = [
              {
                maxBitrate: 1_500_000,
                minBitrate: 300_000,
                maxFramerate: 30,
              },
            ];
            await sender.setParameters(params);
          }
        }

        this.onScreenShareStopped?.(rtcState.peerId);
      };

      this.onScreenShareStarted?.(rtcState.peerId);
    } catch (err) {
      console.warn("[WebRTC] Screen share error:", err);
    }
  }

  /* ---------------------------------------------------
     Get or create PC
  --------------------------------------------------- */
  async _getOrCreatePC(peerId, { relayOnly = false } = {}) {
    if (this.pcMap.has(peerId)) {
      return this.pcMap.get(peerId);
    }

    const pc = await this._createPC(peerId, { relayOnly });
    this.pcMap.set(peerId, pc);
    return pc;
  }

  /* ---------------------------------------------------
     PeerConnection Factory
  --------------------------------------------------- */
  async _createPC(peerId, { relayOnly = false } = {}) {
    this.networkMode = this.networkMode || "meet";

    const iceServers = await getIceServers({ relayOnly });

    const config = {
      iceServers,
      iceTransportPolicy: relayOnly ? "relay" : "all",
    };

    const pc = new RTCPeerConnection(config);

    /* ---------------------------------------------------
       TURN Keep‑Alive (prevent mobile TCP timeout)
    --------------------------------------------------- */
    pc._turnKeepAlive = setInterval(() => {
      try {
        pc.getStats(null);
      } catch {}
    }, 3000);

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "closed" || pc.connectionState === "failed") {
        if (pc._turnKeepAlive) clearInterval(pc._turnKeepAlive);
      }
    });

    /* ---------------------------------------------------
       ICE Candidate Relay
    --------------------------------------------------- */
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      const c = event.candidate.candidate || "";
      let type = "unknown";
      if (c.includes("relay")) type = "TURN relay";
      else if (c.includes("srflx")) type = "STUN srflx";
      else if (c.includes("host")) type = "Host";

      this.onQualityChange?.("good", `Candidate: ${type}`);

      if (this.socket) {
        this.socket.emit("webrtc:signal", {
          type: "ice",
          to: peerId,
          from: getMyUserId(),
          candidate: event.candidate,
        });
      }
    };

    /* ---------------------------------------------------
       Track Routing (single source of truth)
    --------------------------------------------------- */
    pc.ontrack = (event) => {
      const id = peerId || rtcState.peerId || "default";
      attachRemoteTrack(id, event);
    };

    /* ---------------------------------------------------
       ICE State
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

      if (this.networkMode === "discord" && state === "checking") {
        this.startNetworkMonitor();
      }

      if (rtcState.answering) return;

      if (state === "disconnected") {
        console.warn("[WebRTC] Disconnected — applying fallback");

        if (!pc._iceRestarted) {
          pc._iceRestarted = true;
          try {
            pc.restartIce();
          } catch {}
          setTimeout(() => (pc._iceRestarted = false), 4000);
        }

        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          const params = sender.getParameters();
          params.encodings = [
            {
              maxBitrate: 800_000,
              minBitrate: 150_000,
              maxFramerate: 24,
            },
          ];
          sender.setParameters(params).catch(() => {});
        }
      }

      if (state === "failed") {
        this.stopNetworkMonitor();
        this.onCallFailed?.("ice failed");
        this.handleRemoteEnd(peerId);
      }
    };

    /* ---------------------------------------------------
       Connection State
    --------------------------------------------------- */
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      if (state === "connected") {
        this.onQualityChange?.("excellent", "Connected");

        if (this.networkMode === "meet") {
          this.startNetworkMonitor();
        }
      }

      if (state === "failed" || state === "closed") {
        this.stopNetworkMonitor();
        this.onCallFailed?.("connection failed");
        this.handleRemoteEnd(peerId);
      }
    };

    /* ---------------------------------------------------
       Renegotiation
    --------------------------------------------------- */
    pc.onnegotiationneeded = async () => {
      if (this.makingOffer) {
        console.warn("[WebRTC] Skipping renegotiation — already making offer");
        return;
      }

      try {
        console.log("[WebRTC] Renegotiation needed for", peerId);

        this.makingOffer = true;
        let offer = await pc.createOffer();
        this.makingOffer = false;

        if (offer.sdp) {
          offer.sdp = offer.sdp.replace(
            /(m=video .*?)(96 97 98)/,
            (match, prefix, list) => `${prefix}98 96 97`
          );
        }

        await pc.setLocalDescription(offer);

        this.socket.emit("webrtc:signal", {
          type: "offer",
          to: peerId,
          from: getMyUserId(),
          offer,
          renegotiate: true,
        });
      } catch (err) {
        this.makingOffer = false;
        console.warn("[WebRTC] Renegotiation failed:", err);
      }
    };

    return pc;
  }

  /* ---------------------------------------------------
     Flush queued remote ICE
  --------------------------------------------------- */
  async _flushPendingRemoteCandidates(peerId, pc) {
    if (!pc || !pc.remoteDescription) return;

    const list = this.pendingRemoteCandidates.get(peerId);
    if (!list || !list.length) return;

    console.log(
      "[ICE] Flushing queued remote candidates for",
      peerId,
      "count=",
      list.length
    );

    for (const c of list) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("[ICE] Error adding queued candidate:", err);
      }
    }

    this.pendingRemoteCandidates.delete(peerId);
  }

  /* ---------------------------------------------------
     Network Monitor + Adaptive Bitrate
  --------------------------------------------------- */
  _getPrimaryPC() {
    const primaryId =
      rtcState.peerId || (this.pcMap.size ? [...this.pcMap.keys()][0] : null);
    if (!primaryId) return null;
    return this.pcMap.get(primaryId) || null;
  }

  startNetworkMonitor() {
    const pc = this._getPrimaryPC();
    if (!pc) return;
    if (this._networkInterval) clearInterval(this._networkInterval);

    this._networkInterval = setInterval(async () => {
      try {
        const stats = await pc.getStats();
        let videoRemoteInbound = null;
        let candidatePair = null;

        stats.forEach((report) => {
          if (report.type === "remote-inbound-rtp" && report.kind === "video") {
            videoRemoteInbound = report;
          }
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            candidatePair = report;
          }
        });

        const videoLoss =
          videoRemoteInbound && videoRemoteInbound.packetsReceived > 0
            ? videoRemoteInbound.packetsLost /
              videoRemoteInbound.packetsReceived
            : 0;

        const rtt = candidatePair?.currentRoundTripTime || 0;
        const outgoingBitrate = candidatePair?.availableOutgoingBitrate || 0;

        const snapshot = { videoLoss, rtt, outgoingBitrate };
        const level = rtcState.updateFromStats(snapshot);

        this.onQualityChange?.(
          level,
          `loss=${(videoLoss * 100 || 0).toFixed(1)}% rtt=${(rtt || 0).toFixed(
            3
          )}s`
        );

        this._applyAdaptiveBitrate(pc, level);
      } catch (err) {
        console.warn("[WebRTC] stats monitor failed", err);
      }
    }, 2000);
  }

  stopNetworkMonitor() {
    if (this._networkInterval) clearInterval(this._networkInterval);
    this._networkInterval = null;
  }

  _applyAdaptiveBitrate(pc, level) {
    if (!pc) return;

    const sender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");
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
     Socket bindings (Mesh‑aware)
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
    this.socket.off("call:accept");

    this.socket.on("webrtc:signal", async (data) => {
      console.log("[WebRTC] webrtc:signal received", data?.type, data);
      if (!data || !data.type) return;

      if (data.fromUser) {
        const { avatar, fullname } = data.fromUser;

        if (avatar) {
          rtcState.peerAvatar = avatar;
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
          this.handleRemoteEnd(data.from);
          break;

        default:
          break;
      }
    });

    this.socket.on("call:accept", ({ from }) => {
      console.log("[WebRTC] call accepted by", from);
      stopAllTones();
      rtcState.inCall = true;
      rtcState.busy = true;
      this.onCallStarted?.();
    });

    this.socket.on("call:timeout", ({ from }) => {
      console.log("[WebRTC] call timeout from", from);
      stopAllTones();
    });

    this.socket.on("call:declined", ({ from }) => {
      console.log("[WebRTC] call declined by", from);
      stopAllTones();
    });

    this.socket.on("call:voicemail", ({ from, reason }) => {
      console.log("[WebRTC] voicemail event", from, reason);
      stopAllTones();
      // Normalize to the shape CallUI expects: { peerId, message }
      this.onVoicemailPrompt?.({
        peerId: from,
        message: reason,
      });
    });

    this.socket.on("call:missed", ({ from }) => {
      console.log("[WebRTC] call missed from", from);
      stopAllTones();
    });

    this.socket.on("call:dnd", ({ from }) => {
      console.log("[WebRTC] call dnd from", from);
      stopAllTones();
    });
  }
}




















































































































































































