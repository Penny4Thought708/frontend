// public/js/webrtc/WebRTCState.js
// ============================================================
// rtcState: single source of truth for call + media state
// Used by:
//   - WebRTCController (signaling, participants, queue)
//   - WebRTCMedia (streams, audioOnly, cameraOff)
//   - CallUI (modes, timers, upgrade, quality)
// ============================================================

export const rtcState = {
  // Identity
  selfId: null,          // set by app/session layer

  // Call/session
  inCall: false,
  isCaller: false,
  busy: false,
  callId: null,          // current call identifier (1:1 or group)
  status: "idle",        // "idle" | "ringing" | "in-call" | "on-hold"

  peerId: null,
  peerName: null,
  peerAvatar: null,

  incomingOffer: null,
  incomingIsVideo: false,
  usedRelayFallback: false,

  // Participants (group-ready)
  // peerId -> { peerId, joinedAt, state, ... }
  participants: new Map(),

  // Inbound call queue (call waiting)
  // [{ from, offer, incomingIsVideo, callId }]
  inboundQueue: [],

  // Media
  localStream: null,
  remoteStreams: {},   // peerId -> MediaStream
  audioOnly: false,
  cameraOff: false,
  micMuted: false,

  // Timers
  callStartTs: null,
  callTimerSeconds: 0,

  // Network / quality
  lastQualityLevel: "poor",
  answering: false,

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



