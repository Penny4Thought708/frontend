// public/js/webrtc/RemoteParticipants.js
// PURE TILE MANAGER — no layout logic, no screen-share logic, no active-speaker logic.
// CallUI.js now owns ALL layout classes and UI behavior.
// This file ONLY manages participant tiles, media binding, and basic state.

const participants = new Map(); // peerId -> entry
let gridEl = null;
let localTileEl = null;

/* -------------------------------------------------------
   Initialization
------------------------------------------------------- */
export function initRemoteParticipants() {
  gridEl = document.getElementById("callGrid");
  if (!gridEl) {
    console.warn("[RemoteParticipants] #callGrid not found");
    return;
  }

  localTileEl = document.getElementById("localParticipant") || null;
}

/* -------------------------------------------------------
   Register Local Tile
------------------------------------------------------- */
export function registerLocalTile(el) {
  localTileEl = el;
  if (localTileEl) {
    localTileEl.dataset.peerId = "local";
  }
}

/* -------------------------------------------------------
   Create Tile
------------------------------------------------------- */
function createTile(peerId, displayName, avatarUrl) {
  if (!gridEl) initRemoteParticipants();
  if (!gridEl) return null;

  if (participants.has(peerId)) return participants.get(peerId);

  const tpl = document.getElementById("remoteParticipantTemplate");
  if (!tpl) {
    console.warn("[RemoteParticipants] remoteParticipantTemplate missing");
    return null;
  }

  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.peerId = peerId;

  const videoEl  = node.querySelector("video");
  const avatarEl = node.querySelector(".avatar-wrapper");
  const imgEl    = node.querySelector(".avatar-img");
  const nameEl   = node.querySelector(".name-tag");

  if (displayName) nameEl.textContent = displayName;
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
    displayName,
    avatarUrl,
    stream: null,
    cameraOff: false,
    speaking: false
  };

  participants.set(peerId, entry);
  return entry;
}

/* -------------------------------------------------------
   Remove Participant
------------------------------------------------------- */
export function removeParticipant(peerId) {
  const entry = participants.get(peerId);
  if (!entry) return;

  entry.el.classList.add("leaving");
  setTimeout(() => entry.el.remove(), 220);

  participants.delete(peerId);
}

/* -------------------------------------------------------
   Attach MediaStream (from controller)
------------------------------------------------------- */
export function attachStream(peerId, stream) {
  const entry = participants.get(peerId) || createTile(peerId);
  if (!entry) return null;

  entry.stream = stream;

  if (entry.videoEl) {
    entry.videoEl.srcObject = stream;
    entry.videoEl.playsInline = true;
    entry.videoEl.muted = true;

    entry.videoEl.onloadedmetadata = () => {
      entry.videoEl.play().catch(() => {});
    };
  }

  return entry;
}

/* -------------------------------------------------------
   Camera Off / On (CallUI handles layout classes)
------------------------------------------------------- */
export function setParticipantCameraOff(peerId, off) {
  const entry = participants.get(peerId);
  if (!entry) return;

  entry.cameraOff = off;

  // CallUI.js handles .voice-only class
  if (off) {
    entry.videoEl?.classList.remove("show");
    entry.avatarEl?.classList.remove("hidden");
  } else {
    entry.videoEl?.classList.add("show");
    entry.avatarEl?.classList.add("hidden");
  }
}

/* -------------------------------------------------------
   Speaking Indicator (CallUI handles active-speaker layout)
------------------------------------------------------- */
export function setParticipantSpeaking(peerId, active, level = 1) {
  const entry = participants.get(peerId);
  if (!entry) return;

  entry.speaking = active;

  // CSS handles glow animation
  entry.el.classList.toggle("speaking", !!active);

  // Audio level for CSS animations
  entry.el.style.setProperty("--audio-level", active ? String(level) : "0");
}

/* -------------------------------------------------------
   Update Display Name
------------------------------------------------------- */
export function setParticipantName(peerId, name) {
  const entry = participants.get(peerId);
  if (!entry) return;

  if (entry.nameEl && name) entry.nameEl.textContent = name;
}

/* -------------------------------------------------------
   Update Avatar
------------------------------------------------------- */
export function setParticipantAvatar(peerId, url) {
  const entry = participants.get(peerId);
  if (!entry) return;

  if (entry.imgEl && url) entry.imgEl.src = url;
}

/* -------------------------------------------------------
   Clear All Participants (on call end)
------------------------------------------------------- */
export function clearAllParticipants() {
  for (const [, entry] of participants.entries()) {
    entry.el.remove();
  }
  participants.clear();

  if (localTileEl) {
    localTileEl.classList.remove("active-speaker");
    localTileEl.classList.remove("voice-only");
  }
}



