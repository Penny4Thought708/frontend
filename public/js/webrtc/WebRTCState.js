// public/js/webrtc/WebRTCState.js
// ============================================================
// rtcState: single source of truth for call + media state
// Production‑grade, stable, group‑ready, TURN‑aware,
// upgrade‑aware, screen‑share‑aware.
// ============================================================

export const rtcState = {
  // Identity
  selfId: null,

  // Call/session
  inCall: false,
  isCaller: false,
  busy: false,
  callId: null,
  status: "idle", // "idle" | "ringing" | "in-call" | "on-hold"

  peerId: null,
  peerName: null,
  peerAvatar: null,

  // Offers
  incomingOffer: null,
  incomingIsVideo: false,
  answering: false,

  // Participants (group-ready)
  participants: new Map(),

  // Inbound call queue
  inboundQueue: [],

  // Media
  localStream: null,
  remoteStreams: {}, // peerId -> MediaStream
  audioOnly: false,
  cameraOff: false,
  micMuted: false,

  // Screen share
  screenSharing: false,

  // Upgrade state
  videoUpgrading: false,

  // Timers
  callStartTs: null,
  callTimerSeconds: 0,

  // Network / quality
  lastQualityLevel: "poor",
  usedRelayFallback: false,

  // Connection snapshots
  connectionState: "new", // "new" | "connecting" | "connected" | "failed" | "closed"
  iceState: "new",        // "new" | "checking" | "connected" | "failed" | "disconnected"

  // Error tracking
  lastError: null,

  // Stats snapshot → quality level
  updateFromStats({ videoLoss = 0, rtt = 0, outgoingBitrate = 0 }) {
    if (videoLoss < 0.02 && rtt < 0.15 && outgoingBitrate > 500_000) {
      this.lastQualityLevel = "excellent";
    } else if (videoLoss < 0.05 && rtt < 0.25) {
      this.lastQualityLevel = "good";
    } else if (videoLoss < 0.12 && rtt < 0.4) {
      this.lastQualityLevel = "fair";
    } else if (videoLoss < 0.25) {
      this.lastQualityLevel = "poor";
    } else {
      this.lastQualityLevel = "bad";
    }
    return this.lastQualityLevel;
  },

  // Reset everything (used by controller)
  resetAll() {
    this.inCall = false;
    this.isCaller = false;
    this.busy = false;
    this.callId = null;
    this.status = "idle";

    this.peerId = null;
    this.peerName = null;
    this.peerAvatar = null;

    this.incomingOffer = null;
    this.incomingIsVideo = false;
    this.answering = false;

    this.participants = new Map();
    this.inboundQueue = [];

    this.localStream = null;
    this.remoteStreams = {};
    this.audioOnly = false;
    this.cameraOff = false;
    this.micMuted = false;

    this.screenSharing = false;
    this.videoUpgrading = false;

    this.callStartTs = null;
    this.callTimerSeconds = 0;

    this.lastQualityLevel = "poor";
    this.usedRelayFallback = false;

    this.connectionState = "new";
    this.iceState = "new";

    this.lastError = null;
  },
};
;




