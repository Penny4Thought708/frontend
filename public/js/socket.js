// public/js/socket.js
import io from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

// -------------------------------------------------------
// ES‑module‑safe singleton guard
// -------------------------------------------------------
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
}

export { socket };



