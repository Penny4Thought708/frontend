// public/js/ice.js

const SIGNALING_BASE = "https://letsee-backend.onrender.com";

let cachedServers = null;
let lastFetch = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getIceServers() {
  try {
    const now = Date.now();
    const age = now - lastFetch;

    // 1) Serve from cache if fresh
    if (cachedServers && age < CACHE_TTL_MS) {
      console.log("[ICE] Using cached ICE servers");
      return cachedServers;
    }

    // 2) Fetch from backend
    const res = await fetch(`${SIGNALING_BASE}/api/webrtc/get-ice`, {
      method: "GET",
      credentials: "include",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`ICE HTTP ${res.status}`);
    }

    const data = await res.json();

    // 3) Validate structure defensively
    let iceServers = Array.isArray(data?.iceServers)
      ? data.iceServers
      : [];

    // 4) Normalize urls to arrays + filter invalid entries
    iceServers = iceServers
      .map((s) => {
        if (!s || !s.urls) return null;

        const urls = Array.isArray(s.urls)
          ? s.urls.filter((u) => typeof u === "string")
          : typeof s.urls === "string"
            ? [s.urls]
            : [];

        if (urls.length === 0) return null;

        return { ...s, urls };
      })
      .filter(Boolean);

    // 5) Reorder TURN 443/tcp first (but keep all)
    iceServers = iceServers.map((s) => {
      const preferred = [];
      const others = [];

      for (const u of s.urls) {
        if (
          u.startsWith("turn:") || u.startsWith("turns:")
        ) {
          const is443 = u.includes(":443");
          const isTcp = u.includes("transport=tcp");

          if (is443 && isTcp) {
            preferred.push(u);
            continue;
          }
        }
        others.push(u);
      }

      return { ...s, urls: [...preferred, ...others] };
    });

    // 6) Cache and return
    cachedServers = iceServers;
    lastFetch = now;

    console.log("[ICE] Loaded ICE servers:", iceServers);
    return iceServers;

  } catch (err) {
    console.warn("[ICE] Fetch failed, using fallback STUN only:", err);

    // 7) Fallback: STUN only
    const fallback = [
      { urls: ["stun:stun.l.google.com:19302"] }
    ];

    cachedServers = fallback;
    lastFetch = Date.now();

    return fallback;
  }
}
















