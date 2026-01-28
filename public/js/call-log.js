// =======================================================
//  call-log.js — Polished for Node Backend + GitHub Pages
// =======================================================

import { 
  getVoiceBtn, 
  getVideoBtn, 
  avatarUrl 
} from "./session.js";

const API_BASE = "https://letsee-backend.onrender.com/api";

// =======================================================
//  CONTACT LOOKUP
// =======================================================

let contactLookup = [];

export function setContactLookup(list) {
  contactLookup = Array.isArray(list) ? list : [];
}

function findContact(id) {
  return contactLookup.find((c) => String(c.contact_id) === String(id)) || null;
}

// =======================================================
//  LOCAL STATE
// =======================================================

let callLogCache = [];
let callLogPageOffset = 0;
const PAGE_SIZE = 30;
let loading = false;
let hasMore = true;

let socketRef = null;

// =======================================================
//  DOM ELEMENTS
// =======================================================

const CALL_LOG_VERSION = 2;

const listEl = document.getElementById("callLogList");
const searchEl = document.getElementById("callLogSearch");
const statsEl = document.getElementById("callStats");
const detailsOverlay = document.getElementById("callDetailsOverlay");
const detailsContent = document.getElementById("callDetailsContent");
const closeDetails = document.getElementById("closeCallDetails");

let lastDateKey = null;

// =======================================================
//  NETWORK HELPERS
// =======================================================

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    credentials: "include",
    ...opts,
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("Invalid JSON:", text);
    throw new Error("Invalid JSON");
  }
}

