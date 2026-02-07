// public/js/webrtc/RemoteParticipants.js
// Multi‑party participant manager for Aurora‑Prime.
// Handles: tile creation, join/leave animations, stage mode,
// speaking glow, camera‑off avatars, and per‑peer state.

const participants = new Map(); // peerId -> { el, videoEl, avatarEl, nameEl, imgEl }
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
   Tile Creation
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

  const entry = { el: node, videoEl, avatarEl, nameEl, imgEl };
  participants.set(peerId, entry);
  return entry;
}

/* -------------------------------------------------------
   Remove Participant
------------------------------------------------------- */
export function removeParticipant(peerId) {
  const entry = participants.get(peerId);
  if (!entry) return;

  const { el } = entry;
  el.classList.add("leaving");
  setTimeout(() => el.remove(), 220);

  participants.delete(peerId);
}

/* -------------------------------------------------------
   Attach Remote Stream
------------------------------------------------------- */
export function attachRemoteStream(peerId, stream, opts = {}) {
  const { displayName, avatarUrl } = opts;
  const entry = createTile(peerId, displayName, avatarUrl);
  if (!entry) return;

  const { videoEl, avatarEl } = entry;
  if (!videoEl) return;

  videoEl.srcObject = stream;
  videoEl.onloadedmetadata = () => {
    videoEl.play().catch(() => {});
  };

  videoEl.classList.add("show");
  if (avatarEl) avatarEl.classList.add("hidden");
}

/* -------------------------------------------------------
   Speaking Indicator
------------------------------------------------------- */
export function setParticipantSpeaking(peerId, active, level = 1) {
  const entry = participants.get(peerId);
  if (!entry) return;

  const { el } = entry;
  el.classList.toggle("speaking", !!active);
  el.style.setProperty("--audio-level", active ? String(level) : "0");
}

/* -------------------------------------------------------
   Camera Off / On
------------------------------------------------------- */
export function setParticipantCameraOff(peerId, off) {
  const entry = participants.get(peerId);
  if (!entry) return;

  const { videoEl, avatarEl } = entry;
  if (!videoEl || !avatarEl) return;

  if (off) {
    videoEl.classList.remove("show");
    avatarEl.classList.remove("hidden");
  } else {
    videoEl.classList.add("show");
    avatarEl.classList.add("hidden");
  }
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
   Stage Mode (Screen Share / Dominant Speaker)
------------------------------------------------------- */
export function promoteToStage(peerId) {
  if (!gridEl) return;

  // Clear previous stage-primary
  for (const [, entry] of participants.entries()) {
    entry.el.classList.remove("stage-primary");
  }
  if (localTileEl) localTileEl.classList.remove("stage-primary");

  // Apply stage mode
  gridEl.classList.add("stage-mode");

  const entry = participants.get(peerId);
  if (entry) {
    entry.el.classList.add("stage-primary");
  }
}

export function demoteStage(peerId) {
  if (!gridEl) return;

  const entry = participants.get(peerId);
  if (entry) entry.el.classList.remove("stage-primary");

  // If no one is staged, remove stage-mode entirely
  const anyStaged = [...participants.values()].some((p) =>
    p.el.classList.contains("stage-primary")
  );

  if (!anyStaged) {
    gridEl.classList.remove("stage-mode");
  }
}

/* -------------------------------------------------------
   Clear All Participants (on call end)
------------------------------------------------------- */
export function clearAllParticipants() {
  for (const [, entry] of participants.entries()) {
    entry.el.remove();
  }
  participants.clear();

  if (gridEl) {
    gridEl.classList.remove("stage-mode");
  }
}
