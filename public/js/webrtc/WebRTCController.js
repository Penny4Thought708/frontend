// public/js/webrtc/WebRTCController.js
// Premium WebRTC controller: signaling, media, UI, timers, logs, and UX polish.

import { rtcState } from "./WebRTCState.js";
import { socket } from "../socket.js";

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
   Small helpers
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
  /**
   * Apply a high-level call UI state.
   * state: "idle" | "incoming" | "outgoing" | "active" | "ending"
   * opts: { audioOnly?: boolean, callerName?: string }
   */
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
  constructor(socketInstance) {
    this.socket = socketInstance;
    this.pc = null;
    this.localStream = null;

    this.localVideo = null;
    this.remoteVideo = null;
    this.remoteAudio = null;

    // CallUI hooks
    this.onIncomingCall = null;
    this.onCallStarted = null;
    this.onCallEnded = null;
    this.onCallFailed = null;
    this.onQualityChange = null;

    // Initial UI state
    UI.apply("idle");

    // Wire socket events
    this._bindSocketEvents();

    // Initialize local avatar in call UI
    setLocalAvatar(getMyAvatar());
    showLocalAvatar();

    // Premium UX behaviors
    this._initDraggableRemote();
    this._bindSwapBehavior();
  }

  /* ---------------------------------------------------
     Media elements wiring (from CallUI)
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
    this.startCall(peerId, true);
  }

  startVideoCall() {
    const peerId = getReceiver();
    if (!peerId) {
      console.warn("[WebRTC] startVideoCall: no receiver selected");
      return;
    }
    this.startCall(peerId, false);
  }

  /* ---------------------------------------------------
     Outgoing Call
  --------------------------------------------------- */
  async startCall(peerId, audioOnly) {
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

    UI.apply("outgoing", { audioOnly });

    const pc = await this._createPC();

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
      console.warn(
        "[WebRTC] No local media stream; proceeding with no mic/camera"
      );
      showLocalAvatar();
    }

    // Voice mode: reset remote wrapper position
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

    const displayName =
      fromUser?.fullname || fromName || `User ${from}`;

    rtcState.peerId = from;
    rtcState.peerName = displayName;
    rtcState.audioOnly = !!audioOnly;
    rtcState.isCaller = false;
    rtcState.inCall = false;
    rtcState.incomingOffer = data;

    if (fromUser?.avatar) {
      setRemoteAvatar(fromUser.avatar);
      showRemoteAvatar();
    }

    UI.apply("incoming", {
      audioOnly: rtcState.audioOnly,
      callerName: rtcState.peerName,
    });

    ringtone?.play().catch(() => {});
    this.onIncomingCall?.({ fromName: rtcState.peerName, audioOnly });
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

    const pc = await this._createPC();

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

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
      console.warn("[WebRTC] No local media stream on answer");
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

    await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));

    stopAudio(ringback);
    this.onCallStarted?.();
    startTimer();
  }

  /* ---------------------------------------------------
     ICE Candidate
  --------------------------------------------------- */
  async handleRemoteIceCandidate(data) {
    if (!this.pc || !data || !data.candidate) return;

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

  /* ---------------------------------------------------
     End Call (local or remote)
  --------------------------------------------------- */
  endCall(local = true) {
    stopAudio(ringback);
    stopAudio(ringtone);
    stopTimer();

    const peerId = rtcState.peerId;

    // Tear down PeerConnection
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

    // Stop local media
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      this.localStream = null;
    }

    // Reset remote wrapper position
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

    // Return "muted" boolean for UI
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
     PeerConnection Factory (TURN‑enabled)
  --------------------------------------------------- */
  async _createPC() {
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
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
      attachRemoteTrack(event);
      if (event.track.kind === "video") {
        showRemoteVideo();
        fadeInVideo(this.remoteVideo);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      console.log("[WebRTC] iceConnectionState:", s);
      if (s === "failed" || s === "disconnected") {
        this.onCallFailed?.(s);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] connectionState:", pc.connectionState);
      if (pc.connectionState === "failed") {
        this.onCallFailed?.("connection failed");
      }
    };

    this.pc = pc;
    return pc;
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

      // Enrich peer identity + avatar if provided
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
          await this.handleRemoteIceCandidate(data);
          break;
        case "end":
          this.handleRemoteEnd();
          break;
        case "busy":
          stopAudio(ringback);
          UI.apply("ending");
          try {
            const busyTone = new Audio("busy.mp3");
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

  /* ---------------------------------------------------
     Draggable Remote Video (Video Mode Only)
  --------------------------------------------------- */
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
      // Only draggable in VIDEO MODE
      if (!container.classList.contains("video-mode")) return;

      isDragging = true;
      wrapper.classList.add("dragging");
      wrapper.style.transition = "none";

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

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      wrapper.style.left = `${newLeft}px`;
      wrapper.style.top = `${newTop}px`;
      wrapper.style.right = "auto";
      wrapper.style.bottom = "auto";
    };

    const onMouseUp = () => {
      if (!isDragging) return;

      isDragging = false;
      wrapper.classList.remove("dragging");
      wrapper.style.transition = "transform 0.15s ease";

      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    wrapper.addEventListener("mousedown", onMouseDown);
  }

  /* ---------------------------------------------------
     Swap Local/Remote Video (Double‑Click)
  --------------------------------------------------- */
  _bindSwapBehavior() {
    const container = document.getElementById("video-container");
    const remoteWrapperEl = document.getElementById("remoteWrapper");
    const localWrapperEl = document.getElementById("localVideoWrapper");
    if (!container || !remoteWrapperEl || !localWrapperEl) return;

    const toggleSwap = () => {
      container.classList.toggle("swap-layout");
    };

    remoteWrapperEl.addEventListener("dblclick", toggleSwap);
    localWrapperEl.addEventListener("dblclick", toggleSwap);
  }
}

/* -------------------------------------------------------
   Default instance (optional convenience)
------------------------------------------------------- */

export const rtc = new WebRTCController(socket);