async function postJSON(url, body = {}) {
  return fetchJSON(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// =======================================================
//  DATE HELPERS
// =======================================================

function getDateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function insertDateHeader(ts) {
  const key = getDateKey(ts);
  if (key === lastDateKey) return;

  lastDateKey = key;

  const header = document.createElement("div");
  header.className = "call-log-date-header";
  header.textContent = formatDate(ts);
  listEl.appendChild(header);
}

// =======================================================
//  DETAILS OVERLAY
// =======================================================

closeDetails?.addEventListener("click", () => {
  detailsOverlay?.classList.remove("active");
});

function openDetails(id) {
  const log = callLogCache.find((l) => String(l.logId) === String(id));
  if (!log) return;

  const dur = log.duration || 0;
  const m = Math.floor(dur / 60);
  const s = String(dur % 60).padStart(2, "0");

  detailsContent.innerHTML = `
    <div class="call-details-row"><span>Caller</span><span>${log.caller_name || ""}</span></div>
    <div class="call-details-row"><span>Receiver</span><span>${log.receiver_name || ""}</span></div>
    <div class="call-details-row"><span>Type</span><span>${log.call_type}</span></div>
    <div class="call-details-row"><span>Direction</span><span>${log.direction}</span></div>
    <div class="call-details-row"><span>Status</span><span>${log.status}</span></div>
    <div class="call-details-row"><span>Duration</span><span>${m}:${s}</span></div>
    <div class="call-details-row"><span>Time</span><span>${new Date(log.timestamp).toLocaleString()}</span></div>
  `;

  detailsOverlay.classList.add("active");
}

// =======================================================
//  AVATAR NORMALIZER
// =======================================================

export function normalizeAvatarPath(path) {
  return avatarUrl(path);
}

// =======================================================
//  ICON MAP
// =======================================================

const ICONS = {
  incoming: {
    voice: "call_received",
    video: "video_call",
  },
  outgoing: {
    voice: "call_made",
    video: "video_call",
  },
  missed: {
    incoming: "call_received",
    outgoing: "call_missed_outgoing",
    video: "missed_video_call",
  },
};

// =======================================================
//  CALL LOG NORMALIZER
// =======================================================

function normalizeCallLog(raw, sessionUserId) {
  let direction = String(raw.direction || "").toLowerCase();
  const status = String(raw.status || "").toLowerCase();
  const callType = String(raw.call_type || "").toLowerCase();

  if (status === "missed") {
    direction = String(raw.receiver_id) === String(sessionUserId)
      ? "incoming"
      : "outgoing";
  }

  const isOutgoing = direction === "outgoing";
  const isIncoming = direction === "incoming";
  const isMissed = status === "missed";

  const otherId =
    raw.other_party_id ??
    (isOutgoing ? raw.receiver_id : raw.caller_id);

  const contact = findContact(otherId);

  const nameFromRow = isOutgoing ? raw.receiver_name : raw.caller_name;
  const avatarFromRow = isOutgoing ? raw.receiver_avatar : raw.caller_avatar;

  const avatar = normalizeAvatarPath(contact?.avatar || avatarFromRow);

  let icon = "";
  let iconClass = "";

  if (isMissed) {
    if (isIncoming) {
      icon = ICONS.missed.incoming;
      iconClass = "call-icon-incoming missed-inbound";
    } else {
      icon = callType === "video"
        ? ICONS.missed.video
        : ICONS.missed.outgoing;
      iconClass = "call-icon-missed";
    }
  } else {
    icon =
      ICONS[direction]?.[callType] ||
      ICONS[direction]?.voice ||
      "call";
    iconClass = `call-icon-${direction}`;
  }

  const directionLabel = isOutgoing ? "Outgoing" : "Incoming";
  const callTypeLabel = callType === "video" ? "Video call" : "Voice call";

  return {
    ...raw,
    __version: CALL_LOG_VERSION,
    logId: raw.id,
    direction,
    status,
    call_type: callType,
    other_party_id: otherId,
    display_name: contact?.contact_name || nameFromRow || `User ${otherId}`,
    avatar,
    session_user_id: sessionUserId,

    icon,
    iconClass,
    directionLabel,
    callTypeLabel,
  };
}

function migrateLogIfNeeded(raw, sessionUserId) {
  if (!raw.__version || raw.__version < CALL_LOG_VERSION) {
    return normalizeCallLog(raw, sessionUserId);
  }
  return raw;
}

// =======================================================
//  RENDER ITEM
// =======================================================

function renderItem(log) {
  insertDateHeader(log.timestamp);

  const time = new Date(log.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const div = document.createElement("div");
  div.className = "call-log-item";
  div.dataset.id = log.logId;

  const iconHTML = `
    <span class="material-symbols-outlined ${log.iconClass} call-icon-click">
      ${log.icon}
    </span>
  `;

  div.innerHTML = `
    <div class="call-swipe-wrapper">
      <div class="call-log-main">
        <div class="call-avatar" style="background-image:url('${log.avatar}')"></div>

        <div class="call-info">
          <div class="call-name">${log.display_name}</div>

          <div class="call-meta">
            ${iconHTML}
            <span class="call-direction-label">${log.directionLabel}</span>
            <span class="call-type-label">${log.callTypeLabel}</span>

            ${
              log.status === "missed"
                ? `<span class="missed-badge">Missed</span>`
                : `<span class="call-status ${log.status}">${log.status}</span>`
            }

            <span class="call-time">${time}</span>
          </div>
        </div>

        <div class="call-actions">
          <button class="call-chat-btn" data-id="${log.other_party_id}">💬</button>
          <button class="call-redial-btn" data-id="${log.other_party_id}">📞</button>
          <button class="call-details-btn" data-id="${log.logId}">ℹ️</button>
        </div>
      </div>

      <button class="call-delete-btn">Delete</button>
    </div>
  `;

div.querySelector(".call-icon-click")?.addEventListener("click", (e) => {
  e.stopPropagation();

  window.setReceiver?.(log.other_party_id);

  const userRaw = {
    contact_id: log.other_party_id,
    contact_name: log.display_name,
    avatar: log.avatar
  };

  window.showMessageBoxOnly?.();
  window.openMessagesFor?.(userRaw);
});

div.querySelector(".call-chat-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();

  window.setReceiver?.(log.other_party_id);

  const userRaw = {
    contact_id: log.other_party_id,
    contact_name: log.display_name,
    avatar: log.avatar
  };

  window.showMessageBoxOnly?.();
  window.openMessagesFor?.(userRaw);
});

div.querySelector(".call-log-main")?.addEventListener("click", (e) => {
  if (e.target.closest(".call-actions") || e.target.closest(".call-delete-btn")) {
    return;
  }

  window.setReceiver?.(log.other_party_id);

  const userRaw = {
    contact_id: log.other_party_id,
    contact_name: log.display_name,
    avatar: log.avatar
  };

  window.showMessageBoxOnly?.();
  window.openMessagesFor?.(userRaw);
});


  div.querySelector(".call-details-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openDetails(log.logId);
  });

div.querySelector(".call-redial-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const id = e.currentTarget.dataset.id;

  // Set receiver globally
  window.setReceiver?.(id);

  // Open chat UI
  const userRaw = {
    contact_id: id,
    contact_name: log.display_name,
    avatar: log.avatar
  };
  window.showMessageBoxOnly?.();
  window.openMessagesFor?.(userRaw);

  // DIRECT WebRTC call — bypass CallUI buttons
  if (log.call_type === "video") {
    window.rtc?.startVideoCall(id);
  } else {
    window.rtc?.startVoiceCall(id);
  }
});


  attachSwipeHandlers(div, log.logId);
  listEl.appendChild(div);
}

