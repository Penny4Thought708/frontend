// public/js/ice.js

const SIGNALING_BASE = "https://letsee-backend.onrender.com";

let cachedServers = null;

export async function getIceServers({ relayOnly = false } = {}) {
  try {
    // 🔥 Always ask backend for relayOnly=1 – we want TURN/TCP only
    const url = `${SIGNALING_BASE}/api/webrtc/get-ice?relayOnly=1`;

    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(`ICE HTTP ${res.status}`);
    }

    const data = await res.json();
    cachedServers = data?.iceServers || [];

    console.log("[ICE] TURN‑only servers loaded:", cachedServers);

    return cachedServers;
  } catch (err) {
    console.warn("[ICE] Fetch failed, NO STUN FALLBACK (TURN‑only mode):", err);

    // 🔥 If ICE fetch fails, we DO NOT fall back to STUN.
    // Returning [] means WebRTC will fail fast instead of crashing mobile data.
    return [];
  }
}










