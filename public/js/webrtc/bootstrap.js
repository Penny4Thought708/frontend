// public/js/webrtc/bootstrap.js
// High-level bootstrap for WebRTC + UI + controller wiring

import { socket } from "../socket.js";
import { getIceServers } from "../ice.js";

import { CallUI } from "./CallUI.js";
import { initRemoteParticipants } from "./RemoteParticipants.js";

import { attachLocalStream } from "./WebRTCMedia.js";
import { rtcState } from "./WebRTCState.js";

// Expose RemoteParticipants for debugging (optional)
import * as RemoteParticipants from "./webrtc/RemoteParticipants.js";
window.RemoteParticipants = RemoteParticipants;

function log(...args) {
  console.log("[BOOTSTRAP]", ...args);
}

export async function initWebRTC() {
  log("Initializing WebRTC…");

  /* -------------------------------------------------------
     1. Load ICE servers (optional dynamic config)
  ------------------------------------------------------- */
  try {
    rtcState.iceServers = await getIceServers();
    log("ICE servers loaded:", rtcState.iceServers);
  } catch (e) {
    console.warn(
      "[BOOTSTRAP] getIceServers failed, using defaults in WebRTCController:",
      e
    );
  }

  /* -------------------------------------------------------
     2. Create UI (which internally creates WebRTCController)
  ------------------------------------------------------- */
  const ui = new CallUI(socket);
  const controller = ui.rtc; // CallUI constructor sets this.rtc = new WebRTCController(socket)

  // Expose globally for debugging / reconnect helpers
  window.rtc = controller;
  window.callUI = ui;

  /* -------------------------------------------------------
     3. Initialize RemoteParticipants (tile manager)
  ------------------------------------------------------- */
  initRemoteParticipants();

  // NOTE:
  // All controller → UI wiring is done INSIDE CallUI._bindControllerEvents().
  // We do NOT override those callbacks here to avoid breaking UI logic.

  /* -------------------------------------------------------
     4. Screen share hooks (UI + CSS alignment)
  ------------------------------------------------------- */
  controller.onScreenShareStarted = () => {
    try {
      ui.callGrid?.classList.add("screen-share-mode");
    } catch {}
  };

  controller.onScreenShareStopped = () => {
    try {
      ui.callGrid?.classList.remove("screen-share-mode");
    } catch {}
  };

  /* -------------------------------------------------------
     5. Remote upgraded to video (ensure UI flips to video mode)
  ------------------------------------------------------- */
  const prevOnRemoteUpgraded = controller.onRemoteUpgradedToVideo;
  controller.onRemoteUpgradedToVideo = (...args) => {
    try {
      prevOnRemoteUpgraded?.(...args);
    } catch {}

    // Ensure UI is in active video mode (Meet / FaceTime)
    try {
      ui._enterActiveVideoMode();
    } catch (err) {
      console.warn("[BOOTSTRAP] _enterActiveVideoMode failed:", err);
    }
  };

  /* -------------------------------------------------------
     6. Reconnect handling helpers
  ------------------------------------------------------- */
  controller.isInCall = () => rtcState.inCall === true;

  controller.resyncAfterReconnect = () => {
    log("Resync after reconnect…");

    if (!rtcState.inCall) return;

    // Reattach local media to DOM
    if (rtcState.localStream) {
      try {
        attachLocalStream(rtcState.localStream);
      } catch (err) {
        console.warn("[BOOTSTRAP] Failed to reattach local stream:", err);
      }
    }

    const peerId = rtcState.peerId;
    if (peerId) {
      const pc = controller._ensurePC(peerId);

      // Re-add local tracks
      if (rtcState.localStream) {
        try {
          rtcState.localStream.getTracks().forEach((t) =>
            pc.addTrack(t, rtcState.localStream)
          );
        } catch (err) {
          console.warn("[BOOTSTRAP] Failed to re-add local tracks:", err);
        }
      }

      // Ask remote to resend offer / renegotiate
      try {
        socket.emit("webrtc:signal", {
          type: "resync-request",
          from: rtcState.selfId,
          to: peerId,
          callId: rtcState.callId,
        });
      } catch (err) {
        console.warn("[BOOTSTRAP] Failed to emit resync-request:", err);
      }
    }

    ui._setStatusText("Reconnected");
  };

  /* -------------------------------------------------------
     7. Global helpers (optional)
  ------------------------------------------------------- */
  window.onSocketDisconnected = () => {
    try {
      ui._setStatus("Reconnecting…");
    } catch {}
  };

  window.restorePresence = () => {
    try {
      socket.emit("presence:restore");
    } catch {}
  };

  /* -------------------------------------------------------
     8. Mobile Orientation Sync (FaceTime-style)
     - Uses modern screen.orientation when available
     - Falls back to window.orientation for older iPhones
  ------------------------------------------------------- */
  (function setupOrientationSync() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;

    const send = () => {
      let orientation = "portrait";

      // Modern API
      if (screen.orientation && screen.orientation.type) {
        orientation = screen.orientation.type.startsWith("portrait")
          ? "portrait"
          : "landscape";
      }
      // Legacy iOS fallback
      else if (typeof window.orientation === "number") {
        const angle = window.orientation;
        orientation =
          angle === 0 || angle === 180 ? "portrait" : "landscape";
      }

      try {
        controller.sendOrientation(orientation);
      } catch (err) {
        console.warn("[BOOTSTRAP] Failed to send orientation:", err);
      }
    };

    // Modern listener
    if (screen.orientation && typeof screen.orientation.addEventListener === "function") {
      screen.orientation.addEventListener("change", send);
    }

    // Legacy listener
    window.addEventListener("orientationchange", send);

    // Initial sync
    send();
  })();

  log("WebRTC bootstrap complete");
  return { controller, ui };
}

/* -------------------------------------------------------
   Auto-init on DOM ready
------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initWebRTC().catch((err) =>
    console.error("WebRTC init failed:", err)
  );
});
