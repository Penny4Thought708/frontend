// public/js/globals.js
// Centralized global helpers for WebRTC, UI, and session state.

// -----------------------------------------------------
// Identity helpers
// -----------------------------------------------------
export function getMyUserId() {
  return window.currentUserId || null;
}

export function getMyFullname() {
  return window.currentUserFullname || "";
}

export function getReceiver() {
  return window.currentReceiverId || null;
}

// -----------------------------------------------------
// ICE / TURN configuration
// -----------------------------------------------------
export async function getIceServers() {
  // If already loaded globally, use it
  if (window.ICE_SERVERS) return window.ICE_SERVERS;

  try {
    const res = await fetch("/api/webrtc/ice");
    const json = await res.json();
    window.ICE_SERVERS = json.iceServers || [];
    return window.ICE_SERVERS;
  } catch (err) {
    console.warn("[globals] Failed to load ICE servers:", err);
    return [];
  }
}

// -----------------------------------------------------
// Call logs
// -----------------------------------------------------
export function addCallLogEntry(entry) {
  if (!window.callLogs) window.callLogs = [];
  window.callLogs.push(entry);

  // Optional: persist to backend
  try {
    fetch("/api/call-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
  } catch (err) {
    console.warn("[globals] Failed to save call log:", err);
  }
}

// -----------------------------------------------------
// UI helpers (wrappers around your existing UI functions)
// -----------------------------------------------------
export const UI = {
  apply(state, data) {
    if (window.UI?.apply) {
      window.UI.apply(state, data);
    } else {
      console.warn("[globals] UI.apply missing");
    }
  }
};

// -----------------------------------------------------
// Media + avatar helpers
// -----------------------------------------------------
export function showLocalVideo() {
  window.showLocalVideo?.();
}

export function fadeInVideo(el) {
  window.fadeInVideo?.(el);
}

export function showLocalAvatar() {
  window.showLocalAvatar?.();
}

export function showRemoteAvatar() {
  window.showRemoteAvatar?.();
}

export function showRemoteVideo() {
  window.showRemoteVideo?.();
}

export function setRemoteAvatar(avatar) {
  window.setRemoteAvatar?.(avatar);
}

// -----------------------------------------------------
// Audio helpers
// -----------------------------------------------------
export const ringtone = window.ringtone || null;
export const ringback = window.ringback || null;

export function stopAudio(audio) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {}
}

// -----------------------------------------------------
// Timer helpers
// -----------------------------------------------------
export function startTimer() {
  window.startTimer?.();
}

export function stopTimer() {
  window.stopTimer?.();
}

