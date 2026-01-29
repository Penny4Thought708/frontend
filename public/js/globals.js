// public/js/globals.js
// EXACT exports required by WebRTCController.js
/*
import { getIceServers as loadIce } from "./ice.js";
import { getMyUserId as sessionUserId, getMyFullname as sessionFullname } from "./session.js";

const GL = "[globals]";

// -----------------------------------------------------
// Identity helpers
// -----------------------------------------------------
export function getMyUserId() {
  const id = sessionUserId();
  console.debug(`${GL} getMyUserId():`, id);
  return id;
}

export function getMyFullname() {
  const name = sessionFullname();
  console.debug(`${GL} getMyFullname():`, name);
  return name;
}

export function getReceiver() {
  const r = window.currentReceiverId ?? null;
  console.debug(`${GL} getReceiver():`, r);
  return r;
}

// -----------------------------------------------------
// ICE servers
// -----------------------------------------------------
export async function getIceServers() {
  try {
    const servers = await loadIce();
    console.debug(`${GL} ICE servers:`, servers);
    return servers;
  } catch (err) {
    console.warn(`${GL} ICE fallback STUN`, err);
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

// -----------------------------------------------------
// Call logs
// -----------------------------------------------------
export function addCallLogEntry(entry) {
  console.debug(`${GL} addCallLogEntry():`, entry);
  // You can wire this to backend later if needed
}

// -----------------------------------------------------
// UI state machine (WebRTCController triggers this)
// CallUI handles the real DOM
// -----------------------------------------------------
export const UI = {
  apply(state, data) {
    console.log("[UI.apply]", state, data);
  }
};

// -----------------------------------------------------
// Media + avatar helpers (WebRTCController calls these)
// CallUI handles actual DOM work
// -----------------------------------------------------
export function showLocalVideo() {
  console.log(`${GL} showLocalVideo()`);
}

export function fadeInVideo(el) {
  console.log(`${GL} fadeInVideo()`, el);
}

export function showLocalAvatar() {
  console.log(`${GL} showLocalAvatar()`);
}

export function showRemoteAvatar() {
  console.log(`${GL} showRemoteAvatar()`);
}

export function showRemoteVideo() {
  console.log(`${GL} showRemoteVideo()`);
}

export function setRemoteAvatar(avatar) {
  console.log(`${GL} setRemoteAvatar():`, avatar);
}

// -----------------------------------------------------
// Audio helpers
// -----------------------------------------------------
export function getRingtone() {
  return window.ringtone || null;
}

export function getRingback() {
  return window.ringback || null;
}

export function stopAudio(audio) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (err) {
    console.warn(`${GL} stopAudio() error`, err);
  }
}

// -----------------------------------------------------
// Timer helpers
// -----------------------------------------------------
export function startTimer() {
  console.log(`${GL} startTimer()`);
}

export function stopTimer() {
  console.log(`${GL} stopTimer()`);
}
-->
