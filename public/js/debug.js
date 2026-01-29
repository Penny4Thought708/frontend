// public/js/debug.js

/*
export const DEBUG = {
  ui: false,
  socket: true,
  rtc: true,
  contacts: false,
  voicemail: false,
};

async function testTurnReachability() {
  const servers = await getIceServers();
  console.log("[TURN TEST] ICE servers:", servers);

  const pc = new RTCPeerConnection({ iceServers: servers });

  pc.onicecandidate = (e) => {
    if (!e.candidate) return;

    const c = e.candidate.candidate;
    console.log("[TURN TEST] Candidate:", c);

    if (c.includes("relay")) {
      console.log("%c[TURN TEST] SUCCESS: TURN relay reachable!", "color: green; font-weight: bold;");
    }
    if (c.includes("srflx")) {
      console.log("%c[TURN TEST] STUN reachable", "color: orange;");
    }
    if (c.includes("host")) {
      console.log("[TURN TEST] Host candidate");
    }
  };

  // Trigger ICE gathering
  pc.createDataChannel("test");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
}

window.testTurnReachability = testTurnReachability;

