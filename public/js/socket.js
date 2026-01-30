// public/js/socket.js
// Production‑ready Socket.IO client for Node backend

import io from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

// -------------------------------------------------------
// Prevent duplicate socket creation
// -------------------------------------------------------
if (window.__SOCKET_INSTANCE__) {
  console.warn("[socket] Duplicate socket.js load ignored");
  export const socket = window.__SOCKET_INSTANCE__;
  // IMPORTANT: do NOT create a new socket
  return;
}

// -------------------------------------------------------
// Create the ONE AND ONLY socket
// -------------------------------------------------------
const SIGNALING_URL = "https://letsee-backend.onrender.com";

export const socket = io(SIGNALING_URL, {
  transports: ["websocket"],
  withCredentials: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
  timeout: 20000,
});

// Save globally so duplicates reuse it
window.__SOCKET_INSTANCE__ = socket;




