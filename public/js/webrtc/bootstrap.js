// public/js/webrtc/bootstrap.js
// ============================================================
// Unified WebRTC Bootstrap
// Wires together:
//   - socket.js
//   - ice.js
//   - WebRTCController
//   - CallUI
//   - RemoteParticipants
//   - WebRTCMedia
//
// Responsibilities:
//   - Initialize socket + ICE
//   - Initialize WebRTCController
//   - Initialize CallUI
//   - Initialize RemoteParticipants
//   - Bind controller → UI events
//   - Bind UI → controller actions
//   - Handle reconnect + call state restore
// ============================================================

import { socket } from "../socket.js";
import { getIceServers } from "../ice.js";

import { WebRTCController } from "./WebRTCController.js";
import { CallUI } from "./CallUI.js";
import { RemoteParticipants } from "./RemoteParticipants.js";

import {
  attachLocalStream,
  attachRemoteTrack,
  cleanupMedia,
} from "./WebRTCMedia.js";

import { rtcState } from "./WebRTCState.js";

function log(...args) {
  console.log("[BOOTSTRAP]", ...args);
}

export async function initWebRTC() {
  log("Initializing WebRTC…");

  // -------------------------------------------------------
  // 1. Load ICE servers
  // -------------------------------------------------------
  rtcState.iceServers = await getIceServers();

  // -------------------------------------------------------
  // 2. Create controller + UI + participants
  // -------------------------------------------------------
  const controller = new WebRTCController(socket);
  const ui = new CallUI(socket);
  const participants = new RemoteParticipants();

  // Expose globally for reconnect logic
  window.rtc = controller;

  // -------------------------------------------------------
  // 3. Wire controller → UI
  // -------------------------------------------------------

  controller.onIncomingOffer = (peerId, offer) => {
    log("Incoming offer → UI");
    ui.receiveInboundCall(peerId, rtcState.incomingIsVideo);
  };

  controller.onIncomingOfferQueued = (peerId) => {
    log("Incoming offer queued");
    ui._showUnavailableToast("Incoming call queued");
  };

  controller.onCallStarted = () => {
    log("Call started");
    ui._setStatus("Connected");
  };

  controller.onCallEnded = (reason) => {
    log("Call ended:", reason);
    ui._resetUI();
  };

  controller.onRemoteJoin = (peerId) => {
    log("Remote joined:", peerId);
    ui._setStatus("Connected");
    ui._applyPrimaryLayout();
  };

  controller.onRemoteLeave = (peerId) => {
    log("Remote left:", peerId);
    ui._setStatus("Remote left");
    ui._resetUI();
  };

  controller.onPeerUnavailable = (reason) => {
    log("Peer unavailable:", reason);
    ui._showUnavailableToast(reason);
  };

  controller.onScreenShareStarted = () => {
    ui.videoContainer?.classList.add("screen-sharing");
  };

  controller.onScreenShareStopped = () => {
    ui.videoContainer?.classList.remove("screen-sharing");
  };

  controller.onParticipantUpdate = (peerId, info) => {
    if (info) participants.upsertParticipant(peerId, info);
    else participants.removeParticipant(peerId);
  };

  // Active speaker detection
  controller.onRemoteAudioTrack = (peerId, stream) => {
    participants.startActiveSpeaker(peerId, stream);
  };

  // -------------------------------------------------------
  // 4. Wire UI → controller
  // -------------------------------------------------------

  ui.rtc = controller; // UI already expects this

  ui.startVoiceCall = (peerId) => {
    controller.startCall(peerId, { audio: true, video: false });
  };

  ui.startVideoCall = (peerId) => {
    controller.startCall(peerId, { audio: true, video: true });
  };

  ui.answerCall = () => controller.answerCall();
  ui.endCall = () => controller.endCall();
  ui.upgradeToVideo = () => controller.upgradeToVideo();

  // -------------------------------------------------------
  // 5. Reconnect handling
  // -------------------------------------------------------

  controller.isInCall = () => rtcState.inCall === true;

  controller.resyncAfterReconnect = () => {
    log("Resync after reconnect…");

    if (!rtcState.inCall) return;

    // Reattach local media
    if (rtcState.localStream) {
      attachLocalStream(rtcState.localStream);
    }

    // Rebuild peer connection
    const peerId = rtcState.peerId;
    if (peerId) {
      const pc = controller._ensurePC(peerId);

      if (rtcState.localStream) {
        rtcState.localStream.getTracks().forEach((t) =>
          pc.addTrack(t, rtcState.localStream)
        );
      }

      // Ask remote to resend offer
      socket.emit("webrtc:signal", {
        type: "resync-request",
        from: rtcState.selfId,
        to: peerId,
        callId: rtcState.callId,
      });
    }

    ui._setStatus("Reconnected");
  };

  // -------------------------------------------------------
  // 6. Global helpers
  // -------------------------------------------------------

  window.flushBufferedCandidates = () => {
    if (!rtcState.bufferedCandidates) return;
    const peerId = rtcState.peerId;
    const pc = controller._ensurePC(peerId);

    rtcState.bufferedCandidates.forEach((c) => pc.addIceCandidate(c));
    rtcState.bufferedCandidates = [];
  };

  window.onSocketDisconnected = () => {
    ui._setStatus("Reconnecting…");
  };

  window.restorePresence = () => {
    socket.emit("presence:restore");
  };

  log("WebRTC bootstrap complete");
  return { controller, ui, participants };
}

// Auto‑init if desired
document.addEventListener("DOMContentLoaded", () => {
  initWebRTC().catch((err) => console.error("WebRTC init failed:", err));
});
