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
    if (window.restorePresence) {
      window.restorePresence();
    }

    // Re-sync call state if a call is active
    if (window.rtc?.isInCall?.()) {
      console.log("[socket] Restoring active call state...");
      window.rtc?.resyncAfterReconnect?.();
    }

    // Flush any buffered ICE candidates
    if (window.flushBufferedCandidates) {
      window.flushBufferedCandidates();
    }
  });

  socket.on("disconnect", (reason) => {
    console.warn("[socket] Disconnected:", reason);

    // Optional: mark UI offline
    if (window.onSocketDisconnected) {
      window.onSocketDisconnected(reason);
    }
  });

  socket.on("reconnect_attempt", (n) => {
    console.log("[socket] Reconnect attempt:", n);
  });

  socket.on("reconnect", () => {
    console.log("[socket] Reconnected");
  });
}
socket.on("call:incoming", (payload) => {
  window.onIncomingCall?.(payload);
});

socket.on("call:outgoing", (payload) => {
  window.onOutgoingCall?.(payload);
});

export { socket };




