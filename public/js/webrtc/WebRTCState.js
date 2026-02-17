// public/js/webrtc/WebRTCState.js
// Centralized, authoritative, mutation-safe WebRTC state container

export const rtcState = {
  /* -------------------------------------------------------
     Identity
  ------------------------------------------------------- */
  selfId: null,

  /* -------------------------------------------------------
     Call / Session
  ------------------------------------------------------- */
  inCall: false,
  isCaller: false,
  busy: false,
  callId: null,

  // "idle" | "ringing" | "in-call" | "on-hold"
  status: "idle",

  peerId: null,
  peerName: null,
  peerAvatar: null,

  /* -------------------------------------------------------
     Offers / Signaling
  ------------------------------------------------------- */
  incomingOffer: null,
  incomingIsVideo: false,
  answering: false,

  /* -------------------------------------------------------
     Participants (group-ready)
  ------------------------------------------------------- */
  participants: new Map(), // peerId -> metadata

  /* -------------------------------------------------------
     Inbound call queue (multi-offer safety)
  ------------------------------------------------------- */
  inboundQueue: [],

  /* -------------------------------------------------------
     Media
  ------------------------------------------------------- */
  localStream: null,
  remoteStreams: {}, // peerId -> MediaStream

  audioOnly: false,
  cameraOff: false,
  micMuted: false,

  /* -------------------------------------------------------
     Screen Share
  ------------------------------------------------------- */
  screenSharing: false,

  /* -------------------------------------------------------
     Upgrade State (audio → video)
  ------------------------------------------------------- */
  videoUpgrading: false,

  /* -------------------------------------------------------
     Timers
  ------------------------------------------------------- */
  callStartTs: null,
  callTimerSeconds: 0,

  /* -------------------------------------------------------
     Network / Quality
  ------------------------------------------------------- */
  lastQualityLevel: "poor",
  usedRelayFallback: false,

  /* -------------------------------------------------------
     Connection Snapshots
  ------------------------------------------------------- */
  connectionState: "new", // "new" | "connecting" | "connected" | "failed" | "closed"
  iceState: "new",        // "new" | "checking" | "connected" | "failed" | "disconnected"

  /* -------------------------------------------------------
     Error Tracking
  ------------------------------------------------------- */
  lastError: null,

  /* -------------------------------------------------------
     Stats Snapshot → Quality Level
     (Meet-style quality scoring)
  ------------------------------------------------------- */
  updateFromStats({ videoLoss = 0, rtt = 0, outgoingBitrate = 0 }) {
    // Excellent
    if (videoLoss < 0.02 && rtt < 0.15 && outgoingBitrate > 500_000) {
      this.lastQualityLevel = "excellent";
      return this.lastQualityLevel;
    }

    // Good
    if (videoLoss < 0.05 && rtt < 0.25) {
      this.lastQualityLevel = "good";
      return this.lastQualityLevel;
    }

    // Fair
    if (videoLoss < 0.12 && rtt < 0.4) {
      this.lastQualityLevel = "fair";
      return this.lastQualityLevel;
    }

    // Poor
    if (videoLoss < 0.25) {
      this.lastQualityLevel = "poor";
      return this.lastQualityLevel;
    }

    // Bad
    this.lastQualityLevel = "bad";
    return this.lastQualityLevel;
  },

  /* -------------------------------------------------------
     Reset Everything (used by controller)
     Full teardown → ready for next call
  ------------------------------------------------------- */
  resetAll() {
    // Identity
    this.selfId = null;

    // Call/session
    this.inCall = false;
    this.isCaller = false;
    this.busy = false;
    this.callId = null;
    this.status = "idle";

    this.peerId = null;
    this.peerName = null;
    this.peerAvatar = null;

    // Offers
    this.incomingOffer = null;
    this.incomingIsVideo = false;
    this.answering = false;

    // Participants
    this.participants = new Map();
    this.inboundQueue = [];

    // Media
    this.localStream = null;
    this.remoteStreams = {};
    this.audioOnly = false;
    this.cameraOff = false;
    this.micMuted = false;

    // Screen share
    this.screenSharing = false;

    // Upgrade
    this.videoUpgrading = false;

    // Timers
    this.callStartTs = null;
    this.callTimerSeconds = 0;

    // Network / quality
    this.lastQualityLevel = "poor";
    this.usedRelayFallback = false;

    // Connection snapshots
    this.connectionState = "new";
    this.iceState = "new";

    // Errors
    this.lastError = null;
  },
};





