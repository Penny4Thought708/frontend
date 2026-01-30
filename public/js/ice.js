// public/js/ice.js

const SIGNALING_BASE = "https://letsee-backend.onrender.com";

let cachedRelayOnly = null;

export async function getIceServers({ relayOnly = false } = {}) {
  try {
    // 🔥 ALWAYS request relayOnly=1 when relayOnly is true
    if (relayOnly) {
      if (!cachedRelayOnly) {
        const res = await fetch(
          `${SIGNALING_BASE}/api/webrtc/get-ice?relayOnly=1`,
          {
            method: "GET",
            credentials: "include"
          }
        );

        if (!res.ok) {
          throw new Error(`ICE HTTP ${res.status}`);
        }

        const data = await res.json();
        cachedRelayOnly = data?.iceServers || [];

        console.log("[ICE] TURN‑only servers loaded:", cachedRelayOnly);
      }

      return cachedRelayOnly;
    }

    // If you ever want non-relay mode (you don't right now)
    return [];
  } catch (err) {
    console.warn("[ICE] Fetch failed — TURN‑only fallback:", err);

    return [
      {
        urls: ["turns:us-turn3.xirsys.com:443?transport=tcp"],
        username:
          "pNNsSw9RUFU1xAmcGCS_jLnWqdxLgtmfu842JQSyJCHTIgqCXERA2MZWWQES9H9VAAAAAGl7xz1Ub21teVlhdHRz",
        credential: "a4e8a85e-fd53-11f0-b4fa-0242ac140004"
      }
    ];
  }
}











