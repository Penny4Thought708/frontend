// public/js/webrtc/WebRTCController.js
// Mesh‑ready WebRTC controller aligned with:
// - node-backend/src/sockets/webrtc.js (webrtc:signal + call:* events)
// - WebRTCMedia.js (getLocalMedia, attachRemoteTrack, cleanupMedia)
// - Aurora‑Orbit CallUI.js (attachMediaElements, on* callbacks, answer/decline)

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

/* Ensure tones loop */
if (ringtone) ringtone.loop = true;
if (ringback) ringback.loop = true;

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
  stopAudio(ringtone);
  stopAudio(ringback);
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

    // Media elements
    this.localVideo = null;
    this.remoteAudio =
      remoteAudioEl || document.getElementById("remoteAudio");
    if (!this.remoteAudio) {
      console.warn("[WebRTC] remoteAudio element not found");
    }

    // Pending ICE candidates per peer
    this.pendingRemoteCandidates = new Map();

    // Network behavior + monitor
    this.networkMode = "meet";
    this._networkInterval = null;

    // Polite peer / glare handling
    this.isPolite = false;
    this.makingOffer = false;
    this.ignoreOffer = false;

    // Current call state
    this.currentPeerId = null;
    this.audioOnly = false;
    this.incomingOffer = null;
    this.inCall = false;
    this.isCaller = false;

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
    this.onRemoteCameraOff = null;
    this.onRemoteCameraOn = null;
    this.onRemoteSpeaking = null;
    this.onNoiseSuppressionChanged = null;
    this.onRecordingChanged = null;
    this.onSecondaryIncomingCall = null;

    // Mute state
    this._muted = false;

    this._bindSocketEvents();

    // Wire call buttons (desktop entry points)
    const voiceBtn = getVoiceBtn?.();
    const videoBtn = getVideoBtn?.();

    if (voiceBtn) {
      voiceBtn.onclick = () => {
        const peerId = getReceiver?.();
        if (!peerId) {
          console.warn("[WebRTC] Voice call attempted with no receiver");
          return;
        }
        this.startCall(peerId, true);
      };
    }

    if (videoBtn) {
      videoBtn.onclick = () => {
        const peerId = getReceiver?.();
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
      for (const pc of this.pcMap.values()) {
        try {
          pc.restartIce();
        } catch {}
      }
    });
  }

  /* ---------------------------------------------------
     Media elements wiring (CallUI)
  --------------------------------------------------- */
  attachMediaElements({ localVideo, remoteAudio }) {
    if (localVideo) this.localVideo = localVideo;
    if (remoteAudio) this.remoteAudio = remoteAudio;
  }

  /* ---------------------------------------------------
     Public entry points (used by CallUI/session)
  --------------------------------------------------- */
  startVoiceCall() {
    const peerId = getReceiver?.();
    if (!peerId) return;
    this.startCall(peerId, true);
  }

  startVideoCall() {
    const peerId = getReceiver?.();
    if (!peerId) return;
    this.startCall(peerId, false);
  }

  async startCall(peerId, audioOnly) {
    return this._startCallInternal(String(peerId), !!audioOnly, {
      relayOnly: false,
    });
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

    this.currentPeerId = peerId;
    this.audioOnly = !!audioOnly;
    this.isCaller = true;
    this.inCall = false;
    this.incomingOffer = null;

    this.isPolite = false;
    this.makingOffer = false;
    this.ignoreOffer = false;

    const pc = await this._getOrCreatePC(peerId, { relayOnly });

    const stream = await getLocalMedia(true, !audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    if (this.onLocalStream) {
      this.onLocalStream(stream);
    } else {
      this._bindLocalPreview(stream);
    }

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

    // Prefer H.264/VP9 ordering if present
    if (offer.sdp) {
      offer.sdp = offer.sdp.replace(
        /(m=video .*?)(96 97 98)/,
        (match, prefix, list) => `${prefix}98 96 97`
      );
    }

    await pc.setLocalDescription(offer);

    // Basic bitrate tuning
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

    // Ringback for caller
    try {
      if (ringback) ringback.play().catch(() => {});
    } catch {}
  }

  /* ---------------------------------------------------
     Incoming Call: answer / decline (CallUI)
  --------------------------------------------------- */
  async answerIncomingCall() {
    const myId = getMyUserId();
    const peerId = this.currentPeerId || rtcState.peerId;
    if (!myId || !peerId) {
      console.warn("[WebRTC] answerIncomingCall with no peer");
      return;
    }

    if (!this.incomingOffer) {
      console.warn("[WebRTC] No stored incoming offer");
      return;
    }

    stopAllTones();
    rtcState.answering = true;

    const pc = await this._getOrCreatePC(peerId, { relayOnly: false });

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription(this.incomingOffer.offer)
      );
    } catch (err) {
      console.error("[WebRTC] Failed to setRemoteDescription on answer:", err);
      this._failCall("Failed to answer");
      return;
    }

    const stream = await getLocalMedia(true, !this.incomingOffer.audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    if (this.onLocalStream) {
      this.onLocalStream(stream);
    } else {
      this._bindLocalPreview(stream);
    }

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.socket.emit("webrtc:signal", {
      type: "answer",
      to: peerId,
      from: myId,
      answer,
    });

    // Explicit backend accept path (matches node-backend call:accept)
    this.socket.emit("call:accept", { to: peerId });

    this.inCall = true;
    rtcState.inCall = true;
    rtcState.busy = true;

    this.onCallStarted?.();

    // Flush any queued ICE
    await this._flushPendingRemoteCandidates(peerId, pc);
  }

  declineIncomingCall() {
    const myId = getMyUserId();
    const peerId = this.currentPeerId || rtcState.peerId;
    if (!myId || !peerId) return;

    stopAllTones();

    this.socket.emit("call:decline", { to: peerId });

    this._endCallInternal("declined", true);
  }

  /* ---------------------------------------------------
     End Call (local hangup)
  --------------------------------------------------- */
  endCall(localOnly = false) {
    const myId = getMyUserId();
    const peerId = this.currentPeerId || rtcState.peerId;
    if (!myId || !peerId) {
      this._endCallInternal("ended", true);
      return;
    }

    stopAllTones();

    if (!localOnly) {
      this.socket.emit("webrtc:signal", {
        type: "end",
        to: peerId,
        from: myId,
        reason: "hangup",
      });
    }

    this._endCallInternal("ended", true);
  }

  /* ---------------------------------------------------
     Mute toggle (CallUI)
  --------------------------------------------------- */
  toggleMute() {
    this._muted = !this._muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => {
        t.enabled = !this._muted;
      });
    }
    return this._muted;
  }

  /* ---------------------------------------------------
     Screen share hooks (used by CallUI)
  --------------------------------------------------- */
  async startScreenShare() {
    const peerId = this.currentPeerId || rtcState.peerId;
    if (!peerId) return;

    const pc = this.pcMap.get(peerId);
    if (!pc) return;

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        console.warn("[WebRTC] getDisplayMedia not supported");
        return;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      if (!track) return;

      const sender = pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");

      if (sender) {
        await sender.replaceTrack(track);
      }

      track.onended = () => this.stopScreenShare();

      this.onScreenShareStarted?.(peerId);
    } catch (err) {
      console.error("[WebRTC] Screen share failed:", err);
    }
  }

  async stopScreenShare() {
    const peerId = this.currentPeerId || rtcState.peerId;
    if (!peerId) return;

    const pc = this.pcMap.get(peerId);
    if (!pc) return;

    try {
      const camTrack = this.localStream?.getVideoTracks()[0];
      const sender = pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");

      if (sender && camTrack) {
        await sender.replaceTrack(camTrack);
      }

      this.onScreenShareStopped?.(peerId);
    } catch (err) {
      console.error("[WebRTC] stopScreenShare failed:", err);
    }
  }

  /* ---------------------------------------------------
     Core PC creation
  --------------------------------------------------- */
  async _getOrCreatePC(peerId, { relayOnly }) {
    if (this.pcMap.has(peerId)) return this.pcMap.get(peerId);

    const iceServers = await getIceServers?.(relayOnly);
    const pc = new RTCPeerConnection({
      iceServers: iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
      iceCandidatePoolSize: 4,
    });

    this.pcMap.set(peerId, pc);

    pc.onicecandidate = (evt) => {
      if (!evt.candidate) return;
      const myId = getMyUserId();
      if (!myId) return;

      this.socket.emit("webrtc:signal", {
        type: "ice",
        to: peerId,
        from: myId,
        candidate: evt.candidate,
      });
    };

    pc.ontrack = (evt) => {
      attachRemoteTrack(peerId, evt);
      setRemoteAvatar(peerId);
      showRemoteAvatar(peerId);
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log("[WebRTC] ICE state", peerId, state);

      if (state === "connected" || state === "completed") {
        this._onCallConnected(peerId);
      }

      if (state === "failed" || state === "disconnected") {
        // Let backend end logic drive voicemail/missed; we just clean up
        this._endCallInternal("failed", true);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("[WebRTC] connectionState", peerId, state);
      if (state === "failed") {
        this._failCall("Connection failed");
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        if (this.makingOffer) return;
        this.makingOffer = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.makingOffer = false;

        const myId = getMyUserId();
        if (!myId) return;

        this.socket.emit("webrtc:signal", {
          type: "offer",
          to: peerId,
          from: myId,
          offer,
          audioOnly: this.audioOnly,
          renegotiate: true,
        });
      } catch (err) {
        console.error("[WebRTC] renegotiation failed:", err);
        this.makingOffer = false;
      }
    };

    return pc;
  }

  /* ---------------------------------------------------
     Socket wiring (webrtc:signal + call:* events)
  --------------------------------------------------- */
  _bindSocketEvents() {
    if (!this.socket) return;

    this.socket.on("webrtc:signal", (data) => {
      console.log("[WebRTC] webrtc:signal received", data);
      this._handleSignal(data);
    });

    // Backend explicit accept (from node-backend call:accept)
    this.socket.on("call:accept", ({ from }) => {
      console.log("[WebRTC] call:accept from", from);
      if (String(from) !== String(this.currentPeerId)) return;

      stopAllTones();
      this.inCall = true;
      rtcState.inCall = true;
      rtcState.busy = true;

      this.onCallStarted?.();
    });

    this.socket.on("call:timeout", ({ from }) => {
      console.log("[WebRTC] call:timeout from", from);
      if (String(from) !== String(this.currentPeerId)) return;
      this._failCall("Call timed out");
    });

    this.socket.on("call:missed", ({ from }) => {
      console.log("[WebRTC] call:missed from", from);
      if (String(from) !== String(this.currentPeerId)) return;
      this._failCall("Missed call");
    });

    this.socket.on("call:declined", ({ from }) => {
      console.log("[WebRTC] call:declined from", from);
      if (String(from) !== String(this.currentPeerId)) return;
      this._failCall("Call declined");
    });

    this.socket.on("call:dnd", ({ from }) => {
      console.log("[WebRTC] call:dnd from", from);
      if (String(from) !== String(this.currentPeerId)) return;
      this._failCall("User in Do Not Disturb");
    });

    this.socket.on("call:voicemail", (data) => {
      console.log("[WebRTC] call:voicemail", data);
      if (!this.onVoicemailPrompt) return;

      this.onVoicemailPrompt({
        peerId: this.currentPeerId,
        message: this._voicemailMessageFromReason(data.reason),
      });
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

  /* ---------------------------------------------------
     Handle incoming webrtc:signal
  --------------------------------------------------- */
  async _handleSignal(data) {
    const { type, from, offer, answer, candidate, audioOnly, renegotiate } =
      data || {};
    const myId = getMyUserId();
    const peerId = String(from);

    if (!type || !peerId || String(peerId) === String(myId)) return;

    switch (type) {
      case "offer":
        await this._handleOffer(peerId, offer, {
          audioOnly: !!audioOnly,
          renegotiate: !!renegotiate,
          raw: data,
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
        console.warn("[WebRTC] Unknown signal type", type);
    }
  }

  /* ---------------------------------------------------
     OFFER
  --------------------------------------------------- */
  async _handleOffer(peerId, offer, { audioOnly, renegotiate, raw }) {
    const myId = getMyUserId();
    if (!myId) return;

    const pc = await this._getOrCreatePC(peerId, { relayOnly: false });

    const offerCollision =
      offer &&
      (this.makingOffer || pc.signalingState !== "stable");

    this.isPolite = String(peerId) > String(myId);

    if (offerCollision) {
      const ignore = !this.isPolite;
      this.ignoreOffer = ignore;
      if (ignore) {
        console.log("[WebRTC] Ignoring offer (glare, impolite)");
        return;
      }
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
    } catch (err) {
      console.error("[WebRTC] Failed to setRemoteDescription on offer:", err);
      return;
    }

    await this._flushPendingRemoteCandidates(peerId, pc);

    if (renegotiate) {
      // No UI change; just complete negotiation
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.emit("webrtc:signal", {
        type: "answer",
        to: peerId,
        from: myId,
        answer,
      });
      return;
    }

    // New incoming call
    this.currentPeerId = peerId;
    this.audioOnly = !!audioOnly;
    this.isCaller = false;
    this.inCall = false;
    this.incomingOffer = { offer, audioOnly };

    rtcState.peerId = peerId;
    rtcState.peerName = raw?.fromName || `User ${peerId}`;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;
    rtcState.busy = true;
    rtcState.inCall = false;
    rtcState.incomingOffer = offer;

    setRemoteAvatar(peerId);
    showRemoteAvatar(peerId);

    this.onIncomingCall?.({
      fromName: rtcState.peerName,
      audioOnly: !!audioOnly,
    });

    // Play ringtone
    try {
      if (ringtone) ringtone.play().catch(() => {});
    } catch {}
  }

  /* ---------------------------------------------------
     ANSWER
  --------------------------------------------------- */
  async _handleAnswer(peerId, answer) {
    const pc = this.pcMap.get(peerId);
    if (!pc) {
      console.warn("[WebRTC] answer for unknown PC", peerId);
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await this._flushPendingRemoteCandidates(peerId, pc);
    } catch (err) {
      console.error("[WebRTC] Failed to handle answer:", err);
      this._failCall("Failed to handle answer");
    }
  }

  /* ---------------------------------------------------
     ICE
  --------------------------------------------------- */
  async _handleRemoteIce(peerId, candidate) {
    if (!candidate) return;

    const pc = this.pcMap.get(peerId);
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
      console.error("[WebRTC] addIceCandidate failed:", err);
    }
  }

  /* ---------------------------------------------------
     Flush queued ICE
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

    for (const cand of list) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.error("[WebRTC] addIceCandidate (queued) failed:", err);
      }
    }

    this.pendingRemoteCandidates.delete(peerId);
  }

  /* ---------------------------------------------------
     Remote END
  --------------------------------------------------- */
  _handleRemoteEnd(peerId, reason) {
    if (String(peerId) !== String(this.currentPeerId)) return;

    console.log("[WebRTC] Remote ended call", peerId, reason);
    this._endCallInternal(reason || "remote-ended", false);
  }

  /* ---------------------------------------------------
     Call connected
  --------------------------------------------------- */
  _onCallConnected(peerId) {
    stopAllTones();

    this.inCall = true;
    rtcState.inCall = true;
    rtcState.busy = true;

    this.onCallStarted?.();

    addCallLogEntry?.({
      peerId,
      direction: this.isCaller ? "outgoing" : "incoming",
      audioOnly: this.audioOnly,
      result: "connected",
      timestamp: Date.now(),
    });

    this._startNetworkMonitor(peerId);
  }

  /* ---------------------------------------------------
     End call + cleanup
  --------------------------------------------------- */
  _endCallInternal(reason = "ended", fireCallbacks = true) {
    console.log("[WebRTC] _endCallInternal", reason);

    stopAllTones();

    if (this._networkInterval) {
      clearInterval(this._networkInterval);
      this._networkInterval = null;
    }

    for (const pc of this.pcMap.values()) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;
        pc.onnegotiationneeded = null;
        pc.close();
      } catch {}
    }
    this.pcMap.clear();

    cleanupMedia();
    this.localStream = null;

    this.pendingRemoteCandidates.clear();

    rtcState.inCall = false;
    rtcState.busy = false;
    rtcState.peerId = null;
    rtcState.peerName = null;
    rtcState.audioOnly = false;
    rtcState.incomingOffer = null;

    this.currentPeerId = null;
    this.audioOnly = false;
    this.incomingOffer = null;
    this.inCall = false;
    this.isCaller = false;

    if (!fireCallbacks) {
      if (this.onCallEnded) this.onCallEnded();
      return;
    }

    if (
      reason === "failed" ||
      reason === "timeout" ||
      reason === "declined" ||
      reason === "missed"
    ) {
      this.onCallFailed?.(reason);
    } else {
      this.onCallEnded?.();
    }
  }

  _failCall(reason) {
    console.warn("[WebRTC] Call failed:", reason);
    this._endCallInternal("failed", true);
  }

  /* ---------------------------------------------------
     Local preview binding
  --------------------------------------------------- */
  _bindLocalPreview(stream) {
    if (!this.localVideo || !stream) return;

    this.localVideo.srcObject = stream;
    this.localVideo.muted = true;
    this.localVideo.playsInline = true;
    this.localVideo.classList.add("show");
    this.localVideo.style.display = "block";
    this.localVideo.style.opacity = "1";

    this.localVideo.play().catch((err) => {
      console.warn("[WebRTC] Local video play blocked:", err);
    });
  }

  /* ---------------------------------------------------
     Network / quality monitor
  --------------------------------------------------- */
  _startNetworkMonitor(peerId) {
    const pc = this.pcMap.get(peerId);
    if (!pc) return;

    if (this._networkInterval) clearInterval(this._networkInterval);

    this._networkInterval = setInterval(async () => {
      try {
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

        this.onQualityChange?.(level, text);
      } catch (err) {
        console.warn("[WebRTC] Stats monitor error:", err);
      }
    }, 3000);
  }
}

export function createWebRTCController(socket) {
  return new WebRTCController(socket);
}





































































































































































