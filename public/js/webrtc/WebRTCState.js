// public/js/webrtc/WebRTCState.js
// Production‑grade WebRTC state machine with explicit phases,
// relay fallback tracking, ICE restart guards, and full teardown safety.

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
  phase: "idle",
  lastPhase: null,

  /* ---------------------------------------------------
     Flags
  --------------------------------------------------- */
  isCaller: false,
  audioOnly: false,
  callEstablished: false,
  mediaReady: false,

  // Used by controller + voicemail logic
  inCall: false,     // true only once call is connected
  busy: false,       // true from ringing/connecting through active
  voiceOnly: false,  // UI-level audio-only mode

  /* ---------------------------------------------------
     Fallback + Recovery
  --------------------------------------------------- */
  usedRelayFallback: false,
  pendingIceRestart: false,

  /* ---------------------------------------------------
     Signaling
  --------------------------------------------------- */
  incomingOffer: null,
  callId: null,

  /* ---------------------------------------------------
     Media
  --------------------------------------------------- */
  localStream: null,
  remoteStream: null,
  remoteTracks: new Map(),

  /* ---------------------------------------------------
     Timer
  --------------------------------------------------- */
  callTimerSeconds: 0,
  callTimerInterval: null,

  /* ---------------------------------------------------
     Network Quality + Stats
  --------------------------------------------------- */
  networkQuality: "unknown",   // "excellent" | "good" | "fair" | "poor" | "bad" | "unknown"
  lastStats: null,             // raw snapshot from getStats

  /* ---------------------------------------------------
     Internal Guards
  --------------------------------------------------- */
  resetInProgress: false,
  answering: false,   // blocks fallback during answer window

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
    if (!newPhase || newPhase === this.phase) return;

    this.lastPhase = this.phase;
    this.phase = newPhase;

    this.log(`Phase: ${this.lastPhase} → ${newPhase}`);
  },

  /* ---------------------------------------------------
     Peer Assignment
  --------------------------------------------------- */
  setPeer(id, name = null) {
    this.peerId = id ?? null;
    this.peerName = name ?? null;

    this.callId = crypto.randomUUID?.() || Date.now().toString();

    this.log("Peer set:", {
      id: this.peerId,
      name: this.peerName,
      callId: this.callId
    });
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
      incomingOffer: this.incomingOffer
    });
  },

  markCallEstablished() {
    this.callEstablished = true;
    this.inCall = true;
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
    this.remoteTracks.clear();
    this.mediaReady = false;

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
    this.lastPhase = null;

    this.isCaller = false;
    this.audioOnly = false;
    this.callEstablished = false;

    this.incomingOffer = null;
    this.peerId = null;
    this.peerName = null;

    this.usedRelayFallback = false;
    this.pendingIceRestart = false;

    this.callId = null;
    this.answering = false;
    this.inCall = false;
    this.busy = false;
    this.voiceOnly = false;

    this.log("Call state reset");
  },

  /* ---------------------------------------------------
     Full Teardown (race‑condition safe)
  --------------------------------------------------- */
  fullReset() {
    if (this.resetInProgress) {
      this.log("Teardown skipped — already in progress");
      return;
    }

    this.resetInProgress = true;
    this.log("Performing full WebRTC teardown…");

    this.resetMedia();
    this.resetTimer();
    this.resetCallState();

    this.resetInProgress = false;
  },

  /* ---------------------------------------------------
     Network Quality Helpers
  --------------------------------------------------- */
  setNetworkQuality(level, info = "") {
    const allowed = ["excellent", "good", "fair", "poor", "bad", "unknown"];
    if (!allowed.includes(level)) level = "unknown";

    this.networkQuality = level;
    this.log("Network quality:", level, info);
  },

  updateFromStats(statsSnapshot) {
    this.lastStats = statsSnapshot;

    const { videoLoss, rtt, outgoingBitrate } = statsSnapshot;

    let level = "unknown";

    if (videoLoss == null && rtt == null) {
      level = "unknown";
    } else if (videoLoss > 0.20 || rtt > 0.8) {
      level = "bad";
    } else if (videoLoss > 0.10 || rtt > 0.5) {
      level = "poor";
    } else if (videoLoss > 0.05 || rtt > 0.3) {
      level = "fair";
    } else {
      level = "good";
    }

    this.setNetworkQuality(
      level,
      `loss=${(videoLoss * 100 || 0).toFixed(1)}% rtt=${(rtt || 0).toFixed(3)}s bitrate=${Math.round((outgoingBitrate || 0) / 1000)}kbps`
    );

    return this.networkQuality;
  },

  /* ---------------------------------------------------
     Debug Snapshot
  --------------------------------------------------- */
  debug() {
    const snapshot = {
      phase: this.phase,
      lastPhase: this.lastPhase,
      peerId: this.peerId,
      peerName: this.peerName,
      callId: this.callId,
      isCaller: this.isCaller,
      audioOnly: this.audioOnly,
      callEstablished: this.callEstablished,
      incomingOffer: this.incomingOffer,
      usedRelayFallback: this.usedRelayFallback,
      pendingIceRestart: this.pendingIceRestart,
      answering: this.answering,
      inCall: this.inCall,
      busy: this.busy,
      voiceOnly: this.voiceOnly,
      hasLocalStream: !!this.localStream,
      hasRemoteStream: !!this.remoteStream,
      remoteTrackCount: this.remoteTracks.size,
      callTimerSeconds: this.callTimerSeconds,
      networkQuality: this.networkQuality,
      hasLastStats: !!this.lastStats
    };

    this.log("State snapshot:", snapshot);
    return snapshot;
  }
};














