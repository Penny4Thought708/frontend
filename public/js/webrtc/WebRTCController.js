// public/js/webrtc/WebRTCController.js

import { rtcState } from "./WebRTCState.js";
rtcState.answering = false;

import {
  setRemoteAvatar,
  setLocalAvatar,
  showRemoteAvatar,
  showLocalAvatar,
  showRemoteVideo,
  showLocalVideo,
} from "./AvatarFallback.js";

import { getLocalMedia, attachRemoteTrack } from "./WebRTCMedia.js";
import { addCallLogEntry } from "../call-log.js";

import {
  getMyUserId,
  getMyFullname,
  getMyAvatar,
  ringback,
  ringtone,
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

function fadeInVideo(el) {
  if (!el) return;
  el.style.opacity = "0";
  el.style.transform = "scale(0.96)";
  el.style.transition = "opacity 0.4s ease, transform 0.4s ease";
  el.style.display = "block";
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "scale(1)";
  });
}

/* -------------------------------------------------------
   Timer
------------------------------------------------------- */

const callTimerEl = document.getElementById("call-timer");

function startTimer() {
  if (!callTimerEl) return;
  if (rtcState.callTimerInterval) clearInterval(rtcState.callTimerInterval);

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
  if (rtcState.callTimerInterval) clearInterval(rtcState.callTimerInterval);
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

    this.onIncomingCall = null;
    this.onCallStarted = null;
    this.onCallEnded = null;
    this.onCallFailed = null;
    this.onQualityChange = null;

    this._bindSocketEvents();

    setLocalAvatar(getMyAvatar());
    showLocalAvatar();

    window.addEventListener("online", () => {
      if (this.pc) {
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
     Outgoing Call
  --------------------------------------------------- */
  async _startCallInternal(peerId, audioOnly, { relayOnly }) {
    const myId = getMyUserId();
    if (!myId) return;

    rtcState.peerId = peerId;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = true;
    rtcState.inCall = true;
    rtcState.incomingOffer = null;
    rtcState.usedRelayFallback = !!relayOnly;

    const pc = await this._createPC({ relayOnly });

    const stream = await getLocalMedia(true, !audioOnly);
    this.localStream = stream;
    rtcState.localStream = stream;

    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      if (this.localVideo && !audioOnly) {
        this.localVideo.srcObject = stream;
        showLocalVideo();
        fadeInVideo(this.localVideo);
      } else {
        showLocalAvatar();
      }
    } else {
      showLocalAvatar();
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
    if (!from || !offer) return;

    rtcState.peerId = from;
    rtcState.peerName = fromUser?.fullname || fromName || `User ${from}`;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;
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
     Answer Incoming Call
  --------------------------------------------------- */
  async answerIncomingCall() {
    const offerData = rtcState.incomingOffer;
    if (!offerData) return;

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
        showLocalVideo();
        fadeInVideo(this.localVideo);
      } else {
        showLocalAvatar();
      }
    } else {
      showLocalAvatar();
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

    this.onCallStarted?.();
  }

  /* ---------------------------------------------------
     Decline incoming call
  --------------------------------------------------- */
  declineIncomingCall() {
    const offerData = rtcState.incomingOffer;

    let callerId = offerData?.from || rtcState.currentCallerId;

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

    stopAudio(ringback);
    this.onCallStarted?.();
    startTimer();
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
    stopTimer();

    const peerId = rtcState.peerId;

    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    if (rtcState.localStream) {
      rtcState.localStream.getTracks().forEach((t) => t.stop());
      rtcState.localStream = null;
    }

    if (rtcState.remoteStream) {
      rtcState.remoteStream.getTracks().forEach((t) => t.stop());
      rtcState.remoteStream = null;
    }

    if (this.localVideo) {
      this.localVideo.srcObject = null;
      this.localVideo.style.display = "none";
      this.localVideo.style.opacity = "0";
    }

    if (this.remoteVideo) {
      this.remoteVideo.srcObject = null;
      this.remoteVideo.style.display = "none";
      this.remoteVideo.style.opacity = "0";
    }

    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
    }

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
     Camera toggle
  --------------------------------------------------- */
  switchCamera() {
    const stream = this.localStream || rtcState.localStream;
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) return;

    const enabled = videoTracks.some((t) => t.enabled);
    videoTracks.forEach((t) => (t.enabled = !enabled));

    if (!enabled) {
      showLocalVideo();
      fadeInVideo(this.localVideo);
    } else {
      showLocalAvatar();
      if (this.localVideo) {
        this.localVideo.style.display = "none";
        this.localVideo.style.opacity = "0";
      }
    }
  }

  /* ---------------------------------------------------
     PeerConnection Factory
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

    const pc = new RTCPeerConnection(config);
    this.pc = pc;

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

    pc.ontrack = (event) => {
      const peerId = rtcState.peerId || "remote";
      attachRemoteTrack(peerId, event);

      if (event.track.kind === "video") {
        showRemoteVideo();
        fadeInVideo(this.remoteVideo);
      }

      if (event.track.kind === "audio" && this.remoteAudio) {
        try {
          this.remoteAudio.srcObject = event.streams[0];
          this.remoteAudio.play().catch(() => {});
        } catch {}
      }
    };

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
        try {
          pc.restartIce();
        } catch {}
      }

      if (state === "checking") {
        setTimeout(() => {
          if (
            pc.iceConnectionState === "checking" &&
            !rtcState.usedRelayFallback &&
            rtcState.peerId &&
            !rtcState.answering
          ) {
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

      if (state === "failed") {
        if (!rtcState.usedRelayFallback && rtcState.peerId && !rtcState.answering) {
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

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
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

    /* -------------------------------------------------------
       CORE SIGNALING
    ------------------------------------------------------- */
    this.socket.on("webrtc:signal", async (data) => {
      if (!data || !data.type) return;

      if (data.fromUser) {
        const { avatar, fullname } = data.fromUser;

        if (avatar) {
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

    /* -------------------------------------------------------
       CALL RESTORE
    ------------------------------------------------------- */
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

      if (status === "active" && isCaller) {
        this._resumeAsCallerAfterRestore(peerId);
      }
    });

    /* -------------------------------------------------------
       VOICEMAIL + DECLINE + TIMEOUT + MISSED + DND
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

    const triggerVoicemailFlow = (from, message) => {
      stopAudio(ringback);

      playUnreachableTone();
      setTimeout(() => playBeepTone(), 1200);

      if (window.openVoicemailRecorder) {
        window.openVoicemailRecorder(from);
      }

      if (window.showUnavailableToastInternal) {
        window.showUnavailableToastInternal({
          peerId: from,
          message,
        });
      }
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

















































































































