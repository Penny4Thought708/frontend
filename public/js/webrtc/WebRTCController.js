// public/js/webrtc/WebRTCController.js

import { rtcState } from "./WebRTCState.js";
import {
  applyAvatar,
  showAvatar,
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
  localWrapper,
  remoteWrapper,
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

function hide(el) {
  if (el) el.style.display = "none";
}

function show(el, type = "flex") {
  if (el) el.style.display = type;
}

/**
 * 400ms opacity + slight scale fade-in.
 * Used for BOTH local and remote video.
 */
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
   UI Engine — matches neon / voice+video modes
------------------------------------------------------- */

const UI = {
  apply(state, opts = {}) {
    const { audioOnly = false, callerName = "" } = opts;

    const videoContainer = document.getElementById("video-container");
    const messagingBox = document.getElementById("messaging_box");
    const callControls = document.getElementById("call-controls");
    const callerOverlay = document.getElementById("callerOverlay");
    const answerBtn = document.getElementById("answer-call");
    const declineBtn = document.getElementById("decline-call");
    const endBtn = document.getElementById("end-call");
    const camBtn = document.getElementById("camera-toggle");
    const callStatusEl = document.getElementById("call-status");

    // Status text
    if (callStatusEl) {
      switch (state) {
        case "incoming":
          callStatusEl.textContent = "Incoming call…";
          break;
        case "outgoing":
          callStatusEl.textContent = "Calling…";
          break;
        case "active":
          callStatusEl.textContent = "Connected";
          break;
        case "ending":
          callStatusEl.textContent = "Call ended";
          break;
        case "idle":
        default:
          callStatusEl.textContent = "Ready";
          break;
      }
    }

    if (!videoContainer || !messagingBox || !callControls) {
      console.warn("[WebRTC UI] Missing core elements");
      return;
    }

    // Reset core visual state
    callControls.classList.remove("active");
    videoContainer.classList.remove("active", "voice-mode", "video-mode");
    hide(answerBtn);
    hide(declineBtn);
    hide(endBtn);
    hide(camBtn);
    hide(callerOverlay);

    // IDLE → messaging visible, call UI reset
    if (state === "idle") {
      messagingBox.style.opacity = "1";
      messagingBox.style.pointerEvents = "auto";

      // Messaging avatars (local + remote) via wrapper system
      applyAvatar(localWrapper, getMyAvatar(), getMyFullname());
      showAvatar(localWrapper);

      applyAvatar(remoteWrapper, null, "");
      showAvatar(remoteWrapper);

      // Call UI: ensure local avatar visible, videos hidden
      const localAvatar = document.getElementById("localAvatar");
      const remoteAvatar = document.getElementById("remoteAvatar");
      const localVideo = document.getElementById("localVideo");
      const remoteVideo = document.getElementById("remoteVideo");

      if (localAvatar) localAvatar.style.display = "flex";
      if (remoteAvatar) remoteAvatar.style.display = "flex";
      if (localVideo) {
        localVideo.style.display = "none";
        localVideo.style.opacity = "0";
      }
      if (remoteVideo) {
        remoteVideo.style.display = "none";
        remoteVideo.style.opacity = "0";
      }

      return;
    }

    // NON-IDLE → hide messaging panel instantly
    messagingBox.style.opacity = "0";
    messagingBox.style.pointerEvents = "none";

    // Show video container in voice/video mode
    videoContainer.classList.add("active");
    videoContainer.classList.add(audioOnly ? "voice-mode" : "video-mode");

    switch (state) {
      case "incoming":
        callControls.classList.add("active");

        show(answerBtn, "inline-flex");
        show(declineBtn, "inline-flex");
        hide(endBtn);
        hide(camBtn);

        if (callerOverlay) {
          callerOverlay.style.display = "flex";
          callerOverlay.textContent = callerName
            ? `Incoming call from ${callerName}...`
            : "Incoming call...";
        }
        break;

      case "outgoing":
        callControls.classList.add("active");
        show(endBtn, "inline-flex");
        if (!audioOnly) show(camBtn, "inline-flex");
        break;

      case "active":
        callControls.classList.add("active");
        show(endBtn, "inline-flex");
        if (!audioOnly) show(camBtn, "inline-flex");
        break;

      case "ending":
        videoContainer.classList.remove("active");
        break;
    }
  },
};

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

    this.onIncomingCall = null;
    this.onCallStarted = null;
    this.onCallEnded = null;
    this.onCallFailed = null;
    this.onQualityChange = null;

    UI.apply("idle");
    this._bindSocketEvents();

    // Initialize local avatar in call UI
    setLocalAvatar(getMyAvatar());
    showLocalAvatar();
    this._initDraggableRemote?.();
    this._bindSwapBehavior?.();
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

    UI.apply("outgoing", { audioOnly });

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
      console.warn("[WebRTC] No local media stream; proceeding with no mic/camera");
      showLocalAvatar();
    }

    if (audioOnly) {
      const remoteWrapperEl = document.getElementById("remoteWrapper");
      if (remoteWrapperEl) {
        remoteWrapperEl.style.left = "";
        remoteWrapperEl.style.top = "";
        remoteWrapperEl.style.right = "";
        remoteWrapperEl.style.bottom = "";
      }
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

  /* ---------------------------------------------------
     Incoming Offer
  --------------------------------------------------- */
  async handleOffer(data) {
    const { from, offer, fromName, audioOnly, fromUser } = data || {};
    if (!from || !offer) {
      console.warn("[WebRTC] handleOffer: invalid data", data);
      return;
    }

    // Guard: if already in a call, ignore new offers
    if (rtcState.inCall && this.pc) {
      console.warn("[WebRTC] handleOffer: ignoring offer, already in call");
      return;
    }

    const displayName = fromUser?.fullname || fromName || `User ${from}`;

    rtcState.peerId = from;
    rtcState.peerName = displayName;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;
    rtcState.inCall = false;
    rtcState.incomingOffer = data;
    rtcState.usedRelayFallback = false;

    if (fromUser?.avatar) {
      setRemoteAvatar(fromUser.avatar);
      showRemoteAvatar();
    }

    UI.apply("incoming", {
      audioOnly: rtcState.audioOnly,
      callerName: rtcState.peerName,
    });

    ringtone?.play().catch(() => {});
    this.onIncomingCall?.({ fromName: rtcState.peerName });
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

    // Now that remoteDescription is set, flush any queued ICE
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
      console.warn("[WebRTC] No local media stream on answer; proceeding with no mic/camera");
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

    UI.apply("active", { audioOnly: rtcState.audioOnly });
    this.onCallStarted?.();
  }

  /* ---------------------------------------------------
     Decline incoming call
  --------------------------------------------------- */
  declineIncomingCall() {
    const offerData = rtcState.incomingOffer;
    if (!offerData || !offerData.from) {
      console.warn("[WebRTC] declineIncomingCall: no stored offer");
      UI.apply("idle");
      return;
    }

    const { from } = offerData;

    addCallLogEntry({
      logId: Date.now(),
      caller_id: from,
      receiver_id: getMyUserId(),
      caller_name: rtcState.peerName || `User ${from}`,
      receiver_name: getMyFullname(),
      call_type: rtcState.audioOnly ? "voice" : "video",
      direction: "incoming",
      status: "rejected",
      duration: 0,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit("webrtc:signal", {
      type: "end",
      to: from,
      from: getMyUserId(),
      reason: "rejected",
    });

    rtcState.incomingOffer = null;
    rtcState.inCall = false;

    UI.apply("idle");
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

    // Only the original caller should ever process an answer
    if (!rtcState.isCaller) {
      console.warn("[WebRTC] handleAnswer: ignoring answer because we are not the caller");
      return;
    }

    // Only accept the first answer, in the correct state
    if (this.pc.signalingState !== "have-local-offer") {
      console.warn(
        "[WebRTC] handleAnswer: ignoring duplicate/late answer, state =",
        this.pc.signalingState
      );
      return;
    }

    console.log("[WebRTC] handleAnswer: applying remote answer");
    await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));

    // Now that remoteDescription is set, flush any queued ICE
    await this._flushPendingRemoteCandidates();

    stopAudio(ringback);
    this.onCallStarted?.();
    startTimer();
  }

  /* ---------------------------------------------------
     ICE Candidate
  --------------------------------------------------- */
  async handleRemoteIceCandidate(data) {
    if (!data || !data.candidate) return;

    // If PC not ready yet, or remoteDescription not set, queue the candidate
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
     Remote End
  --------------------------------------------------- */
  handleRemoteEnd() {
    this.endCall(false);
  }

  /* End Call */
  endCall(local = true) {
    stopAudio(ringback);
    stopAudio(ringtone);
    stopTimer();

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

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      this.localStream = null;
    }

    const remoteWrapperEl = document.getElementById("remoteWrapper");
    if (remoteWrapperEl) {
      remoteWrapperEl.style.left = "";
      remoteWrapperEl.style.top = "";
      remoteWrapperEl.style.right = "";
      remoteWrapperEl.style.bottom = "";
    }

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

    showLocalAvatar();
    showRemoteAvatar();

    const localVideo = document.getElementById("localVideo");
    const remoteVideo = document.getElementById("remoteVideo");
    if (localVideo) {
      localVideo.style.display = "none";
      localVideo.style.opacity = "0";
    }
    if (remoteVideo) {
      remoteVideo.style.display = "none";
      remoteVideo.style.opacity = "0";
    }

    UI.apply("ending");
    setTimeout(() => UI.apply("idle"), 200);

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
     Mute toggle (for CallUI mute button)
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
     Camera toggle / switch (for CallUI camera button)
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
     PeerConnection Factory (TURN‑enabled, relay fallback)
  --------------------------------------------------- */
  async _createPC({ relayOnly = false } = {}) {
    // Close old PC if it exists
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    const iceServers = await getIceServers({ relayOnly });

    const config = {
      iceServers,
      iceTransportPolicy: relayOnly ? "relay" : "all",
    };

    console.log("[WebRTC] Creating RTCPeerConnection with config:", config);

    const pc = new RTCPeerConnection(config);
    this.pc = pc;

    /* ---------------------------------------------------
       OUTGOING ICE CANDIDATES
    --------------------------------------------------- */
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      console.log("[ICE] Local candidate:", event.candidate);

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
       REMOTE TRACKS (video + audio autoplay-safe)
    --------------------------------------------------- */
    pc.ontrack = (event) => {
      attachRemoteTrack(event);

      if (event.track.kind === "video") {
        showRemoteVideo();
        fadeInVideo(this.remoteVideo);
      }

      if (event.track.kind === "audio" && this.remoteAudio) {
        try {
          this.remoteAudio.srcObject = event.streams[0];
          this.remoteAudio
            .play()
            .catch(() => console.warn("[WebRTC] Autoplay blocked for remote audio"));
        } catch (err) {
          console.warn("[WebRTC] Error attaching remote audio:", err);
        }
      }

      event.track.onmute = () => {
        this.onQualityChange?.("fair", "Remote track muted");
      };
      event.track.onunmute = () => {
        this.onQualityChange?.("good", "Remote track active");
      };
      event.track.onended = () => {
        this.onQualityChange?.("poor", "Remote track ended");
      };
    };

   /* ---------------------------------------------------
   ICE STATE → QUALITY + MOBILE‑SAFE RECOVERY
--------------------------------------------------- */
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

  this.onQualityChange?.(level, `ICE: ${state}`);

  /* ---------------------------------------------------
     MOBILE NETWORK FIX:
     Treat long "checking" or "disconnected" as failure
  --------------------------------------------------- */
  if (state === "checking") {
    setTimeout(() => {
      if (
        pc.iceConnectionState === "checking" &&
        !rtcState.usedRelayFallback &&
        rtcState.peerId
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
        rtcState.peerId
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

  /* ---------------------------------------------------
     TRUE FAILURE → fallback or fail
  --------------------------------------------------- */
  if (state === "failed") {
    if (!rtcState.usedRelayFallback && rtcState.peerId) {
      console.warn("[WebRTC] ICE failed — retrying with relay-only…");
      rtcState.usedRelayFallback = true;

      const peerId = rtcState.peerId;
      const audioOnly = rtcState.audioOnly;
      const isCaller = rtcState.isCaller;

      this.endCall(false);

      if (isCaller) {
        this._startCallInternal(peerId, audioOnly, { relayOnly: true });
      }
    } else {
      this.onCallFailed?.("ice failed");
    }
  }
};

  /* ---------------------------------------------------
     Flush queued remote ICE (after remoteDescription set)
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
          UI.apply("ending");
          try {
            const busyTone = new Audio("/NewApp/busy.mp3");
            busyTone.play().catch(() => {});
          } catch {}
          setTimeout(() => UI.apply("idle"), 800);
          this.onCallFailed?.("busy");
          break;
        default:
          break;
      }
    });

    this.socket.on("call:voicemail", ({ to, reason }) => {
      stopAudio(ringback);

      UI.apply("ending");

      const overlay = document.getElementById("callerOverlay");
      if (overlay) {
        overlay.style.display = "flex";
        overlay.textContent =
          reason === "callee-dnd"
            ? "User is in Do Not Disturb. Leave a voicemail…"
            : "Leave a voicemail…";
      }

      if (window.openVoicemailRecorder) {
        window.openVoicemailRecorder(to);
      }

      setTimeout(() => UI.apply("idle"), 1500);
    });

    this.socket.on("disconnect", () => {
      if (rtcState.inCall) {
        this.endCall(false);
      }
    });
  }

  _initDraggableRemote() {
    const wrapper = document.getElementById("remoteWrapper");
    const container = document.getElementById("video-container");
    if (!wrapper || !container) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMouseDown = (e) => {
      if (!container.classList.contains("video-mode")) return;

      isDragging = true;
      wrapper.classList.add("dragging");

      const rect = wrapper.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left - containerRect.left;
      startTop = rect.top - containerRect.top;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;

      const containerRect = container.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      const maxLeft = containerRect.width - wrapperRect.width;
      const maxTop = containerRect.height - wrapperRect.height;

      if (newLeft < 0) newLeft = 0;
      if (newTop < 0) newTop = 0;
      if (newLeft > maxLeft) newLeft = maxLeft;
      if (newTop > maxTop) newTop = maxTop;

      wrapper.style.left = `${newLeft}px`;
      wrapper.style.top = `${newTop}px`;
      wrapper.style.right = "auto";
      wrapper.style.bottom = "auto";
    };

    const onMouseUp = () => {
      isDragging = false;
      wrapper.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    wrapper.addEventListener("mousedown", onMouseDown);
  }

  _bindSwapBehavior() {
    const container = document.getElementById("video-container");
    const remoteWrapper = document.getElementById("remoteWrapper");
    const localWrapper = document.getElementById("localVideoWrapper");
    if (!container || !remoteWrapper || !localWrapper) return;

    const toggleSwap = () => {
      container.classList.toggle("swap-layout");
    };

    remoteWrapper.addEventListener("dblclick", toggleSwap);
    localWrapper.addEventListener("dblclick", toggleSwap);
  }
}


























