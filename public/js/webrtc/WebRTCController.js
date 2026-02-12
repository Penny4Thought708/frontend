// public/js/webrtc/WebRTCController.js
// Mesh‑ready WebRTC controller aligned with Aurora‑Orbit CallUI + WebRTCMedia.
// Primary‑device mode: first device handles the call, others auto‑decline → voicemail.

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
     Outgoing Call (Hardened)
  --------------------------------------------------- */
  async _startCallInternal(peerId, audioOnly, { relayOnly }) {
    console.log("[WebRTC] _startCallInternal", { peerId, audioOnly, relayOnly });

    const myId = getMyUserId();
    if (!myId) return;

    // 1. BLOCK if a call is already active or tearing down
    if (rtcState.busy || rtcState.inCall || rtcState.incomingOffer) {
      console.warn("[WebRTC] Ignoring startCall — already busy/inCall");
      return;
    }

    // 2. BLOCK if a stale PC still exists
    const existingPC = this.pcMap.get(peerId);
    if (existingPC && existingPC.signalingState !== "closed") {
      console.warn("[WebRTC] Ignoring startCall — PC still active for peer", peerId);
      return;
    }

    stopAllTones();

    // 3. Initialize call state
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

    // 4. Create PC (fresh)
    const pc = await this._getOrCreatePC(peerId, { relayOnly });

    if (!pc || pc.signalingState === "closed") {
      console.error("[WebRTC] Cannot start call — PC invalid");
      rtcState.busy = false;
      return;
    }

    // 5. Acquire local media
    const stream = await getLocalMedia(true, !audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    this.onLocalStream?.(stream);

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } else {
      console.warn("[WebRTC] No local media — continuing call anyway");
    }

    // 6. Notify UI
    this.onOutgoingCall?.({
      targetName: rtcState.peerName,
      voiceOnly: audioOnly,
    });

    try {
      if (ringback) ringback.play().catch(() => {});
    } catch {}

    // 7. Create offer (only if PC is valid)
    if (pc.signalingState !== "stable") {
      console.warn("[WebRTC] Cannot create offer — signalingState:", pc.signalingState);
      return;
    }

    this.makingOffer = true;
    let offer = await pc.createOffer();
    this.makingOffer = false;

    // Prefer high-quality video
    if (offer.sdp) {
      offer.sdp = offer.sdp.replace(
        /(m=video .*?)(96 97 98)/,
        (match, prefix, list) => `${prefix}98 96 97`
      );
    }

    await pc.setLocalDescription(offer);

    // 8. Apply video encoding preferences
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

    // 9. Send offer
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

    // Get local media
    const stream = await getLocalMedia(true, !audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;

    this.onLocalStream?.(stream);

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }

    // Perfect negotiation: set remote, then answer
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Flush pending candidates
    this._flushPendingCandidates(peerId, pc);

    this.socket.emit("webrtc:signal", {
      type: "answer",
      to: peerId,
      from: this.localPeerId,
      answer,
    });

    // Explicit accept for backend call state
    this.socket.emit("call:accept", { to: peerId });

    // Stop ringtone
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

    // Close all PCs
    for (const [peerId, pc] of this.pcMap.entries()) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.onsignalingstatechange = null;
        pc.close();
      } catch {}
      this.pcMap.delete(peerId);
    }

    cleanupMedia();

    rtcState.busy = false;
    rtcState.inCall = false;
    rtcState.incomingOffer = null;
    this.currentPeerId = null;

    if (localHangup) {
      this.onCallEnded?.();
    } else if (reason && reason !== "ended") {
      this.onCallFailed?.(reason);
    }

    // Log call
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

    // Backend call state events
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
      // Remote explicitly accepted; treat as call started if not already
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

    // Ignore offers that don't target the current logical peer
    if (rtcState.peerId && rtcState.peerId !== from && (rtcState.busy || rtcState.inCall)) {
      console.log("[WebRTC] Offer for different peer while busy — ignoring", {
        currentPeer: rtcState.peerId,
        from,
      });
      return;
    }

    // Primary‑device mode: if already busy or in call, auto‑decline → voicemail
    if (rtcState.busy || rtcState.inCall || rtcState.incomingOffer) {
      console.log("[WebRTC] Secondary device received offer — auto‑decline");
      this.socket.emit("call:decline", { to: from });
      return;
    }

    // This device becomes the primary endpoint
    rtcState.peerId = from;
    rtcState.peerName = fromName || `User ${from}`;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;
    rtcState.busy = true;
    rtcState.inCall = false;
    rtcState.incomingOffer = { from, offer, audioOnly };

    this.currentPeerId = from;
    this.isPolite = true; // callee is polite
    this.makingOffer = false;
    this.ignoreOffer = false;

    // Ringtone for incoming call
    try {
      if (ringtone) ringtone.play().catch(() => {});
    } catch {}

    // UI callback
    this.onIncomingCall?.({
      fromName: rtcState.peerName,
      audioOnly: !!audioOnly,
    });

    // Pre‑create PC so ICE candidates can be queued
    await this._getOrCreatePC(from, { relayOnly: rtcState.usedRelayFallback });
  }

  /* ---------------------------------------------------
     Answer handling (ignore stale / wrong‑state answers)
  --------------------------------------------------- */
  async _handleAnswer(msg) {
    const { from, answer } = msg;
    if (!from || !answer) return;

    // Ignore answers for calls we no longer care about
    if (from !== rtcState.peerId || !rtcState.busy) {
      console.warn("[WebRTC] Stale answer ignored from", from, {
        rtcPeer: rtcState.peerId,
        busy: rtcState.busy,
      });
      return;
    }

    const pc = this.pcMap.get(from);
    if (!pc) {
      console.warn("[WebRTC] Answer for unknown peer", from);
      return;
    }

    // Only accept answer in the correct signaling state
    if (pc.signalingState !== "have-local-offer") {
      console.warn(
        "[WebRTC] Ignoring answer in signalingState",
        pc.signalingState,
        "for peer",
        from
      );
      return;
    }

    try {
      await pc.setRemoteDescription(answer);
    } catch (err) {
      console.error("[WebRTC] setRemoteDescription(answer) failed", err);
      return;
    }

    // Flush pending candidates
    this._flushPendingCandidates(from, pc);

    stopAllTones();

    if (!rtcState.inCall) {
      rtcState.inCall = true;
      this.onCallStarted?.();
      this._startNetworkMonitor();
    }
  }

  /* ---------------------------------------------------
     ICE candidate handling (ignore stale)
  --------------------------------------------------- */
  async _handleCandidate(msg) {
    const { from, candidate } = msg;
    if (!from || !candidate) return;

    // Ignore candidates for stale peers
    if (from !== rtcState.peerId || (!rtcState.busy && !rtcState.inCall)) {
      console.warn("[WebRTC] Stale candidate ignored from", from, {
        rtcPeer: rtcState.peerId,
        busy: rtcState.busy,
        inCall: rtcState.inCall,
      });
      return;
    }

    const pc = this.pcMap.get(from);
    if (!pc || pc.remoteDescription == null) {
      // Queue until PC and remoteDescription are ready
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
     Remote end handling (ignore stale)
  --------------------------------------------------- */
  _handleRemoteEnd(msg) {
    const { from } = msg || {};
    if (!from) return;

    // Only react if this matches the active peer
    if (from !== rtcState.peerId || (!rtcState.busy && !rtcState.inCall)) {
      console.warn("[WebRTC] Stale remote-end ignored from", from, {
        rtcPeer: rtcState.peerId,
        busy: rtcState.busy,
        inCall: rtcState.inCall,
      });
      return;
    }

    this._endCallInternal(false, "remote-end");
  }

  /* ---------------------------------------------------
     PC creation / wiring (Hardened)
  --------------------------------------------------- */
  async _getOrCreatePC(peerId, { relayOnly }) {
    let pc = this.pcMap.get(peerId);

    // 1. If PC exists but is invalid → destroy it
    if (pc) {
      const bad =
        pc.signalingState === "closed" ||
        pc.connectionState === "closed" ||
        pc.connectionState === "failed";

      if (bad) {
        console.warn("[WebRTC] Removing stale PC for peer", peerId, {
          signalingState: pc.signalingState,
          connectionState: pc.connectionState,
        });

        try {
          pc.onicecandidate = null;
          pc.ontrack = null;
          pc.onconnectionstatechange = null;
          pc.oniceconnectionstatechange = null;
          pc.onsignalingstatechange = null;
          pc.close();
        } catch {}

        this.pcMap.delete(peerId);
        pc = null;
      }
    }

    // 2. Create fresh PC if none exists
    if (!pc) {
      const iceServers = (await getIceServers?.(relayOnly)) || [];
      pc = new RTCPeerConnection({ iceServers });

      this.pcMap.set(peerId, pc);
      this.currentPeerId = peerId;
      this.peerConnection = pc; // for CallUI screen share helpers

      console.log("[WebRTC] Created new RTCPeerConnection for peer", peerId);

      // 3. Wire ICE candidates
      pc.onicecandidate = (evt) => {
        if (!evt.candidate) return;

        // Ignore if stale peer
        if (peerId !== rtcState.peerId) {
          console.warn("[WebRTC] Ignoring ICE from stale peer", peerId);
          return;
        }

        this.socket.emit("webrtc:signal", {
          type: "candidate",
          to: peerId,
          from: this.localPeerId,
          candidate: evt.candidate,
        });
      };

      // 4. Remote track handling
      pc.ontrack = (evt) => {
        // Ignore stale peer
        if (peerId !== rtcState.peerId) {
          console.warn("[WebRTC] Ignoring remote track from stale peer", peerId);
          return;
        }

        const remoteStream = attachRemoteTrack(peerId, evt);

        // Merge into unified remoteStream for recording
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(evt.track);

        // Bind remote audio
        if (this.remoteAudio) {
          this.remoteAudio.srcObject = this.remoteStream;
          this.remoteAudio.playsInline = true;
          this.remoteAudio.muted = false;
          this.remoteAudio.volume = 1;
          this.remoteAudio.play().catch(() => {});
        }

        // Avatar fallback
        setRemoteAvatar(peerId, null);
        showRemoteAvatar(peerId, false);
      };

      // 5. Connection state handling
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
          console.warn("[WebRTC] PC ended with state:", state);
          this._endCallInternal(false, state);
        }
      };

      // 6. ICE connection state
      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        console.log("[WebRTC] iceConnectionState:", st);

        if (st === "failed") {
          try {
            pc.restartIce();
          } catch {}
        }
      };

      // 7. Signaling state
      pc.onsignalingstatechange = () => {
        console.log("[WebRTC] signalingState:", pc.signalingState);
      };
    }

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










































































































































































