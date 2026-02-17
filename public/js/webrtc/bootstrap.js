// public/js/webrtc/bootstrap.js
// ============================================================
// Unified WebRTC Bootstrap
// Wires together:
//   - socket.js
//   - ice.js
//   - WebRTCController (via CallUI)
//   - CallUI
//   - RemoteParticipants
//   - WebRTCMedia
//
// Responsibilities:
//   - Initialize socket + ICE
//   - Initialize CallUI (which owns WebRTCController)
//   - Initialize RemoteParticipants
//   - Expose controller/UI for reconnect helpers
// ============================================================

import { socket } from "../socket.js";
import { getIceServers } from "../ice.js";

import { CallUI } from "./CallUI.js";
import { initRemoteParticipants } from "./RemoteParticipants.js";

import { attachLocalStream } from "./WebRTCMedia.js";
import { rtcState } from "./WebRTCState.js";
import * as RemoteParticipants from "./webrtc/RemoteParticipants.js";
window.RemoteParticipants = RemoteParticipants;

function log(...args) {
  console.log("[BOOTSTRAP]", ...args);
}

export async function initWebRTC() {
  log("Initializing WebRTC…");

  // -------------------------------------------------------
  // 1. Load ICE servers (optional, for future dynamic config)
  // -------------------------------------------------------
  try {
    rtcState.iceServers = await getIceServers();
  } catch (e) {
    console.warn("[BOOTSTRAP] getIceServers failed, using defaults in WebRTCController:", e);
  }

  // -------------------------------------------------------
  // 2. Create UI (which internally creates WebRTCController)
  // -------------------------------------------------------
  const ui = new CallUI(socket);
  const controller = ui.rtc; // CallUI constructor already did: this.rtc = new WebRTCController(socket)

  // Expose globally for debugging / reconnect helpers
  window.rtc = controller;
  window.callUI = ui;

  // -------------------------------------------------------
  // 3. Initialize RemoteParticipants (pure tile manager)
  // -------------------------------------------------------
  initRemoteParticipants();

  // NOTE:
  // All controller → UI wiring is done INSIDE CallUI._bindControllerEvents().
  // We do NOT override those callbacks here to avoid breaking UI logic.

  // -------------------------------------------------------
  // 4. Screen share hooks (align with CallUI + CSS)
  // -------------------------------------------------------
  controller.onScreenShareStarted = () => {
    // CallUI already has _enterStageMode wired via controller events,
    // but this is a safe extra hook if you want a global class.
    ui.callGrid?.classList.add("screen-share-mode");
  };

  controller.onScreenShareStopped = () => {
    ui.callGrid?.classList.remove("screen-share-mode");
  };

  // -------------------------------------------------------
  // 5. Remote upgraded to video (ensure UI flips to video mode)
  // -------------------------------------------------------
  const prevOnRemoteUpgraded = controller.onRemoteUpgradedToVideo;
  controller.onRemoteUpgradedToVideo = (...args) => {
    try {
      prevOnRemoteUpgraded?.(...args);
    } catch {}
    // Make sure UI is in active video mode
    ui._enterActiveVideoMode();
  };

  // -------------------------------------------------------
  // 6. Reconnect handling helpers
  // -------------------------------------------------------
  controller.isInCall = () => rtcState.inCall === true;

  controller.resyncAfterReconnect = () => {
    log("Resync after reconnect…");

    if (!rtcState.inCall) return;

    // Reattach local media to DOM
    if (rtcState.localStream) {
      attachLocalStream(rtcState.localStream);
    }

    const peerId = rtcState.peerId;
    if (peerId) {
      const pc = controller._ensurePC(peerId);

      if (rtcState.localStream) {
        rtcState.localStream.getTracks().forEach((t) =>
          pc.addTrack(t, rtcState.localStream)
        );
      }

      // Ask remote to resend offer / renegotiate
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
  // 7. Global helpers (optional)
  // -------------------------------------------------------
  window.onSocketDisconnected = () => {
    ui._setStatus("Reconnecting…");
  };

  window.restorePresence = () => {
    socket.emit("presence:restore");
  };

  log("WebRTC bootstrap complete");
  return { controller, ui };
}

// Auto‑init
document.addEventListener("DOMContentLoaded", () => {
  initWebRTC().catch((err) => console.error("WebRTC init failed:", err));
});