// =======================================================
//  SWIPE DELETE
// =======================================================

function attachSwipeHandlers(el, id) {
  let startX = 0;
  let currentX = 0;

  const main = el.querySelector(".call-log-main");
  const del = el.querySelector(".call-delete-btn");

  function start(e) {
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    currentX = startX;
  }

  function move(e) {
    if (!startX) return;
    currentX = e.touches ? e.touches[0].clientX : e.clientX;
    const dx = currentX - startX;
    if (dx < 0 && dx > -80) {
      main.style.transform = `translateX(${dx}px)`;
      del.style.transform = `translateX(${80 + dx}px)`;
    }
  }

  function end() {
    const dx = currentX - startX;
    if (dx < -40) {
      el.classList.add("swiped");
      main.style.transform = `translateX(-80px)`;
      del.style.transform = `translateX(0)`;
    } else {
      el.classList.remove("swiped");
      main.style.transform = "";
      del.style.transform = "";
    }
    startX = 0;
  }

  main.addEventListener("mousedown", start);
  main.addEventListener("mousemove", move);
  main.addEventListener("mouseup", end);
  main.addEventListener("mouseleave", end);

  main.addEventListener("touchstart", start);
  main.addEventListener("touchmove", move);
  main.addEventListener("touchend", end);

  del.addEventListener("click", () => deleteLog(id, el));
}

// =======================================================
//  DELETE LOG
// =======================================================

async function deleteLog(id, el) {
  el.remove();
  callLogCache = callLogCache.filter((l) => String(l.logId) !== String(id));
  localStorage.setItem("callLogs", JSON.stringify(callLogCache));

  try {
    await postJSON(`${API_BASE}/call-logs/delete`, { logId: id });
    socketRef?.emit("call:log:delete", { logId: id });
  } catch (err) {
    console.error("Failed to delete call log:", err);
  }

  updateStats();
}

// =======================================================
//  STATS
// =======================================================

