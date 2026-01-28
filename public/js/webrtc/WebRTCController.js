// public/js/webrtc/WebRTCController.js
// Premium, production‑grade WebRTC controller

import { rtcState } from "./WebRTCState.js";
import { getLocalMedia, attachRemoteTrack } from "./WebRTCMedia.js";

// Global helpers (adjust path if needed)
import {
  getMyUserId,
  getMyFullname,
  getReceiver,
  getIceServers,
  addCallLogEntry,
  showLocalVideo,
  fadeInVideo,
  showLocalAvatar,
  showRemoteAvatar,
  showRemoteVideo,
  setRemoteAvatar,
  UI,
  ringtone,
  ringback,
  startTimer,
  stopTimer,
  stopAudio
} from "../globals.js";


export default class WebRTCController {
  constructor(socket) {
    this.socket = socket;
    this.pc = null;

    this.localVideo = null;
    this.remoteVideo = null;
    this.remoteAudio = null;
    this.localStream = null;

    this._bindSocketEvents();
    this._initDraggableRemote();
    this._bindSwapBehavior();
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
     Resolve peer ID
  --------------------------------------------------- */
  _resolvePeer(explicitPeerId) {
    const peerId =
      explicitPeerId ||
      getReceiver?.() ||
      window.currentReceiverId;

    if (!peerId) {
      console.warn("[WebRTC] No receiver selected", {
        explicitPeerId,
        getReceiver: getReceiver?.(),
        currentReceiverId: window.currentReceiverId
      });
      return null;
    }

    return String(peerId);
  }

  /* ---------------------------------------------------
     Start voice / video call
  --------------------------------------------------- */
  startVoiceCall(explicitPeerId) {
    const peerId = this._resolvePeer(explicitPeerId);
    if (!peerId) return;
    this.startCall(peerId, true);
  }

  startVideoCall(explicitPeerId) {
    const peerId = this._resolvePeer(explicitPeerId);
    if (!peerId) return;
    this.startCall(peerId, false);
  }

  /* ---------------------------------------------------
     Outgoing call
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
        this.localVideo.muted = true;
        this.localVideo.play().catch(() => {});
        showLocalVideo();
        fadeInVideo(this.localVideo);
      } else {
        showLocalAvatar();
      }
    } else {
      console.warn("[WebRTC] No local media stream");
      showLocalAvatar();
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.socket.emit("webrtc:signal", {
      type: "offer",
      to: peerId,
      from: myId,
      offer,
      audioOnly,
      fromName: getMyFullname()
    });

    ringback?.play().catch(() => {});
  }

  /* ---------------------------------------------------
     Incoming offer
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
      callerName: rtcState.peerName
    });

    ringtone?.play().catch(() => {});
    this.onIncomingCall?.({ fromName: rtcState.peerName, audioOnly });
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
        this.localVideo.muted = true;
        this.localVideo.play().catch(() => {});
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
      answer
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
      timestamp: new Date().toISOString()
    });

    this.socket.emit("webrtc:signal", {
      type: "end",
      to: from,
      from: getMyUserId(),
      reason: "rejected"
    });

    rtcState.incomingOffer = null;
    rtcState.inCall = false;

    UI.apply("idle");
    this.onCallEnded?.();
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

    await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));

    stopAudio(ringback);
    this.onCallStarted?.();
    startTimer();
  }

  /* ---------------------------------------------------
     ICE candidate
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
     Remote end
  --------------------------------------------------- */
  handleRemoteEnd() {
    this.endCall(false);
  }

  /* ---------------------------------------------------
     End call
  --------------------------------------------------- */
  endCall(local = true) {
    stopAudio(ringback);
    stopAudio(ringtone);
    stopTimer();

    const peerId = rtcState.peerId;

    // Close PC
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
    const stream = this.localStream || rtcState.localStream;
    if (stream) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    }
    this.localStream = null;
    rtcState.localStream = null;

    // Reset remote wrapper
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
      timestamp: new Date().toISOString()
    });

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
        reason: "hangup"
      });
    }

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
     Create PeerConnection
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
          candidate: event.candidate
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
     Draggable remote video
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

export const rtc = new WebRTCController(window.socket);








