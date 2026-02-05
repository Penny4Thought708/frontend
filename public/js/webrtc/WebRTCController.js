// public/js/webrtc/WebRTCController.js

import { rtcState } from "./WebRTCState.js";
rtcState.answering = false;

import { getLocalMedia, attachRemoteTrack } from "./WebRTCMedia.js";
import { addCallLogEntry } from "../call-log.js";

import {
  getMyUserId,
  getMyFullname,
  ringback,
  ringtone,
} from "../session.js";

import { getIceServers } from "../ice.js";
import { getReceiver } from "../messaging.js";
import { openVoicemailRecorder } from "../voicemail-recorder.js";

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
   WebRTC Controller
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

    // Event hooks for CallUI.js
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
    this.onVoicemailPrompt = null;

    this._bindSocketEvents();
    this._screenShareStream = null;
    this._originalVideoTrack = null;

    // Network change → ICE restart on current PC
    window.addEventListener("online", () => {
      if (this.pc) {
        console.warn("[WebRTC] Network changed — restarting ICE");
        try {
          this.pc.restartIce();
        } catch {}
      }
    });
  }

  /* ---------------------------------------------------
     Media elements wiring
  --------------------------------------------------- */
  attachMediaElements({ localVideo, remoteVideo, remoteAudio }) {
    this.localVideo = localVideo;
    this.remoteVideo = remoteVideo;
    this.remoteAudio = remoteAudio;
  }

 /* ---------------------------------------------------
   Entry points: voice / video / screen share / extras
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

// Legacy API
async startCall(peerId, audioOnly) {
  return this._startCallInternal(peerId, audioOnly, { relayOnly: false });
}

/* ---------------------------------------------------
   REAL SCREEN SHARE IMPLEMENTATION
--------------------------------------------------- */

async startScreenShare() {
  if (!this.pc) {
    console.warn("[WebRTC] Cannot start screen share: no PeerConnection");
    return;
  }

  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    const screenTrack = displayStream.getVideoTracks()[0];
    if (!screenTrack) {
      console.warn("[WebRTC] No screen track found");
      return;
    }

    // Save original camera track so we can restore it later
    const camTrack = (this.localStream?.getVideoTracks() || [])[0];
    this._originalVideoTrack = camTrack || null;

    // Replace outgoing track
    const sender = this.pc.getSenders().find(s => s.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(screenTrack);
    }

    // Update local preview
    if (this.localVideo) {
      this.localVideo.srcObject = displayStream;
      this.localVideo.play().catch(() => {});
    }

    this._screenShareStream = displayStream;

    // When user clicks "Stop Sharing" in browser UI
    screenTrack.onended = () => {
      this.stopScreenShare();
    };

    this.onScreenShareStarted?.();

  } catch (err) {
    console.error("[WebRTC] Screen share failed:", err);
  }
}

async stopScreenShare() {
  if (!this.pc) return;

  // Stop screen stream
  if (this._screenShareStream) {
    this._screenShareStream.getTracks().forEach(t => t.stop());
    this._screenShareStream = null;
  }

  // Restore original camera track
  const camTrack = this._originalVideoTrack;
  if (camTrack) {
    const sender = this.pc.getSenders().find(s => s.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(camTrack);
    }

    // Restore local preview
    if (this.localVideo && this.localStream) {
      this.localVideo.srcObject = this.localStream;
      this.localVideo.play().catch(() => {});
    }
  }

  this._originalVideoTrack = null;

  this.onScreenShareStopped?.();
}

/* ---------------------------------------------------
   Noise suppression (stub for now)
--------------------------------------------------- */

toggleNoiseSuppression() {
  const enabled = !this._noiseSuppressionEnabled;
  this._noiseSuppressionEnabled = enabled;
  this.onNoiseSuppressionChanged?.(enabled);
  return enabled;
}

/* ---------------------------------------------------
   Recording (stub for now)
--------------------------------------------------- */