function updateStats() {
  if (!statsEl) return;

  const total = callLogCache.length;
  const missed = callLogCache.filter((l) => l.status === "missed").length;
  const rejected = callLogCache.filter((l) => l.status === "rejected").length;
  const outgoing = callLogCache.filter((l) => l.direction === "outgoing").length;
  const incoming = callLogCache.filter((l) => l.direction === "incoming").length;

  const totalSec = callLogCache.reduce((s, l) => s + (l.duration || 0), 0);
  const totalMin = Math.round(totalSec / 60);

  statsEl.innerHTML = `
    <span>Total: ${total}</span>
    <span>Incoming: ${incoming}</span>
    <span>Outgoing: ${outgoing}</span>
    <span>Missed: ${missed}</span>
    <span>Rejected: ${rejected}</span>
    <span>Minutes: ${totalMin}</span>
  `;
}

// =======================================================
//  LOAD PAGE (FIXED FOR NODE BACKEND)
// =======================================================

async function loadPage(initial = false) {
  if (loading || !hasMore) return;
  loading = true;

  try {
    const data = await fetchJSON(
      `${API_BASE}/call-logs?offset=${callLogPageOffset}&limit=${PAGE_SIZE}`
    );

    const sessionUserId = window.user_id;
    const stored = JSON.parse(localStorage.getItem("callLogs") || "[]");

    const logs = (data.logs || []).map(raw => {
      const existing = stored.find(l =>
        String(l.logId ?? l.id) === String(raw.id)
      );

      if (existing) {
        const migrated = migrateLogIfNeeded(existing, sessionUserId);
        debugLogEntry(raw, migrated, existing);
        return migrated;
      }

      return normalizeCallLog(raw, sessionUserId);
    });

    if (initial) {
      callLogCache = [];
      listEl.innerHTML = "";
      lastDateKey = null;
    }

    callLogCache = callLogCache.concat(logs);
    logs.forEach(renderItem);

    callLogPageOffset += logs.length;
    hasMore = !!data.hasMore;

    localStorage.setItem("callLogs", JSON.stringify(callLogCache));
    updateStats();
  } catch (err) {
    console.error("loadPage failed", err);
  } finally {
    loading = false;
  }
}

// =======================================================
//  DEBUG PANEL
// =======================================================

let debugMode = false;

document.addEventListener("keydown", (e) => {
  const key = e.key?.toLowerCase();
  if (key === "d") {
    debugMode = !debugMode;
    document.body.classList.toggle("calllog-debug", debugMode);
  }
});

function debugLogEntry(raw, normalized, stored) {
  if (!debugMode) return;

  const panel = document.getElementById("callLogDebugPanel");
  if (!panel) return;

  const div = document.createElement("div");
  div.className = "debug-entry";

  div.innerHTML = `
    <strong>ID: ${raw.id}</strong><br>
    <pre>RAW:
${JSON.stringify(raw, null, 2)}</pre>
    <pre>NORMALIZED:
${JSON.stringify(normalized, null, 2)}</pre>
    <pre>STORED:
${JSON.stringify(stored, null, 2)}</pre>
  `;

  panel.prepend(div);
}

// =======================================================
//  REAL-TIME ADD
// =======================================================

export function addCallLogEntry(raw) {
  if (!raw) return;

  const sessionUserId =
    raw.session_user_id || raw.userId || window.user_id;

  const log = normalizeCallLog(raw, sessionUserId);
  debugLogEntry(raw, log, null);

  callLogCache.unshift(log);
  localStorage.setItem("callLogs", JSON.stringify(callLogCache));

  listEl.innerHTML = "";
  lastDateKey = null;
  callLogCache.forEach(renderItem);
  updateStats();
}

// =======================================================
//  INIT + REFRESH
// =======================================================

export function initCallLogs({ socket }) {
  socketRef = socket;

  localStorage.removeItem("callLogs");
  callLogCache = [];
  callLogPageOffset = 0;
  hasMore = true;
  lastDateKey = null;

  listEl.innerHTML = "";
  loadPage(true);
}

export function refreshCallLogs() {
  callLogPageOffset = 0;
  hasMore = true;
  callLogCache = [];
  lastDateKey = null;
  localStorage.removeItem("callLogs");

  listEl.innerHTML = "";
  loadPage(true);
}





