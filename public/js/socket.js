// public/js/socket.js

import io from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

// Replace this with your Render URL once deployed:
const SIGNALING_URL = "https://letsee-backend.onrender.com";


export const socket = io(SIGNALING_URL, {
  transports: ["websocket"],        // WebRTC signaling should prefer WS only
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

