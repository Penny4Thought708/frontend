// public/js/webrtc/WebRTCState.js

export const rtcState = {
  // Call/session
  inCall: false,
  isCaller: false,
  busy: false,
  peerId: null,
  peerName: null,
  peerAvatar: null,
  incomingOffer: null,
  usedRelayFallback: false,

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
    // Simple heuristic; you can tune this
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


