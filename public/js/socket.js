// public/js/socket.js
import io from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

// -------------------------------------------------------
// Prevent duplicate socket creation (ES‑module safe)
// -------------------------------------------------------
if (window.__SOCKET_INSTANCE__) {
  console.warn("[socket] Reusing existing socket instance");
  // Export the existing instance
  export const socket = window.__SOCKET_INSTANCE__;
} else {
  const SIGNALING_URL = "https://letsee-backend.onrender.com";

  const createdSocket = io(SIGNALING_URL, {
    transports: ["websocket"],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
    timeout: 20000,
  });

  window.__SOCKET_INSTANCE__ = createdSocket;

  export const socket = createdSocket;
}



