// public/js/globals.js
// Clean ES-module helpers used by WebRTCController + CallUI

import { getIceServers as loadIce } from "./ice.js";
import { getMyUserId, getMyFullname } from "./session.js";

const GL_TAG = "[globals]";

// -----------------------------------------------------
// Identity helpers (safe wrappers around session.js)
// -----------------------------------------------------
export function getMyUserIdSafe() {
  const id = getMyUserId();
  if (!id) {
    console.warn(`${GL_TAG} No user_id available`);
  } else {
    console.debug(`${GL_TAG} getMyUserId():`, id);
  }
  return id;
}

export function getMyFullnameSafe() {
  const name = getMyFullname();
  if (!name) {
    console.warn(`${GL_TAG} No fullname available`);
  } else {
    console.debug(`${GL_TAG} getMyFullname():`, name);
  }
  return name;
}

// -----------------------------------------------------
// Receiver helper (CallUI + messaging.js set this)
// -----------------------------------------------------
export function getReceiver() {
  const receiver = window.currentReceiverId ?? null;
  if (!receiver) {
    console.warn(`${GL_TAG} No currentReceiverId on window`);
  } else {
    console.debug(`${GL_TAG} getReceiver():`, receiver);
  }
  return receiver;
}

// -----------------------------------------------------
// ICE / TURN configuration (delegates to ice.js)
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
// UI state machine hook (CallUI handles real DOM updates)
// -----------------------------------------------------
export const UI = {
  apply(state, data) {
    console.log("[UI.apply]", state, data);
    // CallUI.js handles actual UI transitions
  }
};

// -----------------------------------------------------
// Media + avatar helpers (CallUI handles DOM)
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
// Audio helpers
// -----------------------------------------------------
export function getRingtone() {
  console.log(`${GL_TAG} getRingtone()`);
  return window.ringtone || null;
}

export function getRingback() {
  console.log(`${GL_TAG} getRingback()`);
  return window.ringback || null;
}

export function stopAudio(audio) {
  if (!audio) {
    console.warn(`${GL_TAG} stopAudio(): no audio instance`);
    return;
  }
  try {
    console.debug(`${GL_TAG} stopAudio(): stopping`, audio);
    audio.pause();
    audio.currentTime = 0;
  } catch (err) {
    console.warn(`${GL_TAG} stopAudio(): error`, err);
  }
}

// -----------------------------------------------------
// Timer helpers
// -----------------------------------------------------
export function startTimer() {
  console.log(`${GL_TAG} startTimer()`);
}

export function stopTimer() {
  console.log(`${GL_TAG} stopTimer()`);
}


