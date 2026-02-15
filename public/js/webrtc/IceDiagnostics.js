// public/js/webrtc/IceDiagnostics.js
// ============================================================
// TURN‑aware ICE diagnostics module
// - Detects relay (TURN) vs host/srflx
// - Monitors ICE + connection state
// - Polls getStats for loss/RTT/bitrate
// - Feeds rtcState.updateFromStats + optional callback
// ============================================================

import { rtcState } from "./WebRTCState.js";

function log(...args) {
  console.log("[IceDiagnostics]", ...args);
}

const POLL_INTERVAL_MS = 2000;

export class IceDiagnostics {
  constructor() {
    this._intervals = new Map(); // pc -> intervalId
  }

  attach(pc, peerId, onQualityUpdate = null) {
    if (!pc) return;

    const key = this._keyFor(pc, peerId);

    // Clear any existing interval for this pc
    this._clearIntervalFor(key);

    // Hook state changes
    pc.addEventListener("iceconnectionstatechange", () => {
      const state = pc.iceConnectionState;
      rtcState.iceState = state;
      log("ICE state:", peerId, state);
    });

    pc.addEventListener("connectionstatechange", () => {
      const state = pc.connectionState;
      rtcState.connectionState = state;
      log("Connection state:", peerId, state);
    });

    // Start stats polling
    const intervalId = window.setInterval(async () => {
      if (!pc || pc.connectionState === "closed") {
        this._clearIntervalFor(key);
        return;
      }
      try {
        const snapshot = await this._collectStatsSnapshot(pc);
        if (!snapshot) return;

        const quality = rtcState.updateFromStats(snapshot);
        if (typeof onQualityUpdate === "function") {
          onQualityUpdate(quality, snapshot);
        }
      } catch (err) {
        log("Stats polling error:", err);
      }
    }, POLL_INTERVAL_MS);

    this._intervals.set(key, intervalId);
  }

  detach(pc, peerId) {
    const key = this._keyFor(pc, peerId);
    this._clearIntervalFor(key);
  }

  _keyFor(pc, peerId) {
    return `${peerId || "unknown"}-${pc.__iceDiagId || (pc.__iceDiagId = Math.random().toString(36).slice(2))}`;
  }

  _clearIntervalFor(key) {
    const id = this._intervals.get(key);
    if (id) {
      clearInterval(id);
      this._intervals.delete(key);
    }
  }

  async _collectStatsSnapshot(pc) {
    const stats = await pc.getStats(null);

    let outboundVideo = null;
    let candidatePair = null;
    const candidates = {};
    let videoLoss = 0;
    let rtt = 0;
    let outgoingBitrate = 0;

    stats.forEach((report) => {
      if (report.type === "outbound-rtp" && report.kind === "video" && !report.isRemote) {
        outboundVideo = report;
      }

      if (report.type === "candidate-pair" && report.state === "succeeded") {
        candidatePair = report;
      }

      if (report.type === "local-candidate" || report.type === "remote-candidate") {
        candidates[report.id] = report;
      }
    });

    if (outboundVideo) {
      const { packetsSent = 0, packetsLost = 0, roundTripTime = 0, bytesSent = 0 } = outboundVideo;
      const total = packetsSent + packetsLost;
      videoLoss = total > 0 ? packetsLost / total : 0;
      rtt = roundTripTime || 0;

      // Approximate bitrate from bytesSent delta if available
      // (Browsers often expose "bytesSent" cumulative)
      if (!this._lastBytesSent) this._lastBytesSent = {};
      const prev = this._lastBytesSent[outboundVideo.ssrc] || { bytes: bytesSent, ts: performance.now() };
      const nowTs = performance.now();
      const dt = (nowTs - prev.ts) / 1000;
      if (dt > 0.5) {
        const deltaBytes = bytesSent - prev.bytes;
        outgoingBitrate = (deltaBytes * 8) / dt; // bits per second
        this._lastBytesSent[outboundVideo.ssrc] = { bytes: bytesSent, ts: nowTs };
      }
    }

    // Detect relay (TURN) usage
    if (candidatePair) {
      const local = candidates[candidatePair.localCandidateId];
      const remote = candidates[candidatePair.remoteCandidateId];

      const localType = local?.candidateType;
      const remoteType = remote?.candidateType;

      const usingRelay =
        localType === "relay" || remoteType === "relay" || local?.relayProtocol || remote?.relayProtocol;

      if (usingRelay && !rtcState.usedRelayFallback) {
        rtcState.usedRelayFallback = true;
        log("TURN relay in use:", {
          localType,
          remoteType,
          local,
          remote,
        });
      }
    }

    return { videoLoss, rtt, outgoingBitrate };
  }
}

// Singleton helper if you want a shared instance
export const iceDiagnostics = new IceDiagnostics();
