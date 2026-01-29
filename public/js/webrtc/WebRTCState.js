// public/js/webrtc/WebRTCState.js
// Premium, expressive WebRTC state machine with explicit phases,
// robust teardown, and traceable transitions.

export const rtcState = {
  /* ---------------------------------------------------
     Identity
  --------------------------------------------------- */
  peerId: null,
  peerName: null,

  /* ---------------------------------------------------
     Call Phases
     idle → ringing → connecting → active → ending
  --------------------------------------------------- */
  phase: "idle", // idle | ringing | connecting | active | ending

  /* ---------------------------------------------------
     Flags
  --------------------------------------------------- */
  isCaller: false,
  audioOnly: false,
  callEstablished: false,

  /* ---------------------------------------------------
     Signaling
  --------------------------------------------------- */
  incomingOffer: null,

  /* ---------------------------------------------------
     Media
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
     Phase Management
  --------------------------------------------------- */
  setPhase(newPhase) {
    if (!newPhase) return;
    this.phase = newPhase;
    this.log("Phase →", newPhase);
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

    const { isCaller, audioOnly, incomingOffer } = state;

    if (isCaller !== undefined) this.isCaller = isCaller;
    if (audioOnly !== undefined) this.audioOnly = audioOnly;
    if (incomingOffer !== undefined) this.incomingOffer = incomingOffer;

    this.log("Call state updated:", {
      phase: this.phase,
      isCaller: this.isCaller,
      audioOnly: this.audioOnly,
      incomingOffer: this.incomingOffer,
    });
  },

  markCallEstablished() {
    this.callEstablished = true;
    this.setPhase("active");
    this.log("Call established");
  },

  /* ---------------------------------------------------
     Media Reset
  --------------------------------------------------- */
  resetMedia() {
    try {
      if (this.localStream instanceof MediaStream) {
        this.localStream.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
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
     Full Call Reset
  --------------------------------------------------- */
  resetCallState() {
    this.phase = "idle";
    this.isCaller = false;
    this.audioOnly = false;
    this.callEstablished = false;
    this.incomingOffer = null;

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
      phase: this.phase,
      peerId: this.peerId,
      peerName: this.peerName,
      isCaller: this.isCaller,
      audioOnly: this.audioOnly,
      callEstablished: this.callEstablished,
      incomingOffer: this.incomingOffer,
      hasLocalStream: !!this.localStream,
      hasRemoteStream: !!this.remoteStream,
      callTimerSeconds: this.callTimerSeconds,
    };

    this.log("State snapshot:", snapshot);
    return snapshot;
  },
};








