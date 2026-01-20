// public/js/ice.js

const SIGNALING_BASE = "https://letsee-backend.onrender.com";

export async function getIceServers() {
  try {
    const res = await fetch(`${SIGNALING_BASE}/api/webrtc/get-ice`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json();
    let servers = data?.v?.iceServers;

    if (!servers || (Array.isArray(servers) && servers.length === 0)) {
      throw new Error("Invalid ICE servers");
    }

    if (!Array.isArray(servers)) {
      servers = [servers];
    }

    return servers;
  } catch (err) {
    console.warn("ICE fetch failed, using fallback STUN:", err);
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}