toggleRecording() {
  const active = !this._recordingActive;
  this._recordingActive = active;
  this.onRecordingChanged?.(active);
  return active;
}


  /* ---------------------------------------------------
     Outgoing Call (with optional relay-only)
  --------------------------------------------------- */
  async _startCallInternal(peerId, audioOnly, { relayOnly }) {
    const myId = getMyUserId();
    if (!myId) {
      console.warn("[WebRTC] Cannot start call: missing getMyUserId()");
      return;
    }

    rtcState.peerId = peerId;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = true;
    rtcState.inCall = true;
    rtcState.incomingOffer = null;
    rtcState.usedRelayFallback = !!relayOnly;

    this.onOutgoingCall?.({
      targetName: rtcState.peerName || null,
      video: !audioOnly,
      voiceOnly: !!audioOnly,
    });

    const pc = await this._createPC({ relayOnly });

    const stream = await getLocalMedia(true, !audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      if (this.localVideo && !audioOnly) {
        this.localVideo.srcObject = stream;
        this.localVideo.muted = true;
        this.localVideo.playsInline = true;
        this.localVideo.play().catch(() => {});
      }
    } else {
      console.warn(
        "[WebRTC] No local media stream; proceeding with no mic/camera"
      );
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

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

  /**
   * Resume an existing call after socket/network reconnect.
   */
  async _resumeAsCallerAfterRestore(peerId) {
    console.log("[WebRTC] Resuming call as caller after restore to peer:", peerId);

    const relayOnly = !!rtcState.usedRelayFallback;
    const audioOnly = !!rtcState.audioOnly;

    await this._startCallInternal(peerId, audioOnly, { relayOnly });
  }

  /* ---------------------------------------------------
     Incoming Offer
  --------------------------------------------------- */
  async handleOffer(data) {
    const { from, offer, fromName, audioOnly, fromUser } = data || {};
    if (!from || !offer) {
      console.warn("[WebRTC] handleOffer: invalid data", data);
      return;
    }

    const displayName =
      fromUser?.fullname || fromName || `User ${from}`;

    rtcState.peerId = from;
    rtcState.peerName = displayName;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;
    rtcState.inCall = false;
    rtcState.incomingOffer = data;
    rtcState.usedRelayFallback = false;

    ringtone?.play().catch(() => {});
    this.onIncomingCall?.({ fromName: rtcState.peerName, audioOnly: !!audioOnly });
  }

  /* ---------------------------------------------------
     Answer Incoming Call
  --------------------------------------------------- */
  async answerIncomingCall() {
    const offerData = rtcState.incomingOffer;
    if (!offerData || !offerData.offer || !offerData.from) {
      console.warn("[WebRTC] answerIncomingCall: no stored offer");
      return;
    }

    const { from, offer, audioOnly } = offerData;

    rtcState.inCall = true;
    rtcState.audioOnly = !!audioOnly;

    startTimer();
    stopAudio(ringtone);

    const pc = await this._createPC({ relayOnly: false });

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    await this._flushPendingRemoteCandidates();

    const stream = await getLocalMedia(true, !rtcState.audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      if (this.localVideo && !rtcState.audioOnly) {
        this.localVideo.srcObject = stream;
        this.localVideo.muted = true;
        this.localVideo.playsInline = true;
        this.localVideo.play().catch(() => {});
      }
    } else {
      console.warn("[WebRTC] No local media stream on answer");
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.socket.emit("webrtc:signal", {
      type: "answer",
      to: from,
      from: getMyUserId(),
      answer,
    });

    rtcState.incomingOffer = null;

    this.onCallConnected?.();
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
  }

  /* ---------------------------------------------------
     Remote Answer
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
      console.warn("[WebRTC] handleAnswer: ignoring answer because we are not the caller");
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

    await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));

    await this._flushPendingRemoteCandidates();

    stopAudio(ringback);
    this.onCallConnected?.();
    startTimer();
  }

  /* ---------------------------------------------------
     ICE Candidate
  --------------------------------------------------- */
  async handleRemoteIceCandidate(data) {
    if (!data || !data.candidate) return;

    if (!this.pc || !this.pc.remoteDescription) {
      console.log("[ICE] Queuing remote candidate (no PC/remoteDescription yet):", data.candidate);
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
   Remote End
--------------------------------------------------- */
handleRemoteEnd() {
  if (rtcState.answering) {
    console.warn("[WebRTC] handleRemoteEnd: ignoring remote end during answer window");
    return;
  }
  this.endCall(false);
}

/* ---------------------------------------------------
   End Call (FULL UPDATED VERSION)
--------------------------------------------------- */
endCall(local = true) {
  // Stop call audio
  stopAudio(ringback);
  stopAudio(ringtone);
  stopTimer();

  /* ---------------------------------------------------
     STOP VOICEMAIL CUES
  --------------------------------------------------- */
  try {
    this._unreachableTone?.pause();
    this._unreachableTone = null;

    this._beepTone?.pause();
    this._beepTone = null;
  } catch {}

  /* ---------------------------------------------------
     CLOSE VOICEMAIL UI
  --------------------------------------------------- */
  try {
    const vmModal = document.getElementById("voicemailModal");
    if (vmModal) vmModal.classList.add("hidden");
  } catch {}

  /* ---------------------------------------------------
     STOP VOICEMAIL RECORDER (if active)
  --------------------------------------------------- */
  try {
    if (window._vmRecorderStream) {
      window._vmRecorderStream.getTracks().forEach(t => t.stop());
      window._vmRecorderStream = null;
    }
    if (window._vmMediaRecorder && window._vmMediaRecorder.state !== "inactive") {
      window._vmMediaRecorder.stop();
    }
  } catch {}

  /* ---------------------------------------------------
     STOP SCREEN SHARE (if active)
  --------------------------------------------------- */
  try {
    if (this._screenShareStream) {
      this._screenShareStream.getTracks().forEach(t => t.stop());
      this._screenShareStream = null;
    }
    this._originalVideoTrack = null;
  } catch {}

  const peerId = rtcState.peerId;

  /* ---------------------------------------------------
     CLOSE PEER CONNECTION
  --------------------------------------------------- */
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

  /* ---------------------------------------------------
     STOP LOCAL STREAM
  --------------------------------------------------- */
  if (this.localStream) {
    this.localStream.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    this.localStream = null;
  }

  if (rtcState.localStream) {
    rtcState.localStream.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    rtcState.localStream = null;
  }

  /* ---------------------------------------------------
     STOP REMOTE STREAM
  --------------------------------------------------- */
  if (rtcState.remoteStream) {
    rtcState.remoteStream.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    rtcState.remoteStream = null;
  }

  /* ---------------------------------------------------
     CLEAR MEDIA ELEMENTS
  --------------------------------------------------- */
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");
  const remoteAudioEl = document.getElementById("remoteAudio");

  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  if (remoteAudioEl) remoteAudioEl.srcObject = null;

  /* ---------------------------------------------------
     LOG CALL
  --------------------------------------------------- */
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

  /* ---------------------------------------------------
     RESET STATE
  --------------------------------------------------- */
  rtcState.inCall = false;
  rtcState.peerId = null;
  rtcState.incomingOffer = null;
  rtcState.answering = false;

  /* ---------------------------------------------------
     SEND END SIGNAL
  --------------------------------------------------- */
  if (local && peerId && this.socket) {
    this.socket.emit("webrtc:signal", {
      type: "end",
      to: peerId,
      from: getMyUserId(),
      reason: "hangup",
    });
  }

  /* ---------------------------------------------------
     UI CALLBACK
  --------------------------------------------------- */
  this.onCallEnded?.();
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

    return !newEnabled;
  }

  /* ---------------------------------------------------
     Camera toggle
  --------------------------------------------------- */
  switchCamera() {
    const stream = this.localStream || rtcState.localStream;
    if (!stream) {
      console.warn("[WebRTC] switchCamera: no local stream");
      return;
    }

    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) return;

    const enabled = videoTracks.some((t) => t.enabled);
    const newEnabled = !enabled;

    videoTracks.forEach((t) => {
      t.enabled = newEnabled;
    });

    if (newEnabled) {
      this.onRemoteCameraOn?.(); // local camera on (UI can treat as "self camera on")
    } else {
      this.onRemoteCameraOff?.();
    }
  }

  /* ---------------------------------------------------
     PeerConnection Factory (TURN‑enabled, relay fallback)
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

    /* TURN keep‑alive */
    const startTurnKeepAlive = (pcInstance) => {
      let keepAliveTimer = setInterval(() => {
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

    /* DataChannel keep‑alive */
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

    /* OUTGOING ICE CANDIDATES */
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
        });
      }
    };

    /* REMOTE TRACKS */
    pc.ontrack = (event) => {
      attachRemoteTrack(event);

      if (event.track.kind === "video" && this.remoteVideo) {
        this.remoteVideo.srcObject = event.streams[0];
        this.remoteVideo.playsInline = true;
        this.remoteVideo.play().catch(() => {});
        event.track.onmute = () => {
          this.onRemoteCameraOff?.();
        };
        event.track.onunmute = () => {
          this.onRemoteCameraOn?.();
        };
      }

      if (event.track.kind === "audio" && this.remoteAudio) {
        try {
          this.remoteAudio.srcObject = event.streams[0];
          this.remoteAudio.playsInline = true;
          this.remoteAudio.muted = false;
          this.remoteAudio.play().catch(() => {
            console.warn("[WebRTC] Autoplay blocked for remote audio");
          });
        } catch (err) {
          console.warn("[WebRTC] Error attaching remote audio:", err);
        }

        event.track.onmute = () => {
          this.onNetworkQuality?.("fair", "Remote audio muted");
          this.onRemoteMuted?.();
          this.onRemoteSpeaking?.(false);
        };
        event.track.onunmute = () => {
          this.onNetworkQuality?.("good", "Remote audio active");
          this.onRemoteUnmuted?.();
          this.onRemoteSpeaking?.(true);
        };
        event.track.onended = () => {
          this.onNetworkQuality?.("poor", "Remote audio ended");
          this.onRemoteSpeaking?.(false);
        };
      }
    };

    /* ICE STATE → QUALITY + RECOVERY */
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
        console.log("[WebRTC] ICE state change ignored during answer window:", state);
        return;
      }

      if (state === "disconnected") {
        console.warn("[WebRTC] Disconnected — attempting ICE restart");
        try {
          pc.restartIce();
        } catch (err) {
          console.warn("[WebRTC] ICE restart failed:", err);
        }
      }

      if (state === "checking") {
        setTimeout(() => {
          if (
            pc.iceConnectionState === "checking" &&
            !rtcState.usedRelayFallback &&
            rtcState.peerId &&
            !rtcState.answering
          ) {
            console.warn("[WebRTC] Stuck in checking — forcing relay-only fallback");
            rtcState.usedRelayFallback = true;

            const peerId = rtcState.peerId;
            const audioOnly = rtcState.audioOnly;
            const isCaller = rtcState.isCaller;

            this.endCall(false);

            if (isCaller) {
              this._startCallInternal(peerId, audioOnly, { relayOnly: true });
            }
          }
        }, 2500);
      }

      if (state === "disconnected") {
        setTimeout(() => {
          if (
            pc.iceConnectionState === "disconnected" &&
            !rtcState.usedRelayFallback &&
            rtcState.peerId &&
            !rtcState.answering
          ) {
            console.warn("[WebRTC] Mobile network disconnected — forcing relay-only fallback");
            rtcState.usedRelayFallback = true;

            const peerId = rtcState.peerId;
            const audioOnly = rtcState.audioOnly;
            const isCaller = rtcState.isCaller;

            this.endCall(false);

            if (isCaller) {
              this._startCallInternal(peerId, audioOnly, { relayOnly: true });
            }
          }
        }, 1500);
      }

      if (state === "failed") {
        if (!rtcState.usedRelayFallback && rtcState.peerId && !rtcState.answering) {
          console.warn("[WebRTC] ICE failed — retrying with relay-only…");
          rtcState.usedRelayFallback = true;

          const peerId = rtcState.peerId;
          const audioOnly = rtcState.audioOnly;
          const isCaller = rtcState.isCaller;

          this.endCall(false);

          if (isCaller) {
            this._startCallInternal(peerId, audioOnly, { relayOnly: true });
          }
        } else if (!rtcState.answering) {
          this.onCallFailed?.("ice failed");
        }
      }
    };

    /* CONNECTION STATE */
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("[WebRTC] connectionState:", state);

      if (state === "failed") {
        this.onCallFailed?.("connection failed");
      }
    };

    return pc;
  }

  /* ---------------------------------------------------
     Flush queued remote ICE
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

    /* CORE SIGNALING */
    this.socket.on("webrtc:signal", async (data) => {
      if (!data || !data.type) return;

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

    /* CALL RESTORE */
    this.socket.on("call:restore", ({ callerId, receiverId, status }) => {
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
      });

      rtcState.peerId = peerId;
      rtcState.isCaller = isCaller;
      rtcState.inCall = status === "active";

      if (status === "active") {
        this.onCallConnected?.();
      } else if (isCaller) {
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

      if (isCaller) {
        this._resumeAsCallerAfterRestore(peerId);
      }
    });

/* -------------------------------------------------------
   VOICEMAIL + DECLINE + TIMEOUT + MISSED + DND
------------------------------------------------------- */

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

/* -------------------------------------------------------
   FIXED: Proper voicemail trigger function
------------------------------------------------------- */
const triggerVoicemailFlow = (from, message) => {
  stopAudio(ringback);

  this.onVoicemailPrompt?.({
    peerId: from,
    message
  });

  playUnreachableTone();
  setTimeout(() => playBeepTone(), 1200);

setTimeout(() => {
  this.onVoicemailPrompt?.({
    peerId: from,
    message
  });
}, 1500);

};


/* -------------------------------------------------------
   SOCKET EVENTS
------------------------------------------------------- */

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
  triggerVoicemailFlow(from, "User is in Do Not Disturb. Leave a voicemail…");
});

this.socket.on("call:voicemail", ({ from, reason }) => {
  console.log("[WebRTC] call:voicemail from", from, "reason:", reason);

  const msg =
    reason === "callee-dnd"
      ? "User is in Do Not Disturb. Leave a voicemail…"
      : "Leave a voicemail…";

  triggerVoicemailFlow(from, msg);
});

/* -------------------------------------------------------
   DISCONNECT CLEANUP
------------------------------------------------------- */
this.socket.on("disconnect", () => {
  if (rtcState.inCall) {
    this.endCall(false);
  }
});

  }
}



















































