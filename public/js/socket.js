// public/js/socket.js
// Production‑ready Socket.IO client for Node backend

import io from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";
if (window.__SOCKET_ALREADY_CREATED__) {
  console.warn("[socket] Duplicate socket ignored");
  export const socket = window.__SOCKET_INSTANCE__;
  return;
}
window.__SOCKET_ALREADY_CREATED__ = true;
window.__SOCKET_INSTANCE__ = socket;

// Your backend WebSocket endpoint
const SIGNALING_URL = "https://letsee-backend.onrender.com";

// Exported socket instance
export const socket = io(SIGNALING_URL, {
  transports: ["websocket"],          // WebRTC signaling prefers WS only
  withCredentials: true,              // ⭐ send cookies to backend
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
  timeout: 20000,
});



