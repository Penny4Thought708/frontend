// public/js/webrtc/RemoteParticipants.js
// Pro-grade participant tile manager for Meet/Discord-style grid
// Updated for:
// - Orientation-aware remote video (portrait/landscape)
// - Primary remote video selection (for PiP-safe logic)
// - Dedicated orientation data channel (A1)
// - Full compatibility with updated CallUI.js

const participants = new Map(); // peerId -> entry
let gridEl = null;
let localTileEl = null;

/* -------------------------------------------------------
   Internal: ensure grid + local tile are wired
------------------------------------------------------- */
function ensureInitialized() {
  if (!gridEl) {
    gridEl = document.getElementById("callGrid");
    if (!gridEl) {
      console.warn("[RemoteParticipants] #callGrid not found");
    }
  }

  if (!localTileEl) {
    localTileEl = document.getElementById("localParticipant") || null;
    if (localTileEl) {
      localTileEl.dataset.peerId = "local";
      localTileEl.classList.add("participant", "local");
    }
  }
}

/* -------------------------------------------------------
   Initialization (optional external call)
------------------------------------------------------- */
export function initRemoteParticipants() {
  ensureInitialized();
}

/* -------------------------------------------------------
   Register Local Tile (if CallUI wants to override)
------------------------------------------------------- */
export function registerLocalTile(el) {
  localTileEl = el || null;
  if (localTileEl) {
    localTileEl.dataset.peerId = "local";
    localTileEl.classList.add("participant", "local");
  }
}

/* -------------------------------------------------------
   Internal: Safe Template Clone
------------------------------------------------------- */
function safeCloneTemplate(tplId) {
  const tpl = document.getElementById(tplId);
  if (!tpl || !tpl.content || !tpl.content.firstElementChild) {
    console.warn(`[RemoteParticipants] Template #${tplId} missing or invalid`);
    return null;
  }
  return tpl.content.firstElementChild.cloneNode(true);
}

/* -------------------------------------------------------
   Create Tile (remote only)
------------------------------------------------------- */
function createTile(peerId, displayName, avatarUrl) {
  peerId = String(peerId);

  ensureInitialized();

  if (!gridEl) {
    console.warn("[RemoteParticipants] createTile aborted — no gridEl");
    return null;
  }

  if (participants.has(peerId)) return participants.get(peerId);

  const node = safeCloneTemplate("remoteParticipantTemplate");
  if (!node) return null;

  node.classList.add("participant", "remote");
  node.dataset.peerId = peerId;

  const videoEl = node.querySelector("video");
  const avatarEl = node.querySelector(".avatar-wrapper");
  const imgEl = node.querySelector(".avatar-img");
  const nameEl = node.querySelector(".name-tag");

  if (nameEl && displayName) nameEl.textContent = displayName;
  if (avatarUrl && imgEl) imgEl.src = avatarUrl;

  // Join animation
  node.classList.add("joining");
  gridEl.appendChild(node);
  requestAnimationFrame(() => {
    node.classList.remove("joining");
    node.classList.add("joined");
  });

  const entry = {
    peerId,
    el: node,
    videoEl,
    avatarEl,
    imgEl,
    nameEl,
    displayName: displayName || "",
    avatarUrl: avatarUrl || "",
    stream: null,
    cameraOff: false,
    speaking: false,

    // NEW: orientation state
    orientation: "landscape",

    // NEW: primary remote tile flag
    isPrimary: false,
  };

  participants.set(peerId, entry);
  return entry;
}

/* -------------------------------------------------------
   Remove Participant
------------------------------------------------------- */
export function removeParticipant(peerId) {
  peerId = String(peerId);
  const entry = participants.get(peerId);

  if (!entry) return;

  try {
    entry.el.classList.add("leaving");
    setTimeout(() => {
      try {
        entry.el.remove();
      } catch {}
    }, 220);
  } catch {
    try {
      entry.el.remove();
    } catch {}
  }

  participants.delete(peerId);
}

/* -------------------------------------------------------
   Core: attach a MediaStream to a participant tile
------------------------------------------------------- */
export function attachParticipantStream(peerId, stream) {
  peerId = String(peerId);

  ensureInitialized();

  const entry = participants.get(peerId) || createTile(peerId);
  if (!entry) return null;

  entry.stream = stream || null;

  if (entry.videoEl && stream) {
    try {
      if (entry.videoEl.srcObject !== stream) {
        entry.videoEl.srcObject = stream;
      }
      entry.videoEl.playsInline = true;
      entry.videoEl.muted = true; // audio comes from #remoteAudio
      entry.videoEl.classList.add("show");

      const tryPlay = () => {
        entry.videoEl
          .play()
          .catch((err) => {
            console.warn(
              "[RemoteParticipants] remote video play blocked:",
              err?.name || err
            );
          });
      };

      if (entry.videoEl.readyState >= 2) {
        tryPlay();
      } else {
        entry.videoEl.onloadedmetadata = () => {
          tryPlay();
        };
      }
    } catch (err) {
      console.error("[RemoteParticipants] Failed to bind remote video:", err);
    }
  }

  return entry;
}

/* -------------------------------------------------------
   Backwards‑compat alias
------------------------------------------------------- */
export function attachStream(peerId, stream) {
  return attachParticipantStream(peerId, stream);
}

