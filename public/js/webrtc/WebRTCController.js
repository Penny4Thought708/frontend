// public/js/webrtc/WebRTCController.js

import { rtcState } from "./WebRTCState.js";
import {
  getLocalMedia,
  attachRemoteTrack,
  cleanupMedia,
  refreshLocalAvatarVisibility,
} from "./WebRTCMedia.js";

import { addCallLogEntry } from "../call-log.js";
import {
  getMyUserId,
  getMyFullname,
  ringback,
  ringtone,
} from "../session.js";
import { getIceServers } from "../ice.js";
import { getReceiver } from "../messaging.js";

/* -------------------------------------------------------
   Small helpers
------------------------------------------------------- */

function stopAudio(el) {
  if (!el) return;
  try {
    el.pause();
    el.currentTime = 0;
  } catch {}
}

function safePlayLoop(audioEl) {
  if (!audioEl) return;
  try {
    audioEl.loop = true;
    audioEl.currentTime = 0;
    audioEl.play().catch(() => {});
  } catch {}
}

/* -------------------------------------------------------
   Timer
------------------------------------------------------- */

const callTimerEl = document.getElementById("call-timer");

function startTimer() {
  if (!callTimerEl) return;

  if (rtcState.callTimerInterval) {
    clearInterval(rtcState.callTimerInterval);
  }

  rtcState.callTimerSeconds = 0;
  callTimerEl.textContent = "00:00";

  rtcState.callTimerInterval = setInterval(() => {
    rtcState.callTimerSeconds++;
    const s = rtcState.callTimerSeconds;
    const m = String(Math.floor(s / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    callTimerEl.textContent = `${m}:${sec}`;
  }, 1000);
}

function stopTimer() {
  if (rtcState.callTimerInterval) {
    clearInterval(rtcState.callTimerInterval);
  }
  rtcState.callTimerInterval = null;
  rtcState.callTimerSeconds = 0;
  if (callTimerEl) callTimerEl.textContent = "00:00";
}

/* -------------------------------------------------------
   Debug Overlay Injection (Top‑Left, Glass, Resizable)
------------------------------------------------------- */

(function createWebRTCDebugOverlay() {
  const panel = document.createElement("div");
  panel.id = "webrtc-debug-overlay";
  panel.style.position = "fixed";
  panel.style.top = "20px";
  panel.style.left = "20px";
  panel.style.width = "260px";
  panel.style.maxHeight = "60vh";
  panel.style.resize = "both";
  panel.style.overflow = "auto";
  panel.style.background = "rgba(0,0,0,0.65)";
  panel.style.backdropFilter = "blur(6px)";
  panel.style.color = "#0f0";
  panel.style.fontFamily = "monospace";
  panel.style.fontSize = "12px";
  panel.style.padding = "10px 12px";
  panel.style.borderRadius = "8px";
  panel.style.zIndex = "999999";
  panel.style.whiteSpace = "pre-line";
  panel.style.pointerEvents = "auto";
  panel.style.userSelect = "text";
  panel.style.border = "1px solid rgba(0,255,0,0.3)";
  panel.style.boxShadow = "0 0 12px rgba(0,255,0,0.2)";
  panel.innerHTML = "WebRTC Debug Overlay\n----------------------\nInitializing…";

  document.body.appendChild(panel);

  window._webrtcDebugUpdate = function (data) {
    const {
      iceState,
      connState,
      signalingState,
      bitrate,
      codec,
      localVideo,
      remoteVideo,
      screenShare,
      muted,
      cameraOff,
      sessionId,
    } = data;

    panel.innerHTML =
      `WebRTC Debug Overlay\n` +
      `----------------------\n` +
      `Session: ${sessionId || "none"}\n\n` +
      `ICE State: ${iceState}\n` +
      `Conn State: ${connState}\n` +
      `Signal State: ${signalingState}\n\n` +
      `Bitrate: ${bitrate || "?"} kbps\n` +
      `Codec: ${codec || "?"}\n\n` +
      `Local Video: ${localVideo ? "ON" : "OFF"}\n` +
      `Remote Video: ${remoteVideo ? "ON" : "OFF"}\n` +
      `Screen Share: ${screenShare ? "ACTIVE" : "OFF"}\n` +
      `Muted: ${muted ? "YES" : "NO"}\n` +
      `Camera Off: ${cameraOff ? "YES" : "NO"}\n`;
  };
})();

/* -------------------------------------------------------
   WebRTCController
------------------------------------------------------- */

export class WebRTCController {
  constructor(socket) {
    this.socket = socket;
    this.pc = null;
    this.localStream = null;

    this.pendingRemoteCandidates = [];

    this.localVideo = null;
    this.remoteVideo = null;
    this.remoteAudio = null;

    // UI hooks (wired by CallUI.js)
    this.onIncomingCall = null;
    this.onOutgoingCall = null;
    this.onCallConnected = null;
    this.onCallEnded = null;
    this.onCallFailed = null;
    this.onNetworkQuality = null;
    this.onRemoteMuted = null;
    this.onRemoteUnmuted = null;
    this.onRemoteCameraOff = null;
    this.onRemoteCameraOn = null;
    this.onRemoteSpeaking = null;
    this.onScreenShareStarted = null;
    this.onScreenShareStopped = null;
    this.onNoiseSuppressionChanged = null;
    this.onRecordingChanged = null;
    this.onVoicemailPrompt = null;
    this.onSecondaryIncomingCall = null;

    this._callRecorder = null;
    this._callRecorderChunks = [];

    // Internal flags
    this._screenShareStream = null;
    this._originalVideoTrack = null;
    this._noiseSuppressionEnabled = false;
    this._recordingActive = false;
    this._unreachableTone = null;
    this._beepTone = null;

    rtcState.answering = false;
    rtcState.callSessionId = null;
    rtcState.screenSharing = false;

    if (ringback) ringback.loop = true;
    if (ringtone) ringtone.loop = true;

    this._bindSocketEvents();

    window.addEventListener("online", () => {
      if (this.pc) {
        console.warn("[WebRTC] Network changed — restarting ICE");
        try {
          this.pc.restartIce();
        } catch {}
      }
    });

    this.onNetworkQuality = (level, info) => {
      console.log("[WebRTC] Network quality:", level, info || "");
      if (!this.pc) return;

      let kbps = 1800;
      if (level === "excellent") kbps = 2500;
      else if (level === "good") kbps = 1800;
      else if (level === "fair") kbps = 1200;
      else if (level === "poor" || level === "bad") kbps = 600;

      this._setVideoBitrate(this.pc, kbps).catch(() => {});
    };

    this._debugUpdate();
  }

  /* ---------------------------------------------------
     Debug Update Method
  --------------------------------------------------- */

  _debugUpdate() {
    if (!window._webrtcDebugUpdate) return;

    const pc = this.pc;

    let bitrate = "?";
    let codec = "?";

    if (pc) {
      pc.getStats(null).then((stats) => {
        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && report.kind === "video") {
            if (report.bitrateMean) {
              bitrate = Math.round(report.bitrateMean / 1000);
            }
            if (report.codecId && stats.get(report.codecId)) {
              codec = stats.get(report.codecId).mimeType;
            }
          }
        });

        window._webrtcDebugUpdate({
          iceState: pc.iceConnectionState,
          connState: pc.connectionState,
          signalingState: pc.signalingState,
          bitrate,
          codec,
          localVideo:
            !!(this.localStream && this.localStream.getVideoTracks().length),
          remoteVideo:
            !!rtcState.remoteStreams &&
            Object.values(rtcState.remoteStreams).some(
              (s) => s.getVideoTracks().length
            ),
          screenShare: rtcState.screenSharing,
          muted: this.localStream
            ? !this.localStream.getAudioTracks()[0].enabled
            : false,
          cameraOff: this.localStream
            ? !this.localStream.getVideoTracks()[0].enabled
            : false,
          sessionId: rtcState.callSessionId,
        });
      });
    } else {
      window._webrtcDebugUpdate({
        iceState: "none",
        connState: "none",
        signalingState: "none",
        bitrate: "?",
        codec: "?",
        localVideo: false,
        remoteVideo: false,
        screenShare: rtcState.screenSharing,
        muted: false,
        cameraOff: false,
        sessionId: rtcState.callSessionId,
      });
    }
  }

  /* ---------------------------------------------------
     Media elements wiring
  --------------------------------------------------- */

  attachMediaElements({ localVideo, remoteVideo, remoteAudio }) {
    this.localVideo = localVideo;
    this.remoteVideo = remoteVideo;
    this.remoteAudio = remoteAudio;
    this._debugUpdate();
  }

  /* ---------------------------------------------------
     Public entry points: voice / video
  --------------------------------------------------- */

  startVoiceCall() {
    const peerId = getReceiver();
    if (!peerId) {
      console.warn("[WebRTC] startVoiceCall: no receiver selected");
      return;
    }
    this._startCallInternal(peerId, true, { relayOnly: false });
  }

  startVideoCall() {
    const peerId = getReceiver();
    if (!peerId) {
      console.warn("[WebRTC] startVideoCall: no receiver selected");
      return;
    }
    this._startCallInternal(peerId, false, { relayOnly: false });
  }

  async startCall(peerId, audioOnly) {
    return this._startCallInternal(peerId, audioOnly, { relayOnly: false });
  }

  /* ---------------------------------------------------
     Screen share
  --------------------------------------------------- */

  async startScreenShare() {
    if (!this.pc) {
      console.warn("[WebRTC] Cannot start screen share: no PeerConnection");
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) {
        console.warn("[WebRTC] No screen track found");
        return;
      }

      try {
        screenTrack.contentHint = "detail";
      } catch {}

      const camTrack = (this.localStream?.getVideoTracks() || [])[0];
      this._originalVideoTrack = camTrack || null;

      const sender = this.pc.getSenders().find(
        (s) => s.track?.kind === "video"
      );
      if (sender) {
        await sender.replaceTrack(screenTrack);
      }

      if (this.localVideo) {
        this.localVideo.srcObject = displayStream;
        this.localVideo.play().catch(() => {});
      }

      this._screenShareStream = displayStream;
      rtcState.screenSharing = true;
      this.onScreenShareStarted?.(true);

      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      this._debugUpdate();
    } catch (err) {
      console.error("[WebRTC] Screen share failed:", err);
    }
  }

  async stopScreenShare() {
    if (!this.pc) return;

    if (this._screenShareStream) {
      this._screenShareStream.getTracks().forEach((t) => t.stop());
      this._screenShareStream = null;
    }

    const camTrack = this._originalVideoTrack;
    if (camTrack) {
      const sender = this.pc.getSenders().find(
        (s) => s.track?.kind === "video"
      );
      if (sender) {
        await sender.replaceTrack(camTrack);
      }

      if (this.localVideo && this.localStream) {
        this.localVideo.srcObject = this.localStream;
        this.localVideo.play().catch(() => {});
      }
    }

    this._originalVideoTrack = null;
    rtcState.screenSharing = false;
    this.onScreenShareStopped?.(false);
    this._debugUpdate();
  }

  /* ---------------------------------------------------
     Noise suppression (UI only)
  --------------------------------------------------- */

  toggleNoiseSuppression() {
    const enabled = !this._noiseSuppressionEnabled;
    this._noiseSuppressionEnabled = enabled;

    const stream = this.localStream || rtcState.localStream;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        try {
          const constraints = {
            echoCancellation: enabled,
            noiseSuppression: enabled,
            autoGainControl: enabled,
          };
          track.applyConstraints(constraints).catch(() => {});
        } catch {}
      });
    }

    this.onNoiseSuppressionChanged?.(enabled);
    return enabled;
  }

  /* ---------------------------------------------------
     Recording (UI only)
  --------------------------------------------------- */

  toggleRecording() {
    const active = !this._recordingActive;

    // Stop recording
    if (!active && this._callRecorder) {
      try {
        this._callRecorder.stop();
      } catch {}
      this._recordingActive = false;
      // onRecordingChanged will be fired in onstop with the final URL
      return false;
    }

    // Start recording
    const local = this.localStream || rtcState.localStream;
    const remoteAudioEl = document.getElementById("remoteAudio");
    const remoteStream = remoteAudioEl?.srcObject || null;

    if (!local && !remoteStream) {
      console.warn("[WebRTC] toggleRecording: no streams to record");
      return false;
    }

    const mix = new MediaStream();

    if (local) {
      local.getAudioTracks().forEach((t) => mix.addTrack(t));
    }
    if (remoteStream) {
      remoteStream.getAudioTracks().forEach((t) => mix.addTrack(t));
    }

    try {
      const rec = new MediaRecorder(mix, {
        mimeType: "audio/webm",
      });

      this._callRecorder = rec;
      this._callRecorderChunks = [];
      this._recordingActive = true;

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this._callRecorderChunks.push(e.data);
        }
      };

      rec.onstop = () => {
        const blob = new Blob(this._callRecorderChunks, {
          type: "audio/webm",
        });
        const url = URL.createObjectURL(blob);

        this._recordingActive = false;
        this._callRecorder = null;
        this._callRecorderChunks = [];

        this.onRecordingChanged?.({
          active: false,
          url,
          blob,
        });
      };

      rec.start(1000);
      this.onRecordingChanged?.({ active: true });
      return true;
    } catch (err) {
      console.warn("[WebRTC] Failed to start call recording:", err);
      this._recordingActive = false;
      this._callRecorder = null;
      this._callRecorderChunks = [];
      this.onRecordingChanged?.({
        active: false,
        error: err?.message,
      });
      return false;
    }
  }

  /* ---------------------------------------------------
     Outgoing call
  --------------------------------------------------- */

  async _startCallInternal(peerId, audioOnly, { relayOnly }) {
    const myId = getMyUserId();
    if (!myId) {
      console.warn("[WebRTC] Cannot start call: missing getMyUserId()");
      return;
    }

    rtcState.callSessionId = crypto.randomUUID();
    rtcState.peerId = peerId;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = true;
    rtcState.inCall = true;
    rtcState.incomingOffer = null;
    rtcState.usedRelayFallback = !!relayOnly;
    rtcState.answering = false;

    this.onOutgoingCall?.({
      targetName: rtcState.peerName || null,
      video: !audioOnly,
      voiceOnly: !!audioOnly,
    });

    const pc = await this._createPC({ relayOnly });

    const stream = await getLocalMedia(true, !audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    if (!stream) {
      console.warn(
        "[WebRTC] No local media stream; proceeding with no mic/camera"
      );
    } else {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }

    await this._setPreferredCodec(pc, "video", "video/VP9").catch(() => {});

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.socket.emit("webrtc:signal", {
      type: "offer",
      to: peerId,
      from: myId,
      offer,
      audioOnly: !!audioOnly,
      fromName: getMyFullname(),
      callSessionId: rtcState.callSessionId,
    });

    safePlayLoop(ringback);
    this._debugUpdate();
  }

  async _resumeAsCallerAfterRestore(peerId) {
    console.log(
      "[WebRTC] Resuming call as caller after restore to peer:",
      peerId
    );

    const relayOnly = !!rtcState.usedRelayFallback;
    const audioOnly = !!rtcState.audioOnly;

    await this._startCallInternal(peerId, audioOnly, { relayOnly });
  }

  /* ---------------------------------------------------
     Incoming offer
  --------------------------------------------------- */

  async handleOffer(data) {
    const { from, offer, fromName, audioOnly, fromUser, callSessionId } =
      data || {};
    if (!from || !offer) {
      console.warn("[WebRTC] handleOffer: invalid data", data);
      return;
    }

    // If we are already in any call → secondary incoming call notification
    if (rtcState.inCall && !rtcState.answering) {
      console.log(
        "[WebRTC] Secondary incoming call from",
        from,
        "while already in a call"
      );

      this.socket?.emit("call:busy", {
        to: from,
        from: getMyUserId(),
        reason: "in-another-call",
      });

      this.onSecondaryIncomingCall?.({
        fromId: from,
        fromName: fromUser?.fullname || fromName || `User ${from}`,
        audioOnly: !!audioOnly,
        callSessionId,
      });

      return;
    }

    const displayName = fromUser?.fullname || fromName || `User ${from}`;

    rtcState.callSessionId = callSessionId || crypto.randomUUID();
    rtcState.peerId = from;
    rtcState.peerName = displayName;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;
    rtcState.inCall = false;
    rtcState.incomingOffer = data;
    rtcState.usedRelayFallback = false;
    rtcState.answering = false;

    safePlayLoop(ringtone);

    this.onIncomingCall?.({
      fromName: rtcState.peerName,
      audioOnly: !!audioOnly,
    });

    this._debugUpdate();
  }

  /* ---------------------------------------------------
     Answer incoming call
  --------------------------------------------------- */

  async answerIncomingCall() {
    const offerData = rtcState.incomingOffer;
    if (!offerData || !offerData.offer || !offerData.from) {
      console.warn("[WebRTC] answerIncomingCall: no stored offer");
      return;
    }

    const { from, offer, audioOnly, callSessionId } = offerData;

    rtcState.inCall = true;
    rtcState.audioOnly = !!audioOnly;
    rtcState.callSessionId = callSessionId || rtcState.callSessionId;
    rtcState.answering = true;

    stopAudio(ringtone);
    stopAudio(ringback);
    startTimer();

    const pc = await this._createPC({ relayOnly: false });

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this._flushPendingRemoteCandidates();

    const stream = await getLocalMedia(true, !rtcState.audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    if (!stream) {
      console.warn("[WebRTC] No local media stream on answer");
    } else {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }

    await this._setPreferredCodec(pc, "video", "video/VP9").catch(() => {});

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.socket.emit("webrtc:signal", {
      type: "answer",
      to: from,
      from: getMyUserId(),
      answer,
      callSessionId: rtcState.callSessionId,
    });

    rtcState.incomingOffer = null;

    setTimeout(() => {
      rtcState.answering = false;
    }, 800);

    this.onCallConnected?.();
    this._debugUpdate();
  }

  /* ---------------------------------------------------
     Decline incoming call
  --------------------------------------------------- */

  declineIncomingCall() {
    const offerData = rtcState.incomingOffer;

    let callerId = null;
    if (offerData && offerData.from) {
      callerId = offerData.from;
    } else if (rtcState.currentCallerId) {
      callerId = rtcState.currentCallerId;
    }

    stopAudio(ringtone);
    stopAudio(ringback);

    if (callerId) {
      this.socket.emit("call:decline", { to: callerId });
    } else {
      console.warn("[WebRTC] declineIncomingCall: no callerId available");
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

    this.onCallEnded?.();
    this._debugUpdate();
  }

  /* ---------------------------------------------------
     Remote answer
  --------------------------------------------------- */

  async handleAnswer(data) {
    if (!this.pc) {
      console.warn("[WebRTC] handleAnswer: no peer connection");
      return;
    }

    if (!data || !data.answer) {
      console.warn("[WebRTC] handleAnswer: invalid data", data);
      return;
    }

    if (!rtcState.isCaller) {
      console.warn(
        "[WebRTC] handleAnswer: ignoring answer because we are not the caller"
      );
      return;
    }

    if (this.pc.signalingState !== "have-local-offer") {
      console.warn(
        "[WebRTC] handleAnswer: ignoring duplicate/late answer, state =",
        this.pc.signalingState
      );
      return;
    }

    console.log("[WebRTC] handleAnswer: applying remote answer");

    rtcState.answering = true;
    setTimeout(() => {
      rtcState.answering = false;
    }, 800);

    await this.pc.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );
    await this._flushPendingRemoteCandidates();

    stopAudio(ringback);
    stopAudio(ringtone);
    startTimer();
    this.onCallConnected?.();
    this._debugUpdate();
  }

  /* ---------------------------------------------------
     Remote ICE
  --------------------------------------------------- */

  async handleRemoteIceCandidate(data) {
    if (!data || !data.candidate) return;

    if (!this.pc || !this.pc.remoteDescription) {
      console.log(
        "[ICE] Queuing remote candidate (no PC/remoteDescription yet):",
        data.candidate
      );
      this.pendingRemoteCandidates.push(data.candidate);
      return;
    }

    console.log("[ICE] Adding remote candidate:", data.candidate);

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.warn("[WebRTC] Error adding ICE candidate:", err);
    }
  }

  /* ---------------------------------------------------
     Remote end
  --------------------------------------------------- */

  handleRemoteEnd() {
    if (rtcState.answering) {
      console.warn(
        "[WebRTC] handleRemoteEnd: ignoring remote end during answer window"
      );
      return;
    }
    this.endCall(false);
  }

  /* ---------------------------------------------------
     End call
  --------------------------------------------------- */

  endCall(local = true) {
    stopAudio(ringback);
    stopAudio(ringtone);
    stopTimer();

    try {
      this._unreachableTone?.pause();
      this._unreachableTone = null;
      this._beepTone?.pause();
      this._beepTone = null;
    } catch {}

    try {
      const vmModal = document.getElementById("voicemailModal");
      if (vmModal) vmModal.classList.add("hidden");
    } catch {}

    try {
      if (window._vmRecorderStream) {
        window._vmRecorderStream.getTracks().forEach((t) => t.stop());
        window._vmRecorderStream = null;
      }
      if (
        window._vmMediaRecorder &&
        window._vmMediaRecorder.state !== "inactive"
      ) {
        window._vmMediaRecorder.stop();
      }
    } catch {}

    try {
      if (this._screenShareStream) {
        this._screenShareStream.getTracks().forEach((t) => t.stop());
        this._screenShareStream = null;
      }
      this._originalVideoTrack = null;
      rtcState.screenSharing = false;
    } catch {}

    const peerId = rtcState.peerId;

    if (this.pc) {
      try {
        this.pc.onicecandidate = null;
        this.pc.ontrack = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    cleanupMedia();

    const direction = rtcState.isCaller ? "outgoing" : "incoming";

    let status = "ended";
    if (!rtcState.inCall && !local) status = "missed";
    if (!rtcState.inCall && local && !rtcState.isCaller) status = "rejected";

    const logEntry = {
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
    };

    addCallLogEntry(logEntry);

    rtcState.inCall = false;
    rtcState.peerId = null;
    rtcState.incomingOffer = null;
    rtcState.answering = false;

    const sessionIdToSend = rtcState.callSessionId;
    rtcState.callSessionId = null;

    if (local && peerId && this.socket) {
      this.socket.emit("webrtc:signal", {
        type: "end",
        to: peerId,
        from: getMyUserId(),
        reason: "hangup",
        callSessionId: sessionIdToSend,
      });
    }

    this.onCallEnded?.();
    this._debugUpdate();
  }

  /* ---------------------------------------------------
     Mute toggle
  --------------------------------------------------- */

  toggleMute() {
    const stream = this.localStream || rtcState.localStream;
    if (!stream) return undefined;

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return undefined;

    const currentlyEnabled = audioTracks.some((t) => t.enabled);
    const newEnabled = !currentlyEnabled;

    audioTracks.forEach((t) => {
      t.enabled = newEnabled;
    });

    this._debugUpdate();
    return !newEnabled;
  }

  /* ---------------------------------------------------
     Camera toggle
  --------------------------------------------------- */

  toggleCamera() {
    const stream = this.localStream || rtcState.localStream;
    if (!stream) {
      console.warn("[WebRTC] toggleCamera: no local stream");
      return;
    }

    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) return;

    const enabled = videoTracks.some((t) => t.enabled);
    const newEnabled = !enabled;

    videoTracks.forEach((t) => {
      t.enabled = newEnabled;
    });

    refreshLocalAvatarVisibility();

    this._debugUpdate();
    return !newEnabled; // true = camera now OFF
  }

  /* ---------------------------------------------------
     PeerConnection factory
  --------------------------------------------------- */

  async _createPC({ relayOnly = false } = {}) {
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    const iceServers = await getIceServers({ relayOnly });

    const config = {
      iceServers,
      iceTransportPolicy: "relay",
    };

    console.log("[WebRTC] Creating RTCPeerConnection with config:", config);

    const pc = new RTCPeerConnection(config);
    this.pc = pc;

    const startTurnKeepAlive = (pcInstance) => {
      const keepAliveTimer = setInterval(() => {
        try {
          pcInstance.getStats(null);
        } catch {}
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

    try {
      const keepAliveChannel = pc.createDataChannel("keepalive");

      keepAliveChannel.onopen = () => {
        setInterval(() => {
          if (keepAliveChannel.readyState === "open") {
            keepAliveChannel.send("ping");
          }
        }, 5000);
      };
    } catch (err) {
      console.warn("[WebRTC] keepalive datachannel failed:", err);
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      console.log("[ICE] Local candidate:", event.candidate);

      const c = event.candidate.candidate || "";
      let type = "unknown";
      if (c.includes("relay")) type = "TURN relay";
      else if (c.includes("srflx")) type = "STUN srflx";
      else if (c.includes("host")) type = "Host";

      this.onNetworkQuality?.("good", `Candidate: ${type}`);

      if (rtcState.peerId && this.socket) {
        this.socket.emit("webrtc:signal", {
          type: "ice",
          to: rtcState.peerId,
          from: getMyUserId(),
          candidate: event.candidate,
          callSessionId: rtcState.callSessionId,
        });
      }
    };

    pc.ontrack = (event) => {
      const peerId =
        rtcState.peerId ||
        (event.streams && event.streams[0] && event.streams[0].id) ||
        "default";

      attachRemoteTrack(peerId, event);
      this._debugUpdate();
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log("[WebRTC] iceConnectionState:", state);

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

      this.onNetworkQuality?.(level, `ICE: ${state}`);

      if (rtcState.answering) {
        console.log(
          "[WebRTC] ICE state change ignored during answer window:",
          state
        );
        this._debugUpdate();
        return;
      }

      if (state === "disconnected") {
        console.warn("[WebRTC] Disconnected — attempting ICE restart");
        try {
          pc.restartIce();
        } catch (err) {
          console.warn("[WebRTC] ICE restart failed:", err);
        }

        setTimeout(() => {
          if (
            pc.iceConnectionState === "disconnected" &&
            !rtcState.usedRelayFallback &&
            rtcState.peerId &&
            !rtcState.answering
          ) {
            console.warn(
              "[WebRTC] Mobile network disconnected — forcing relay-only fallback"
            );
            rtcState.usedRelayFallback = true;

            const peerId = rtcState.peerId;
            const audioOnly = rtcState.audioOnly;
            const isCaller = rtcState.isCaller;

            this.endCall(false);

            if (isCaller) {
              this._startCallInternal(peerId, audioOnly, {
                relayOnly: true,
              });
            }
          }
        }, 1500);
      }

      if (state === "failed") {
        if (
          !rtcState.usedRelayFallback &&
          rtcState.peerId &&
          !rtcState.answering
        ) {
          console.warn("[WebRTC] ICE failed — retrying with relay-only…");
          rtcState.usedRelayFallback = true;

          const peerId = rtcState.peerId;
          const audioOnly = rtcState.audioOnly;
          const isCaller = rtcState.isCaller;

          this.endCall(false);

          if (isCaller) {
            this._startCallInternal(peerId, audioOnly, {
              relayOnly: true,
            });
          }
        } else if (!rtcState.answering) {
          this.onCallFailed?.("ice failed");
        }
      }

      this._debugUpdate();
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("[WebRTC] connectionState:", state);

      if (state === "failed") {
        this.onCallFailed?.("connection failed");
      }

      this._debugUpdate();
    };

    this._debugUpdate();
    return pc;
  }

  /* ---------------------------------------------------
     Codec + bitrate helpers
  --------------------------------------------------- */

  async _setPreferredCodec(pc, kind, codecMime) {
    try {
      const transceivers = pc
        .getTransceivers()
        .filter((t) => t.sender?.track?.kind === kind);
      for (const t of transceivers) {
        const caps = RTCRtpSender.getCapabilities(kind);
        if (!caps) continue;
        const preferred = caps.codecs.filter(
          (c) => c.mimeType.toLowerCase() === codecMime.toLowerCase()
        );
        const others = caps.codecs.filter(
          (c) => c.mimeType.toLowerCase() !== codecMime.toLowerCase()
        );
        if (preferred.length) {
          t.setCodecPreferences([...preferred, ...others]);
        }
      }
    } catch (err) {
      console.warn("[WebRTC] _setPreferredCodec failed:", err);
    }
  }

  async _setVideoBitrate(pc, maxKbps) {
    try {
      const senders = pc.getSenders().filter(
        (s) => s.track?.kind === "video"
      );
      for (const s of senders) {
        const params = s.getParameters();
        params.encodings = params.encodings || [{}];
        params.encodings[0].maxBitrate = maxKbps * 1000;
        await s.setParameters(params);
      }
      this._debugUpdate();
    } catch (err) {
      console.warn("[WebRTC] _setVideoBitrate failed:", err);
    }
  }

  /* ---------------------------------------------------
     Flush queued ICE
  --------------------------------------------------- */

  async _flushPendingRemoteCandidates() {
    if (!this.pc || !this.pc.remoteDescription) {
      return;
    }

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
      if (!data || !data.type) return;

      if (data.callSessionId && rtcState.callSessionId) {
        if (data.callSessionId !== rtcState.callSessionId) {
          console.log(
            "[WebRTC] Ignoring signal for different callSessionId",
            data.callSessionId,
            "!=",
            rtcState.callSessionId
          );
          return;
        }
      }

      if (data.fromUser && !rtcState.peerName) {
        const { fullname } = data.fromUser;
        if (fullname) rtcState.peerName = fullname;
      }

      switch (data.type) {
        case "offer":
          await this.handleOffer(data);
          break;

        case "answer":
          await this.handleAnswer(data);
          break;

        case "ice":
          console.log(
            "[SIGNAL] Incoming ICE from",
            data.from,
            "→",
            data.to,
            data.candidate
          );
          await this.handleRemoteIceCandidate(data);
          break;

        case "end":
          this.handleRemoteEnd();
          break;

        case "busy":
          stopAudio(ringback);
          stopAudio(ringtone);
          try {
            const busyTone = new Audio("/NewApp/busy.mp3");
            busyTone.play().catch(() => {});
          } catch {}
          this.onCallFailed?.("busy");
          break;

        default:
          break;
      }
    });

    this.socket.on(
      "call:restore",
      ({ callerId, receiverId, status, callSessionId }) => {
        const me = String(getMyUserId());
        const callerStr = String(callerId);
        const receiverStr = String(receiverId);

        const isCaller = me === callerStr;
        const peerId = isCaller ? receiverStr : callerStr;

        console.log("[WebRTC] call:restore received:", {
          me,
          callerId,
          receiverId,
          status,
          isCaller,
          peerId,
          callSessionId,
        });

        rtcState.callSessionId = callSessionId || rtcState.callSessionId;
        rtcState.peerId = peerId;
        rtcState.isCaller = isCaller;
        rtcState.inCall = status === "active";

        if (status === "active") {
          this.onCallConnected?.();
          if (isCaller) {
            this._resumeAsCallerAfterRestore(peerId);
          }
        } else if (status === "ringing") {
          if (isCaller) {
            this.onOutgoingCall?.({
              targetName: rtcState.peerName || null,
              video: !rtcState.audioOnly,
              voiceOnly: !!rtcState.audioOnly,
            });
          } else {
            this.onIncomingCall?.({
              fromName: rtcState.peerName || "",
              audioOnly: !!rtcState.audioOnly,
            });
          }
        }

        this._debugUpdate();
      }
    );

    const playUnreachableTone = () => {
      try {
        const tone = new Audio("uploads/audio/user_unreachable.mp3");
        this._unreachableTone = tone;
        tone.play().catch(() => {});
      } catch (err) {
        console.warn("[WebRTC] Unreachable tone failed:", err);
      }
    };

    const playBeepTone = () => {
      try {
        const beep = new Audio("/audio/beep.mp3");
        this._beepTone = beep;
        beep.play().catch(() => {});
      } catch (err) {
        console.warn("[WebRTC] Beep tone failed:", err);
      }
    };

    const triggerVoicemailFlow = (from, message) => {
      if (rtcState.inCall || rtcState.answering) {
        console.log(
          "[WebRTC] Voicemail flow skipped because call is active/answering"
        );
        return;
      }

      stopAudio(ringback);
      stopAudio(ringtone);

      playUnreachableTone();
      setTimeout(() => playBeepTone(), 1200);

      setTimeout(() => {
        if (rtcState.inCall || rtcState.answering) {
          console.log(
            "[WebRTC] Voicemail toast skipped (call became active)"
          );
          return;
        }
        this.onVoicemailPrompt?.({
          peerId: from,
          message,
        });
      }, 1500);
    };

    this.socket.on("call:timeout", ({ from }) => {
      console.log("[WebRTC] call:timeout from", from);
      triggerVoicemailFlow(from, "No answer. Leave a voicemail…");
    });

    this.socket.on("call:declined", ({ from }) => {
      console.log("[WebRTC] call:declined from", from);
      triggerVoicemailFlow(from, "Call declined. Leave a voicemail…");
    });

    this.socket.on("call:missed", ({ from }) => {
      console.log("[WebRTC] call:missed from", from);
      triggerVoicemailFlow(from, "Missed call. Leave a voicemail…");
    });

    this.socket.on("call:dnd", ({ from }) => {
      console.log("[WebRTC] call:dnd from", from);
      triggerVoicemailFlow(
        from,
        "User is in Do Not Disturb. Leave a voicemail…"
      );
    });

    this.socket.on("call:voicemail", ({ from, reason }) => {
      console.log("[WebRTC] call:voicemail from", from, "reason:", reason);

      const msg =
        reason === "callee-dnd"
          ? "User is in Do Not Disturb. Leave a voicemail…"
          : "Leave a voicemail…";

      triggerVoicemailFlow(from, msg);
    });

    this.socket.on("disconnect", () => {
      if (rtcState.inCall) {
        this.endCall(false);
      }
    });
  }
}

































































