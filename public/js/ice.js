// public/js/ice.js

const SIGNALING_BASE = "https://letsee-backend.onrender.com";

let cachedNormal = null;
let cachedRelayOnly = null;

export async function getIceServers({ relayOnly = false } = {}) {
  try {
    if (relayOnly) {
      // 🔒 TRUE TURN‑ONLY, TCP/TLS/443 FROM BACKEND
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

    // Normal mode (if you ever want it)
    if (!cachedNormal) {
      const res = await fetch(`${SIGNALING_BASE}/api/webrtc/get-ice?relayOnly=0`, {
        method: "GET",
        credentials: "include"
      });

      if (!res.ok) {
        throw new Error(`ICE HTTP ${res.status}`);
      }

      const data = await res.json();
      cachedNormal = data?.iceServers || [];
      console.log("[ICE] Normal ICE servers loaded:", cachedNormal);
    }

    return cachedNormal;
  } catch (err) {
    console.warn("[ICE] Fetch failed, using minimal fallback:", err);

    if (relayOnly) {
      // Fallback: single TURN 443/tcp only
      return [
        {
          urls: ["turns:us-turn3.xirsys.com:443?transport=tcp"],
          username:
            "pNNsSw9RUFU1xAmcGCS_jLnWqdxLgtmfu842JQSyJCHTIgqCXERA2MZWWQES9H9VAAAAAGl7xz1Ub21teVlhdHRz",
          credential: "a4e8a85e-fd53-11f0-b4fa-0242ac140004"
        }
      ];
    }

    // Non‑relay fallback (if ever used)
    return [{ urls: ["stun:stun.l.google.com:19302"] }];
  }
}











