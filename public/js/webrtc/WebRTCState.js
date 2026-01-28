// public/js/webrtc/WebRTCState.js
// Premium, centralized WebRTC state container with robust teardown,
// defensive guards, and expressive state transitions.

export const rtcState = {
  /* ---------------------------------------------------
     Peer / Identity
  --------------------------------------------------- */
  peerId: null,
  peerName: null,

  /* ---------------------------------------------------
     Call State
  --------------------------------------------------- */
  inCall: false,
  isCaller: false,
  audioOnly: false,
  incomingOffer: null,
  callEstablished: false, // true once both sides exchange SDP

  /* ---------------------------------------------------
     Media Streams
  --------------------------------------------------- */
  localStream: null,
  remoteStream: null,

  /* ---------------------------------------------------
     Timer
  --------------------------------------------------- */
  callTimerSeconds: 0,
  callTimerInterval: null,

  /* ---------------------------------------------------
     Logging Helper
  --------------------------------------------------- */
  log(...args) {
    console.log("[rtcState]", ...args);
  },

  /* ---------------------------------------------------
     Peer Assignment
  --------------------------------------------------- */
  setPeer(id, name = null) {
    this.peerId = id ?? null;
    this.peerName = name ?? null;
    this.log("Peer set:", { id: this.peerId, name: this.peerName });
  },

  /* ---------------------------------------------------
     Call State Mutators
  --------------------------------------------------- */
setCallState(state = {}) {
  if (typeof state !== "object" || state === null) {
    this.log("setCallState ignored invalid input:", state);
    return;
  }

  const { inCall, isCaller, audioOnly, incomingOffer } = state;

  if (inCall !== undefined) this.inCall = inCall;
  if (isCaller !== undefined) this.isCaller = isCaller;
  if (audioOnly !== undefined) this.audioOnly = audioOnly;
  if (incomingOffer !== undefined) this.incomingOffer = incomingOffer;

  this.log("Call state updated:", {
    inCall: this.inCall,
    isCaller: this.isCaller,
    audioOnly: this.audioOnly,
    incomingOffer: this.incomingOffer,
  });
},

  markCallEstablished() {
    this.callEstablished = true;
    this.log("Call established");
  },

  /* ---------------------------------------------------
     Media Reset
  --------------------------------------------------- */
  resetMedia() {
    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      console.warn("[rtcState] Error stopping local tracks:", err);
    }

    this.localStream = null;
    this.remoteStream = null;
    this.log("Media reset");
  },

  /* ---------------------------------------------------
     Timer Reset
  --------------------------------------------------- */
  resetTimer() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
    }
    this.callTimerInterval = null;
    this.callTimerSeconds = 0;
    this.log("Timer reset");
  },

  /* ---------------------------------------------------
     Call State Reset
  --------------------------------------------------- */
  resetCallState() {
    this.inCall = false;
    this.isCaller = false;
    this.audioOnly = false;
    this.incomingOffer = null;
    this.callEstablished = false;

    this.peerId = null;
    this.peerName = null;

    this.log("Call state reset");
  },

  /* ---------------------------------------------------
     Full Teardown
  --------------------------------------------------- */
  fullReset() {
    this.log("Performing full WebRTC teardown…");
    this.resetMedia();
    this.resetTimer();
    this.resetCallState();
  },

  /* ---------------------------------------------------
     Debug Snapshot
  --------------------------------------------------- */
  debug() {
    const snapshot = {
      peerId: this.peerId,
      peerName: this.peerName,
      inCall: this.inCall,
      isCaller: this.isCaller,
      audioOnly: this.audioOnly,
      incomingOffer: this.incomingOffer,
      callEstablished: this.callEstablished,
      hasLocalStream: !!this.localStream,
      hasRemoteStream: !!this.remoteStream,
      callTimerSeconds: this.callTimerSeconds,
    };

    this.log("State snapshot:", snapshot);
    return snapshot;
  },
};





