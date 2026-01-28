// public/js/session.js
// -------------------------------------------------------
// Session + DOM + Helpers (Node backend compatible)
// -------------------------------------------------------

import { DEBUG } from "./debug.js";
import { socket } from "./socket.js";

const w = typeof window !== "undefined" ? window : {};
console.log("[session] LOADED");
w._session_debug = (w._session_debug || 0) + 1;
console.log("session.js load count:", w._session_debug);

// -------------------------------------------------------
// API base
// -------------------------------------------------------
export const API_BASE = "https://letsee-backend.onrender.com";

// -------------------------------------------------------
// ⭐ Load identity from backend (Node version)
// -------------------------------------------------------
async function loadIdentity() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include",
    });

    if (!res.ok) throw new Error(`Identity request failed: ${res.status}`);

    const data = await res.json();
    const u = data.user;

    w.user_id = u.user_id;
    w.fullname = u.fullname;
    w.avatar = u.avatar;

    console.log("[session] Identity loaded:", u);
  } catch (err) {
    console.error("[session] Failed to load identity:", err);
  }
}

loadIdentity();

// -------------------------------------------------------
// Identity getters
// -------------------------------------------------------
export function getMyUserId() {
  return w.user_id ? Number(w.user_id) : null;
}

export function getMyFullname() {
  return w.fullname || "";
}

export function getMyAvatar() {
  return w.avatar || null;
}

// -------------------------------------------------------
// Avatar URL helper
// -------------------------------------------------------
export function avatarUrl(filename) {
  if (!filename) return "/img/defaultUser.png";
  return `${API_BASE}/uploads/avatars/${filename}`;
}

// -------------------------------------------------------
// DOM helpers
// -------------------------------------------------------
const el = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

// -------------------------------------------------------
// ⭐ Messaging UI Elements (UPDATED TO MATCH YOUR HTML)
// -------------------------------------------------------
export const msgForm = el("text_box_reply");               // <form>
export const msgInput = el("message_input");               // contenteditable div
export const messageWin = qs(".message_win1");             // message window

export const attachmentInput = el("attachment_input");     // <input type="file">
export const previewDiv = el("attachmentPreview");         // preview container

// You can choose which button opens the file picker:
// Option A: bottom sheet "File" button
export const attachmentBtn = el("sheetFile");

// Option B: the + button (uncomment if you prefer)
// export const attachmentBtn = el("plusBtn");

export const badge = qs(".notification-badge .badge");
export const messageBox = el("messaging_box");
export const msgOpenBtn = el("msg_open_btn");
export const closeMsgBtn = el("close_msg_box");

// -------------------------------------------------------
// Lookup UI
// -------------------------------------------------------
export const lookupBtn = el("lookup-btn");
export const lookupInput = el("lookup-input");
export const lookupResults = el("contacts-lookup");

// -------------------------------------------------------
// Call UI Elements
// -------------------------------------------------------
export const videoContainer = el("video-container");
export const remoteWrapper = el("remoteWrapper");
export const localWrapper = el("localVideoWrapper");

export function getVoiceBtn() {
  return el("voiceBtn");
}
export function getVideoBtn() {
  return el("videoBtn");
}

export const localNameDiv = el("localName");
export const remoteNameDiv = el("remoteName");

export let localVideo;
export let remoteVideo;
export let remoteAudioEl;

document.addEventListener("DOMContentLoaded", () => {
  localVideo = el("localVideo");
  remoteVideo = el("remoteVideo");
  remoteAudioEl = el("remoteAudio");
});

export const ringtone = el("ringtone");
export const ringback = el("ringback");

export const muteBtn = el("mute-call");
export const camBtn = el("camera-toggle");

export const answerBtn = el("answer-call");
export const declineBtn = el("decline-call");
export const callControls = el("call-controls");
export const endBtn = el("end-call");
export const callerOverlay = el("callerOverlay");

// -------------------------------------------------------
// Search UI
// -------------------------------------------------------
export const contractorQuery = el("contractorQuery");
export const searchBtn = el("searchBtn");
export const searchResults = el("searchResults");

// Alias
export const messagesContainer = messageWin;

// Top bar
export const topBar = el("topBar");

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
export function safeJSON(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

export function playNotification() {
  if (!notificationSound) return;
  notificationSound.currentTime = 0;
  notificationSound
    .play()
    .catch((err) => console.warn("Notification sound blocked:", err));
}

// -------------------------------------------------------
// Node-compatible API helpers
// -------------------------------------------------------
export async function getJson(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

export async function postJson(url, body = {}) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json();
}

export async function postForm(path, payload) {
  const cleanPath = path.replace(".php", "");
  const url = cleanPath.startsWith("http")
    ? cleanPath
    : `${API_BASE}${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("Non-JSON response from", url, ":", text);
    throw new Error("Invalid JSON response");
  }
}

// -------------------------------------------------------
// Scroll helper
// -------------------------------------------------------
export function scrollMessagesToBottom() {
  if (!messagesContainer) return;
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// -------------------------------------------------------
// Call View Helpers
// -------------------------------------------------------
export function showCallView() {
  videoContainer?.classList.add("active");
  messageBox?.classList.remove("active");
}

export function endCall({
  pc,
  dataChannel,
  localStream,
  stopAudio,
  showEndButton,
  showControls,
  setIncomingUI,
}) {
  try {
    pc?.getSenders()?.forEach((s) => s.track?.stop?.());
  } catch {}
  try {
    pc?.close();
  } catch {}

  try {
    dataChannel?.close();
  } catch {}
  try {
    localStream?.getTracks()?.forEach((t) => t.stop());
  } catch {}

  ["localVideo", "remoteVideo", "localAudio", "remoteAudio"].forEach((id) => {
    const x = el(id);
    if (x) x.srcObject = null;
  });

  showEndButton?.(false);
  showControls?.(false);
  setIncomingUI?.(false, "");

  stopAudio?.(ringtone);
  stopAudio?.(ringback);

  videoContainer?.classList.remove("active");
  messageBox?.classList.add("active");
}

// -------------------------------------------------------
// ⭐ Correct Node-compatible socket registration
// -------------------------------------------------------
socket.on("connect", () => {
  const tryRegister = () => {
    const uid = getMyUserId();
    if (!uid) {
      setTimeout(tryRegister, 200);
      return;
    }

    socket.emit("register", uid);
    console.log("[socket] Registered:", uid);
  };

  tryRegister();
});

socket.on("reconnect_attempt", (n) => {
  if (DEBUG.socket && (n === 1 || n % 5 === 0)) {
    console.log("[socket] Reconnect attempt:", n);
  }
});

socket.on("reconnect_failed", () => {
  if (DEBUG.socket) {
    console.warn("[socket] Reconnect failed");
  }
});

socket.on("error", (err) => {
  if (DEBUG.socket) {
    console.warn("[socket] Error:", err?.message || err);
  }
});

// -------------------------------------------------------
// AUTO LOGOUT AFTER INACTIVITY
// -------------------------------------------------------
let inactivityTimer;
const AUTO_LOGOUT_MINUTES = 30;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);

  inactivityTimer = setTimeout(async () => {
    console.log("[session] Auto-logout due to inactivity");

    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });

    window.location.href = "index.html";
  }, AUTO_LOGOUT_MINUTES * 60 * 1000);
}

["click", "mousemove", "keydown", "scroll", "touchstart"].forEach((evt) => {
  window.addEventListener(evt, resetInactivityTimer);
});

resetInactivityTimer();
































