// public/js/socket.js
import { io } from "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.2/socket.io.esm.min.js";

let socket;

if (window.__SOCKET_INSTANCE__) {
  console.warn("[socket] Reusing existing socket instance");
  socket = window.__SOCKET_INSTANCE__;
} else {
  const SIGNALING_URL = "https://letsee-backend.onrender.com";

  socket = io(SIGNALING_URL, {
    transports: ["websocket"],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
    timeout: 20000,
  });

  window.__SOCKET_INSTANCE__ = socket;

  // -------------------------------------------------------
  // Reconnect Handling
  // -------------------------------------------------------
  socket.on("connect", () => {
    console.log("[socket] Connected:", socket.id);

    // Re-announce presence
    window.restorePresence?.();

    // Re-sync call state if a call is active
    if (window.rtc?.isInCall?.()) {
      console.log("[socket] Restoring active call state...");
      window.rtc?.resyncAfterReconnect?.();
    }

    // Flush any buffered ICE candidates
    window.flushBufferedCandidates?.();
  });

  socket.on("disconnect", (reason) => {
    console.warn("[socket] Disconnected:", reason);
    window.onSocketDisconnected?.(reason);
  });

  socket.on("reconnect_attempt", (n) => {
    console.log("[socket] Reconnect attempt:", n);
  });

  socket.on("reconnect", () => {
    console.log("[socket] Reconnected");
  });
}

/* -------------------------------------------------------
   REMOVE DEAD EVENTS (backend never emits these)
------------------------------------------------------- */
// socket.on("call:incoming", ...);
// socket.on("call:outgoing", ...);

/* -------------------------------------------------------
   REAL BACKEND EVENTS
------------------------------------------------------- */

// Callee receives inbound call
socket.on("call:start", (payload) => {
  window.onIncomingCall?.(payload);
});

// Callee accepted → caller notified
socket.on("call:accept", (payload) => {
  window.onCallAccepted?.(payload);
});

// Remote hung up
socket.on("call:end", (payload) => {
  window.onRemoteHangup?.(payload);
});

// Declined
socket.on("call:declined", (payload) => {
  window.onCallDeclined?.(payload);
});

// Timeout
socket.on("call:timeout", (payload) => {
  window.onCallTimeout?.(payload);
});

// Missed
socket.on("call:missed", (payload) => {
  window.onCallMissed?.(payload);
});

// DND
socket.on("call:dnd", (payload) => {
  window.onCallDnd?.(payload);
});

// Voicemail flow
socket.on("call:voicemail", (payload) => {
  window.onCallVoicemail?.(payload);
});

export { socket };



