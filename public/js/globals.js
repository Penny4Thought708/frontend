// public/js/globals.js
// Centralized global helpers for WebRTC, UI, and session state
// with runtime diagnostics for easier debugging.

const GL_TAG = "[globals]";

// -----------------------------------------------------
// Identity helpers
// -----------------------------------------------------
function logIdentityState(caller) {
  console.debug(
    `${GL_TAG} ${caller} identity snapshot:`,
    {
      currentUserId: window.currentUserId,
      currentUserFullname: window.currentUserFullname,
      currentReceiverId: window.currentReceiverId
    }
  );
}

export function getMyUserId() {
  const id = window.currentUserId ?? null;
  if (!id) {
    console.warn(`${GL_TAG} getMyUserId(): no currentUserId on window`);
    logIdentityState("getMyUserId");
  } else {
    console.debug(`${GL_TAG} getMyUserId():`, id);
  }
  return id;
}

export function getMyFullname() {
  const name = window.currentUserFullname ?? "";
  if (!name) {
    console.warn(`${GL_TAG} getMyFullname(): no currentUserFullname on window`);
    logIdentityState("getMyFullname");
  } else {
    console.debug(`${GL_TAG} getMyFullname():`, name);
  }
  return name;
}

export function getReceiver() {
  const receiver = window.currentReceiverId ?? null;
  if (!receiver) {
    console.warn(`${GL_TAG} getReceiver(): no currentReceiverId on window`);
    logIdentityState("getReceiver");
  } else {
    console.debug(`${GL_TAG} getReceiver():`, receiver);
  }
  return receiver;
}

// -----------------------------------------------------
// ICE / TURN configuration
// -----------------------------------------------------
export async function getIceServers() {
  if (window.ICE_SERVERS) {
    console.debug(`${GL_TAG} getIceServers(): using cached ICE_SERVERS`, window.ICE_SERVERS);
    return window.ICE_SERVERS;
  }

  console.debug(`${GL_TAG} getIceServers(): fetching /api/webrtc/ice`);
  try {
    const res = await fetch("/api/webrtc/ice");
    if (!res.ok) {
      console.warn(`${GL_TAG} getIceServers(): non-200 response`, res.status);
      return [];
    }
    const json = await res.json();
    window.ICE_SERVERS = json.iceServers || [];
    console.debug(`${GL_TAG} getIceServers(): loaded`, window.ICE_SERVERS);
    return window.ICE_SERVERS;
  } catch (err) {
    console.warn(`${GL_TAG} getIceServers(): failed to load ICE servers`, err);
    return [];
  }
}

// -----------------------------------------------------
// Call logs
// -----------------------------------------------------
export function addCallLogEntry(entry) {
  console.debug(`${GL_TAG} addCallLogEntry():`, entry);

  if (!window.callLogs) {
    console.debug(`${GL_TAG} addCallLogEntry(): initializing window.callLogs`);
    window.callLogs = [];
  }
  window.callLogs.push(entry);

  try {
    fetch("/api/call-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    }).catch(err => {
      console.warn(`${GL_TAG} addCallLogEntry(): network error persisting call log`, err);
    });
  } catch (err) {
    console.warn(`${GL_TAG} addCallLogEntry(): failed to save call log`, err);
  }
}

// -----------------------------------------------------
// UI helpers (wrappers around your existing UI functions)
// -----------------------------------------------------
export const UI = {
  apply(state, data) {
    if (window.UI?.apply) {
      console.debug(`${GL_TAG} UI.apply():`, { state, data });
      window.UI.apply(state, data);
    } else {
      console.warn(`${GL_TAG} UI.apply(): window.UI.apply is missing`, { state, data });
    }
  }
};

// -----------------------------------------------------
// Media + avatar helpers
// -----------------------------------------------------
export function showLocalVideo() {
  if (typeof window.showLocalVideo === "function") {
    console.debug(`${GL_TAG} showLocalVideo()`);
    window.showLocalVideo();
  } else {
    console.warn(`${GL_TAG} showLocalVideo(): window.showLocalVideo is missing`);
  }
}

export function fadeInVideo(el) {
  if (typeof window.fadeInVideo === "function") {
    console.debug(`${GL_TAG} fadeInVideo():`, el);
    window.fadeInVideo(el);
  } else {
    console.warn(`${GL_TAG} fadeInVideo(): window.fadeInVideo is missing`, el);
  }
}

export function showLocalAvatar() {
  if (typeof window.showLocalAvatar === "function") {
    console.debug(`${GL_TAG} showLocalAvatar()`);
    window.showLocalAvatar();
  } else {
    console.warn(`${GL_TAG} showLocalAvatar(): window.showLocalAvatar is missing`);
  }
}

export function showRemoteAvatar() {
  if (typeof window.showRemoteAvatar === "function") {
    console.debug(`${GL_TAG} showRemoteAvatar()`);
    window.showRemoteAvatar();
  } else {
    console.warn(`${GL_TAG} showRemoteAvatar(): window.showRemoteAvatar is missing`);
  }
}

export function showRemoteVideo() {
  if (typeof window.showRemoteVideo === "function") {
    console.debug(`${GL_TAG} showRemoteVideo()`);
    window.showRemoteVideo();
  } else {
    console.warn(`${GL_TAG} showRemoteVideo(): window.showRemoteVideo is missing`);
  }
}

export function setRemoteAvatar(avatar) {
  if (typeof window.setRemoteAvatar === "function") {
    console.debug(`${GL_TAG} setRemoteAvatar():`, avatar);
    window.setRemoteAvatar(avatar);
  } else {
    console.warn(`${GL_TAG} setRemoteAvatar(): window.setRemoteAvatar is missing`, avatar);
  }
}

// -----------------------------------------------------
// Audio helpers
// -----------------------------------------------------
// Use getters instead of freezing values at module load time
export function getRingtone() {
  if (!window.ringtone) {
    console.warn(`${GL_TAG} getRingtone(): window.ringtone is missing`);
    return null;
  }
  console.debug(`${GL_TAG} getRingtone(): returning ringtone`);
  return window.ringtone;
}

export function getRingback() {
  if (!window.ringback) {
    console.warn(`${GL_TAG} getRingback(): window.ringback is missing`);
    return null;
  }
  console.debug(`${GL_TAG} getRingback(): returning ringback`);
  return window.ringback;
}

export function stopAudio(audio) {
  if (!audio) {
    console.warn(`${GL_TAG} stopAudio(): no audio instance provided`);
    return;
  }
  try {
    console.debug(`${GL_TAG} stopAudio(): stopping audio`, audio);
    audio.pause();
    audio.currentTime = 0;
  } catch (err) {
    console.warn(`${GL_TAG} stopAudio(): error while stopping audio`, err);
  }
}

// -----------------------------------------------------
// Timer helpers
// -----------------------------------------------------
export function startTimer() {
  if (typeof window.startTimer === "function") {
    console.debug(`${GL_TAG} startTimer()`);
    window.startTimer();
  } else {
    console.warn(`${GL_TAG} startTimer(): window.startTimer is missing`);
  }
}

export function stopTimer() {
  if (typeof window.stopTimer === "function") {
    console.debug(`${GL_TAG} stopTimer()`);
    window.stopTimer();
  } else {
    console.warn(`${GL_TAG} stopTimer(): window.stopTimer is missing`);
  }
}


