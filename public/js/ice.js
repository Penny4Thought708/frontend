// public/js/ice.js

// Your backend base URL
const SIGNALING_BASE = "https://letsee-backend.onrender.com";

let cachedServers = null;

export async function getIceServers() {
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

      // 🔥 FORCE TURN‑ONLY: remove all STUN entries
      cachedServers = (data?.iceServers || []).filter((s) =>
        (s.urls || "").toString().includes("turn")
      );

      console.log("[ICE] TURN‑only servers loaded:", cachedServers);
    }

    return cachedServers;
  } catch (err) {
    console.warn("[ICE] Fetch failed — NO STUN FALLBACK (TURN‑only mode):", err);

    // 🔥 DO NOT FALL BACK TO STUN — mobile networks will drop the call
    return [];
  }
}









