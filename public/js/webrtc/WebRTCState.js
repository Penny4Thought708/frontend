// public/js/webrtc/WebRTCState.js
// ============================================================
// rtcState: single source of truth for call + media state
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

  incomingOffer: null,
  incomingIsVideo: false,
  usedRelayFallback: false,

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
  answering: false,

  // Connection snapshots
  connectionState: "new", // "connecting" | "connected" | "failed" | "closed"
  iceState: "new",        // "checking" | "connected" | "failed" | "disconnected"

  // Error tracking
  lastError: null,

  // Stats snapshot → quality level
  updateFromStats({ videoLoss, rtt, outgoingBitrate }) {
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
};



