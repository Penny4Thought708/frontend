// public/js/ice.js  

let cachedServers = null;

export async function getIceServers({ relayOnly = false } = {}) {
  try {
    if (!cachedServers) {
      const res = await fetch(`${SIGNALING_BASE}/api/webrtc/get-ice`, {
        method: "GET",
        credentials: "include",
      });

      const data = await res.json();
      cachedServers = data?.iceServers || [];
    }

    if (!relayOnly) return cachedServers;

    // Relay-only view
    return cachedServers.filter((s) =>
      (s.urls || "").includes("turn:")
    );
  } catch (err) {
    console.warn("[ICE] Fetch failed, using fallback STUN:", err);
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}