/* -------------------------------------------------------
   Camera Off / On
------------------------------------------------------- */
export function setParticipantCameraOff(peerId, off) {
  peerId = String(peerId);
  const entry = participants.get(peerId);
  if (!entry) return;

  entry.cameraOff = !!off;

  if (entry.videoEl) {
    if (off) {
      entry.videoEl.classList.remove("show");
    } else {
      entry.videoEl.classList.add("show");
    }
  }

  if (entry.avatarEl) {
    if (off) {
      entry.avatarEl.classList.remove("hidden");
    } else {
      entry.avatarEl.classList.add("hidden");
    }
  }
}

/* -------------------------------------------------------
   Speaking Indicator
------------------------------------------------------- */
export function setParticipantSpeaking(peerId, active, level = 1) {
  peerId = String(peerId);
  const entry = participants.get(peerId);
  if (!entry) return;

  const isActive = !!active;
  entry.speaking = isActive;

  try {
    entry.el.classList.toggle("speaking", isActive);
  } catch {}

  const safeLevel = isActive ? Number(level) || 1 : 0;
  try {
    entry.el.style.setProperty("--audio-level", String(safeLevel));
  } catch {}
}

/* -------------------------------------------------------
   Update Display Name
------------------------------------------------------- */
export function setParticipantName(peerId, name) {
  peerId = String(peerId);
  const entry = participants.get(peerId);
  if (!entry) return;

  if (entry.nameEl && typeof name === "string") {
    entry.nameEl.textContent = name;
    entry.displayName = name;
  }
}

/* -------------------------------------------------------
   Update Avatar
------------------------------------------------------- */
export function setParticipantAvatar(peerId, url) {
  peerId = String(peerId);
  const entry = participants.get(peerId);
  if (!entry) return;

  if (entry.imgEl && typeof url === "string" && url.length > 0) {
    entry.imgEl.src = url;
    entry.avatarUrl = url;
  }
}

/* -------------------------------------------------------
   NEW: Orientation-aware remote video
------------------------------------------------------- */
export function setParticipantOrientation(peerId, orientation) {
  peerId = String(peerId);
  const entry = participants.get(peerId);
  if (!entry || !entry.el) return;

  entry.orientation = orientation === "portrait" ? "portrait" : "landscape";

  entry.el.classList.remove("portrait", "landscape");
  entry.el.classList.add(entry.orientation);

  if (entry.videoEl) {
    if (entry.orientation === "portrait") {
      entry.videoEl.style.objectFit = "contain";
    } else {
      entry.videoEl.style.objectFit = "cover";
    }
  }
}

/* -------------------------------------------------------
   NEW: Primary Remote Tile (for PiP-safe logic)
------------------------------------------------------- */
export function setPrimaryRemote(peerId) {
  peerId = String(peerId);

  for (const [, entry] of participants.entries()) {
    entry.isPrimary = false;
    entry.el.classList.remove("primary-remote");
  }

  const entry = participants.get(peerId);
  if (entry) {
    entry.isPrimary = true;
    entry.el.classList.add("primary-remote");
  }
}

/* -------------------------------------------------------
   NEW: Get Primary Remote Video Element
------------------------------------------------------- */
export function getPrimaryRemoteVideo() {
  // 1. Explicit primary
  for (const [, entry] of participants.entries()) {
    if (entry.isPrimary && entry.videoEl && entry.stream) {
      return entry.videoEl;
    }
  }

  // 2. First active video
  for (const [, entry] of participants.entries()) {
    if (entry.videoEl && entry.stream) {
      return entry.videoEl;
    }
  }

  return null;
}

/* -------------------------------------------------------
   Get Participant Entry (for CallUI / diagnostics)
------------------------------------------------------- */
export function getParticipant(peerId) {
  peerId = String(peerId);
  return participants.get(peerId) || null;
}

/* -------------------------------------------------------
   Get All Participants (read-only snapshot)
------------------------------------------------------- */
export function getAllParticipants() {
  return Array.from(participants.values());
}

/* -------------------------------------------------------
   Active Speaker Highlight (CallUI-driven)
------------------------------------------------------- */
export function markActiveSpeaker(peerId) {
  peerId = String(peerId);

  // Remove from all remote tiles
  for (const [, entry] of participants.entries()) {
    try {
      entry.el.classList.remove("active-speaker");
    } catch {}
  }

  // Remove from local tile
  if (localTileEl) {
    try {
      localTileEl.classList.remove("active-speaker");
    } catch {}
  }

  // Apply to target
  if (peerId === "local") {
    if (localTileEl) {
      localTileEl.classList.add("active-speaker");
    }
    return;
  }

  const entry = participants.get(peerId);
  if (entry && entry.el) {
    entry.el.classList.add("active-speaker");
  }
}

/* -------------------------------------------------------
   Clear All Participants (on call end)
------------------------------------------------------- */
export function clearAllParticipants() {
  for (const [, entry] of participants.entries()) {
    try {
      entry.el.remove();
    } catch {}
  }
  participants.clear();

  if (localTileEl) {
    try {
      localTileEl.classList.remove("active-speaker");
      localTileEl.classList.remove("voice-only");
      localTileEl.style.removeProperty("--audio-level");
    } catch {}
  }
}
