// public/js/webrtc/WebRTCController.js
// Mesh‑ready WebRTC controller aligned with Aurora‑Orbit CallUI,
// pure WebRTCMedia, and tile‑only RemoteParticipants.

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

import {
  attachStream as attachParticipantStream,
} from "./RemoteParticipants.js";

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

    // Local / remote media
    this.localStream = null;
    this.remoteStream = null;

    // DOM media elements (wired by CallUI)
    this.localVideo = null;
    this.remoteAudio = remoteAudioEl || document.getElementById("remoteAudio");
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

    // Call identity
    this.localPeerId = getMyUserId();
    this.currentPeerId = null;

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

    this._bindSocketEvents();

    // Wire call buttons
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
     Media elements wiring (called by CallUI)
  --------------------------------------------------- */
  attachMediaElements({ localVideo, remoteAudio }) {
    if (localVideo) this.localVideo = localVideo;
    if (remoteAudio) this.remoteAudio = remoteAudio;
  }

  /* ---------------------------------------------------
     Public entry points (used by CallUI)
  --------------------------------------------------- */
  startVoiceCall() {
    const peerId = getReceiver?.();
    if (!peerId) return;
    this._startCallInternal(peerId, true, { relayOnly: false });
  }

  startVideoCall() {
    const peerId = getReceiver?.();
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

    this.currentPeerId = peerId;
    this.isPolite = false; // caller is impolite
    this.makingOffer = false;
    this.ignoreOffer = false;

    const pc = await this._getOrCreatePC(peerId, { relayOnly });

    const stream = await getLocalMedia(true, !audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    this.onLocalStream?.(stream);

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } else {
      console.warn("[WebRTC] No local media — continuing call anyway");
    }

    this.onOutgoingCall?.({
      targetName: rtcState.peerName,
      voiceOnly: audioOnly,
    });

    // Ringback tone for caller
    try {
      if (ringback) ringback.play().catch(() => {});
    } catch {}

    this.makingOffer = true;
    let offer = await pc.createOffer();
    this.makingOffer = false;

    // SDP tweak: prefer higher quality video payload
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
      fromName: getMyFullname?.(),
    });
  }

  /* ---------------------------------------------------
     Answer / Decline (called by CallUI)
  --------------------------------------------------- */
  async answerIncomingCall() {
    if (!rtcState.incomingOffer) {
      console.warn("[WebRTC] answerIncomingCall with no incomingOffer");
      return;
    }
    if (rtcState.answering) return;
    rtcState.answering = true;

    const { from, offer, audioOnly } = rtcState.incomingOffer;
    const peerId = from;
    this.currentPeerId = peerId;

    const pc = await this._getOrCreatePC(peerId, {
      relayOnly: rtcState.usedRelayFallback,
    });

    const stream = await getLocalMedia(true, !audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;

    this.onLocalStream?.(stream);

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this._flushPendingCandidates(peerId, pc);

    this.socket.emit("webrtc:signal", {
      type: "answer",
      to: peerId,
      from: this.localPeerId,
      answer,
    });

    this.socket.emit("call:accept", { to: peerId });

    stopAudio(ringtone);

    rtcState.incomingOffer = null;
    rtcState.inCall = true;
    rtcState.busy = true;
    rtcState.answering = false;
  }

  declineIncomingCall() {
    if (!rtcState.incomingOffer) return;
    const { from } = rtcState.incomingOffer;
    this.socket.emit("call:decline", { to: from });

    stopAudio(ringtone);
    rtcState.incomingOffer = null;
    rtcState.busy = false;
    rtcState.inCall = false;

    this._endCallInternal(false, "declined");
  }

  /* ---------------------------------------------------
     End Call (called by CallUI)
  --------------------------------------------------- */
  endCall(localHangup = true) {
    if (!this.currentPeerId) {
      this._endCallInternal(localHangup, "no-peer");
      return;
    }

    const peerId = this.currentPeerId;

    this.socket.emit("webrtc:signal", {
      type: "end",
      to: peerId,
      from: this.localPeerId,
    });

    this._endCallInternal(localHangup, "ended");
  }

  _endCallInternal(localHangup, reason) {
    stopAllTones();
    this._stopNetworkMonitor();

    for (const [peerId, pc] of this.pcMap.entries()) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      } catch {}
      this.pcMap.delete(peerId);
    }

    cleanupMedia();

    this.localStream = null;
    this.remoteStream = null;

    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }

    rtcState.busy = false;
    rtcState.inCall = false;
    rtcState.incomingOffer = null;
    this.currentPeerId = null;

    if (localHangup) {
      this.onCallEnded?.();
    } else if (reason && reason !== "ended") {
      this.onCallFailed?.(reason);
    }

    try {
      addCallLogEntry?.({
        peerId: rtcState.peerId,
        direction: rtcState.isCaller ? "outgoing" : "incoming",
        result: reason || "ended",
        timestamp: Date.now(),
      });
    } catch {}
  }

  /* ---------------------------------------------------
     Mute toggle (used by CallUI)
  --------------------------------------------------- */
  toggleMute() {
    if (!this.localStream) return false;
    let muted = true;
    this.localStream.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
      if (t.enabled) muted = false;
    });
    return muted;
  }

  /* ---------------------------------------------------
     Socket wiring
  --------------------------------------------------- */
  _bindSocketEvents() {
    if (!this.socket) return;

    this.socket.on("webrtc:signal", async (msg = {}) => {
      const { type } = msg;
      if (!type) return;

      switch (type) {
        case "offer":
          await this._handleOffer(msg);
          break;
        case "answer":
          await this._handleAnswer(msg);
          break;
        case "candidate":
          await this._handleCandidate(msg);
          break;
        case "end":
          this._handleRemoteEnd(msg);
          break;
        default:
          console.log("[WebRTC] Unknown signal type:", type);
      }
    });

    this.socket.on("call:timeout", ({ from } = {}) => {
      if (from && from === rtcState.peerId) {
        this.onCallFailed?.("timeout");
        this._endCallInternal(false, "timeout");
      }
    });

    this.socket.on("call:dnd", ({ from } = {}) => {
      if (from && from === rtcState.peerId) {
        this.onCallFailed?.("dnd");
      }
    });

    this.socket.on("call:voicemail", (data = {}) => {
      const { from, reason } = data;
      if (from && from === rtcState.peerId) {
        this.onVoicemailPrompt?.({
          peerId: from,
          reason: reason || "unavailable",
          message: "User unavailable",
        });
      }
    });

    this.socket.on("call:missed", ({ from } = {}) => {
      if (from && from === rtcState.peerId) {
        this.onCallFailed?.("missed");
        this._endCallInternal(false, "missed");
      }
    });

    this.socket.on("call:declined", ({ from } = {}) => {
      if (from && from === rtcState.peerId) {
        this.onCallFailed?.("declined");
        this._endCallInternal(false, "declined");
      }
    });

    this.socket.on("call:accept", ({ from } = {}) => {
      if (from && from === rtcState.peerId) {
        stopAllTones();
        if (!rtcState.inCall) {
          rtcState.inCall = true;
          this.onCallStarted?.();
          this._startNetworkMonitor();
        }
      }
    });
  }

  /* ---------------------------------------------------
     Offer handling (Primary‑device mode)
  --------------------------------------------------- */
  async _handleOffer(msg) {
    const { from, offer, audioOnly, fromName } = msg;
    if (!from || !offer) return;

    if (rtcState.busy || rtcState.inCall || rtcState.incomingOffer) {
      console.log("[WebRTC] Secondary device received offer — auto‑decline");
      this.socket.emit("call:decline", { to: from });
      return;
    }

    rtcState.peerId = from;
    rtcState.peerName = fromName || `User ${from}`;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;
    rtcState.busy = true;
    rtcState.inCall = false;
    rtcState.incomingOffer = { from, offer, audioOnly };

    this.currentPeerId = from;
    this.isPolite = true;
    this.makingOffer = false;
    this.ignoreOffer = false;

    try {
      if (ringtone) ringtone.play().catch(() => {});
    } catch {}

    this.onIncomingCall?.({
      fromName: rtcState.peerName,
      audioOnly: !!audioOnly,
    });

    await this._getOrCreatePC(from, { relayOnly: rtcState.usedRelayFallback });
  }

  /* ---------------------------------------------------
     Answer handling
  --------------------------------------------------- */
  async _handleAnswer(msg) {
    const { from, answer } = msg;
    if (!from || !answer) return;

    const pc = this.pcMap.get(from);
    if (!pc) {
      console.warn("[WebRTC] Answer for unknown peer", from);
      return;
    }

    try {
      await pc.setRemoteDescription(answer);
    } catch (err) {
      console.error("[WebRTC] setRemoteDescription(answer) failed", err);
      return;
    }

    this._flushPendingCandidates(from, pc);

    stopAllTones();

    if (!rtcState.inCall) {
      rtcState.inCall = true;
      this.onCallStarted?.();
      this._startNetworkMonitor();
    }
  }

  /* ---------------------------------------------------
     ICE candidate handling
  --------------------------------------------------- */
  async _handleCandidate(msg) {
    const { from, candidate } = msg;
    if (!from || !candidate) return;

    const pc = this.pcMap.get(from);
    if (!pc || pc.remoteDescription == null) {
      if (!this.pendingRemoteCandidates.has(from)) {
        this.pendingRemoteCandidates.set(from, []);
      }
      this.pendingRemoteCandidates.get(from).push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.error("[WebRTC] addIceCandidate failed", err);
    }
  }

  _flushPendingCandidates(peerId, pc) {
    const list = this.pendingRemoteCandidates.get(peerId);
    if (!list || !list.length) return;
    this.pendingRemoteCandidates.delete(peerId);

    list.forEach(async (cand) => {
      try {
        await pc.addIceCandidate(cand);
      } catch (err) {
        console.error("[WebRTC] addIceCandidate (flush) failed", err);
      }
    });
  }

  /* ---------------------------------------------------
     Remote end handling
  --------------------------------------------------- */
  _handleRemoteEnd(msg) {
    const { from } = msg || {};
    if (!from || from !== rtcState.peerId) return;

    this._endCallInternal(false, "remote-end");
  }

  /* ---------------------------------------------------
     PC creation / wiring
  --------------------------------------------------- */
  async _getOrCreatePC(peerId, { relayOnly }) {
    let pc = this.pcMap.get(peerId);
    if (pc) return pc;

    const iceServers = (await getIceServers?.(relayOnly)) || [];

    pc = new RTCPeerConnection({ iceServers });

    this.pcMap.set(peerId, pc);
    this.currentPeerId = peerId;
    this.peerConnection = pc; // primary PC for stats

    pc.onicecandidate = (evt) => {
      if (!evt.candidate) return;
      this.socket.emit("webrtc:signal", {
        type: "candidate",
        to: peerId,
        from: this.localPeerId,
        candidate: evt.candidate,
      });
    };

    pc.ontrack = (evt) => {
      const remoteStream = attachRemoteTrack(peerId, evt);
      if (remoteStream) {
        this.remoteStream = remoteStream;
        attachParticipantStream(peerId, remoteStream);
      }

      if (this.remoteAudio && this.remoteStream) {
        this.remoteAudio.srcObject = this.remoteStream;
        this.remoteAudio.playsInline = true;
        this.remoteAudio.muted = false;
        this.remoteAudio.volume = 1;
        this.remoteAudio.play().catch(() => {});
      }

      setRemoteAvatar(peerId, null);
      showRemoteAvatar(peerId, false);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("[WebRTC] connectionState:", state);

      if (state === "connected") {
        if (!rtcState.inCall) {
          rtcState.inCall = true;
          this.onCallStarted?.();
          this._startNetworkMonitor();
        }
      }

      if (state === "failed" || state === "disconnected" || state === "closed") {
        this._endCallInternal(false, state);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      console.log("[WebRTC] iceConnectionState:", st);
      if (st === "failed") {
        try {
          pc.restartIce();
        } catch {}
      }
    };

    pc.onsignalingstatechange = () => {
      console.log("[WebRTC] signalingState:", pc.signalingState);
    };

    return pc;
  }

  /* ---------------------------------------------------
     Network quality monitor
  --------------------------------------------------- */
  _startNetworkMonitor() {
    this._stopNetworkMonitor();
    const pc = this.peerConnection;
    if (!pc || !pc.getStats) return;

    this._networkInterval = setInterval(async () => {
      try {
        const stats = await pc.getStats(null);
        let rtt = null;
        let jitter = null;
        let packetsLost = 0;
        let packetsTotal = 0;

        stats.forEach((report) => {
          if (report.type === "remote-inbound-rtp" && report.kind === "audio") {
            if (typeof report.roundTripTime === "number") {
              rtt = report.roundTripTime;
            }
            if (typeof report.jitter === "number") {
              jitter = report.jitter;
            }
            if (typeof report.packetsLost === "number") {
              packetsLost += report.packetsLost;
            }
            if (typeof report.packetsReceived === "number") {
              packetsTotal += report.packetsReceived + report.packetsLost;
            }
          }
        });

        let lossRate = 0;
        if (packetsTotal > 0) {
          lossRate = packetsLost / packetsTotal;
        }

        let level = "unknown";
        let info = "";

        if (rtt != null && jitter != null) {
          info = `RTT: ${(rtt * 1000).toFixed(0)} ms, jitter: ${(
            jitter * 1000
          ).toFixed(0)} ms, loss: ${(lossRate * 100).toFixed(1)}%`;

          if (lossRate < 0.02 && rtt < 0.15) level = "excellent";
          else if (lossRate < 0.05 && rtt < 0.25) level = "good";
          else if (lossRate < 0.1 && rtt < 0.4) level = "fair";
          else if (lossRate < 0.2 || rtt < 0.7) level = "poor";
          else level = "bad";
        }

        this.onQualityChange?.(level, info);
      } catch (err) {
        console.warn("[WebRTC] getStats failed", err);
      }
    }, 3000);
  }

  _stopNetworkMonitor() {
    if (this._networkInterval) {
      clearInterval(this._networkInterval);
      this._networkInterval = null;
    }
  }
}





































































































































































