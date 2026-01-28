// public/js/globals.js
// Clean ES-module helpers used by WebRTCController + CallUI

import { getIceServers as loadIce } from "./ice.js";
import { getMyUserId, getMyFullname } from "./session.js";

const GL_TAG = "[globals]";

// -----------------------------------------------------
// Identity helpers (WebRTCController depends on these)
// -----------------------------------------------------
export function getMyUserIdSafe() {
  const id = getMyUserId();
  if (!id) {
    console.warn(`${GL_TAG} getMyUserId(): no user_id available`);
  } else {
    console.debug(`${GL_TAG} getMyUserId():`, id);
  }
  return id;
}

export function getMyFullnameSafe() {
  const name = getMyFullname();
  if (!name) {
    console.warn(`${GL_TAG} getMyFullname(): no fullname available`);
  } else {
    console.debug(`${GL_TAG} getMyFullname():`, name);
  }
  return name;
}

// -----------------------------------------------------
// Receiver helper (messaging.js sets window.currentReceiverId)
// -----------------------------------------------------
export function getReceiver() {
  const receiver = window.currentReceiverId ?? null;
  if (!receiver) {
    console.warn(`${GL_TAG} getReceiver(): no currentReceiverId`);
  } else {
    console.debug(`${GL_TAG} getReceiver():`, receiver);
  }
  return receiver;
}

// -----------------------------------------------------
// ICE / TURN configuration (WebRTCController calls this)
// -----------------------------------------------------
export async function getIceServers() {
  try {
    const servers = await loadIce();
    console.debug(`${GL_TAG} ICE servers loaded:`, servers);
    return servers;
  } catch (err) {
    console.warn(`${GL_TAG} ICE fallback STUN used`, err);
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

// -----------------------------------------------------
// UI state machine hook (WebRTCController triggers this)
// CallUI.js handles the actual DOM updates
// -----------------------------------------------------
export const UI = {
  apply(state, data) {
    console.log("[UI.apply]", state, data);
    // CallUI.js handles real UI transitions
  }
};

// -----------------------------------------------------
// Media + avatar helpers (WebRTCController calls these)
// CallUI.js handles actual DOM work
// -----------------------------------------------------
export function showLocalVideo() {
  console.log(`${GL_TAG} showLocalVideo()`);
}

export function fadeInVideo(el) {
  console.log(`${GL_TAG} fadeInVideo()`, el);
}

export function showLocalAvatar() {
  console.log(`${GL_TAG} showLocalAvatar()`);
}

export function showRemoteAvatar() {
  console.log(`${GL_TAG} showRemoteAvatar()`);
}

export function showRemoteVideo() {
  console.log(`${GL_TAG} showRemoteVideo()`);
}

export function setRemoteAvatar(avatar) {
  console.log(`${GL_TAG} setRemoteAvatar():`, avatar);
}

// -----------------------------------------------------
// Audio helpers (WebRTCController uses these)
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
    console.warn(`${GL_TAG} stopAudio(): error`, err);
  }
}

// -----------------------------------------------------
// Timer helpers (WebRTCController calls these)
// -----------------------------------------------------
export function startTimer() {
  console.log(`${GL_TAG} startTimer()`);
}

export function stopTimer() {
  console.log(`${GL_TAG} stopTimer()`);
}
