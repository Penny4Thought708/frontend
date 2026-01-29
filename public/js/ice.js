// public/js/ice.js

// Your backend base URL
const SIGNALING_BASE = "https://letsee-backend.onrender.com";

let cachedServers = null;

export async function getIceServers({ relayOnly = false } = {}) {
  try {
    if (!cachedServers) {
      const res = await fetch(`${SIGNALING_BASE}/api/webrtc/get-ice`, {
        method: "GET",
        credentials: "include"
      });

      if (!res.ok) {
        throw new Error(`ICE HTTP ${res.status}`);
      }

      const data = await res.json();
      cachedServers = data?.iceServers || [];

      console.log("[ICE] Loaded from backend:", cachedServers);
    }

    if (!relayOnly) return cachedServers;

    // TURN-only mode
    const relay = cachedServers.filter((s) =>
      (s.urls || "").toString().includes("turn:")
    );

    console.log("[ICE] Relay-only servers:", relay);
    return relay;
  } catch (err) {
    console.warn("[ICE] Fetch failed, using fallback STUN:", err);
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}








