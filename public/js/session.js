// public/js/session.js
// -------------------------------------------------------
// Session + DOM + Helpers (Node backend compatible)
// -------------------------------------------------------

// -------------------------------------------------------
// Imports MUST be first in ES modules
// -------------------------------------------------------
import { DEBUG } from "./debug.js";
import { socket } from "./socket.js";

// -------------------------------------------------------
// Prevent duplicate session.js execution
// -------------------------------------------------------
if (window.__SESSION_ALREADY_LOADED__) {
  console.warn("[session] Duplicate session.js ignored");
} else {
  window.__SESSION_ALREADY_LOADED__ = true;
}

console.log("[session] LOADED");

// Debug counter
window._session_debug = (window._session_debug || 0) + 1;
console.log("session.js load count:", window._session_debug);

// -------------------------------------------------------
// API base
// -------------------------------------------------------
export const API_BASE = "https://letsee-backend.onrender.com";

// -------------------------------------------------------
// Load identity from backend
// -------------------------------------------------------
async function loadIdentity() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: "include",
    });

    if (!res.ok) throw new Error(`Identity request failed: ${res.status}`);

    const data = await res.json();
    const u = data.user;

    window.user_id = u.user_id;
    window.fullname = u.fullname;
    window.avatar = u.avatar;

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
  return window.user_id ? Number(window.user_id) : null;
}

export function getMyFullname() {
  return window.fullname || "";
}

export function getMyAvatar() {
  return window.avatar || null;
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
// Messaging UI Elements
// -------------------------------------------------------
export const msgForm = el("text_box_reply");
export const msgInput = el("message_input");
export const messageWin = qs(".message_win1");

export const attachmentInput = el("attachment_input");
export const previewDiv = el("attachmentPreview");
export const attachmentBtn = el("sheetFile");
export const notificationSound = el("notification");

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
// Socket registration
// -------------------------------------------------------
window.socketRegistered = false;

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

socket.on("registered", () => {
  window.socketRegistered = true;
  console.log("[socket] Registration ACK received");
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
// Auto logout after inactivity
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







































