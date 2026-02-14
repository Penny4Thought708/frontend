// public/js/ice.js

const SIGNALING_BASE = "https://letsee-backend.onrender.com";

let cachedServers = null;
let lastFetch = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getIceServers() {
  try {
    // 1) Serve from cache if fresh
    const age = Date.now() - lastFetch;
    if (cachedServers && age < CACHE_TTL_MS) {
      console.log("[ICE] Using cached ICE servers");
      return cachedServers;
    }

    // 2) Fetch from backend
    const res = await fetch(`${SIGNALING_BASE}/api/webrtc/get-ice`, {
      method: "GET",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(`ICE HTTP ${res.status}`);
    }

    const data = await res.json();
    let iceServers = data?.iceServers || [];

    // 3) Normalize urls to arrays
    iceServers = iceServers.map((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return { ...s, urls };
    });

    // 4) Prefer TURN 443/tcp for mobile/captive networks — but DO NOT delete others
    iceServers = iceServers.map((s) => {
      const preferred = [];
      const others = [];

      for (const u of s.urls) {
        if (
          typeof u === "string" &&
          u.startsWith("turn") &&
          u.includes(":443") &&
          u.includes("transport=tcp")
        ) {
          preferred.push(u);
        } else {
          others.push(u);
        }
      }

      return { ...s, urls: [...preferred, ...others] };
    });

    // 5) Cache and return
    cachedServers = iceServers;
    lastFetch = Date.now();

    console.log("[ICE] Loaded ICE servers:", iceServers);
    return iceServers;
  } catch (err) {
    console.warn("[ICE] Fetch failed, using fallback STUN only:", err);

    // 6) Fallback: STUN only (safe everywhere)
    const fallback = [
      { urls: "stun:stun.l.google.com:19302" },
    ];

    cachedServers = fallback;
    lastFetch = Date.now();

    return fallback;
  }
}














