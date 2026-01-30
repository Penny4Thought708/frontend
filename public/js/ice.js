// public/js/ice.js

const SIGNALING_BASE = "https://letsee-backend.onrender.com";

let cachedServers = null;

export async function getIceServers() {
  try {
    if (!cachedServers) {
      const res = await fetch(`${SIGNALING_BASE}/api/webrtc/get-ice`, {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`ICE HTTP ${res.status}`);
      }

      const data = await res.json();
      let iceServers = data?.iceServers || [];

      // Extra frontend safety: only TURN/TLS/443 over TCP
      iceServers = iceServers
        .map((s) => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          return {
            ...s,
            urls: urls.filter(
              (u) =>
                typeof u === "string" &&
                u.startsWith("turns:") &&
                u.includes(":443") &&
                u.includes("transport=tcp")
            ),
          };
        })
        .filter((s) => s.urls.length > 0);

      cachedServers = iceServers;

      console.log("[ICE] TURN‑only servers loaded:", cachedServers);
    }

    return cachedServers;
  } catch (err) {
    console.warn("[ICE] Fetch failed, using TURN‑TCP fallback:", err);

    // Still NO STUN, NO UDP
    return [
      {
        urls: ["turns:us-turn3.xirsys.com:443?transport=tcp"],
        username:
          "pNNsSw9RUFU1xAmcGCS_jLnWqdxLgtmfu842JQSyJCHTIgqCXERA2MZWWQES9H9VAAAAAGl7xz1Ub21teVlhdHRz",
        credential: "a4e8a85e-fd53-11f0-b4fa-0242ac140004",
      },
    ];
  }
}













