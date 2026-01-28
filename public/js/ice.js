// public/js/ice.js  

const SIGNALING_BASE = "https://letsee-backend.onrender.com";

export async function getIceServers() {
  try {
    const res = await fetch(`${SIGNALING_BASE}/api/webrtc/get-ice`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json();

    // Backend returns: { iceServers: [...] }
    let servers = data?.iceServers;

    if (!servers || (Array.isArray(servers) && servers.length === 0)) {
      throw new Error("Invalid ICE servers");
    }

    if (!Array.isArray(servers)) {
      servers = [servers];
    }

    return servers;
  } catch (err) {
    console.warn("[ICE] Fetch failed, using fallback STUN:", err);
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

window.getIceServers = getIceServers;






