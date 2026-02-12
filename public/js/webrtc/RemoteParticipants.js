// public/js/webrtc/RemoteParticipants.js
// Multi‑party participant manager for Aurora‑Prime.
// Handles: tile creation, join/leave animations, stage mode,
// speaking glow, camera‑off avatars, active speaker, dynamic grid,
// SFU-ready track attachment, and per‑peer metadata.

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
   Dynamic Grid Layout
------------------------------------------------------- */
export function updateGridLayout() {
  if (!gridEl) return;

  const count = participants.size + (localTileEl ? 1 : 0);

  gridEl.classList.remove(
    "grid-1", "grid-2", "grid-3", "grid-4",
    "grid-6", "grid-9", "grid-16"
  );

  if (count <= 1) gridEl.classList.add("grid-1");
  else if (count === 2) gridEl.classList.add("grid-2");
  else if (count <= 4) gridEl.classList.add("grid-4");
  else if (count <= 6) gridEl.classList.add("grid-6");
  else if (count <= 9) gridEl.classList.add("grid-9");
  else gridEl.classList.add("grid-16");
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

  const entry = {
    el: node,
    videoEl,
    avatarEl,
    nameEl,
    imgEl,
    peerId,
    displayName,
    avatarUrl,
    isLocal: false,
    isScreenShare: false
  };

  participants.set(peerId, entry);
  updateGridLayout();
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
  updateGridLayout();
}

/* -------------------------------------------------------
   Attach Remote Stream (Mesh mode)
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
  avatarEl?.classList.add("hidden");
}

/* -------------------------------------------------------
   Attach Single Remote Track (SFU-ready)
------------------------------------------------------- */
export function attachRemoteTrack(peerId, track, opts = {}) {
  const { displayName, avatarUrl } = opts;
  const entry = createTile(peerId, displayName, avatarUrl);
  if (!entry) return;

  const { videoEl, avatarEl } = entry;

  if (!videoEl.srcObject) {
    videoEl.srcObject = new MediaStream();
  }

  videoEl.srcObject.addTrack(track);

  videoEl.classList.add("show");
  avatarEl?.classList.add("hidden");
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
   Active Speaker Highlight
------------------------------------------------------- */
export function setActiveSpeaker(peerId) {
  for (const [id, entry] of participants.entries()) {
    entry.el.classList.toggle("active-speaker", id === peerId);
  }

  if (localTileEl) {
    localTileEl.classList.toggle("active-speaker", peerId === "local");
  }
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

  const anyStaged = [...participants.values()].some((p) =>
    p.el.classList.contains("stage-primary")
  );

  if (!anyStaged) {
    gridEl.classList.remove("stage-mode");
  }
}

/* -------------------------------------------------------
   Sort Participants (active speaker first)
------------------------------------------------------- */
export function sortParticipants(order = []) {
  if (!gridEl) return;

  const tiles = [...participants.values()].map(p => p.el);

  tiles.sort((a, b) => {
    const idA = a.dataset.peerId;
    const idB = b.dataset.peerId;
    return order.indexOf(idA) - order.indexOf(idB);
  });

  tiles.forEach(tile => gridEl.appendChild(tile));
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

  updateGridLayout();
}
