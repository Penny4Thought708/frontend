// public/js/webrtc/RemoteParticipants.js
// Aurora‑Prime Multi‑Party Participant Manager
// -------------------------------------------------------
// Supports:
// - Multi‑track per peer (camera, screen, audio)
// - Renegotiation‑safe track replacement
// - Screen‑share stage mode (camera tile hidden)
// - Speaking indicator + active speaker
// - Camera‑off avatars
// - Smooth join/leave animations
// - Dynamic grid layout
// - SFU‑ready architecture
// -------------------------------------------------------

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

  const count =
    participants.size +
    (localTileEl && !localTileEl.classList.contains("hidden") ? 1 : 0);

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
    peerId,
    el: node,
    videoEl,
    avatarEl,
    imgEl,
    nameEl,
    displayName,
    avatarUrl,

    // Multi‑track support
    tracks: {
      camera: null,
      screen: null,
      audio: null
    },

    // State flags
    isScreenSharing: false,
    cameraOff: false
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
   Multi‑Track Attachment (camera / screen / audio)
------------------------------------------------------- */
export function attachRemoteTrack(peerId, evt, opts = {}) {
  const { displayName, avatarUrl } = opts;
  const track = evt.track;
  const kind = track.kind;

  const entry = createTile(peerId, displayName, avatarUrl);
  if (!entry) return;

  // Ensure video element has a MediaStream
  if (!entry.videoEl.srcObject) {
    entry.videoEl.srcObject = new MediaStream();
  }

  // Remove stale tracks of same kind
  const ms = entry.videoEl.srcObject;
  ms.getTracks()
    .filter(t => t.kind === kind)
    .forEach(t => ms.removeTrack(t));

  // Add new track
  ms.addTrack(track);

  // Track bookkeeping
  if (kind === "video") {
    if (track.label.toLowerCase().includes("screen")) {
      entry.tracks.screen = track;
      entry.isScreenSharing = true;
      promoteScreenShare(peerId);
    } else {
      entry.tracks.camera = track;
      if (!entry.isScreenSharing) {
        showCameraTile(entry);
      }
    }
  }

  if (kind === "audio") {
    entry.tracks.audio = track;
  }

  entry.videoEl.classList.add("show");
  entry.avatarEl?.classList.add("hidden");

  entry.videoEl.onloadedmetadata = () => {
    entry.videoEl.play().catch(() => {});
  };

  updateGridLayout();
}

/* -------------------------------------------------------
   Screen Share Promotion (Option 2)
   - Hide camera tile
   - Show only screen share tile
------------------------------------------------------- */
function promoteScreenShare(peerId) {
  const entry = participants.get(peerId);
  if (!entry) return;

  // Hide camera tile
  entry.el.classList.add("screen-share-active");
  entry.el.classList.add("stage-primary");

  // Hide camera video if present
  if (entry.tracks.camera) {
    entry.videoEl.classList.add("show");
  }

  // Enable stage mode
  gridEl.classList.add("stage-mode");

  // Hide local tile if needed
  if (localTileEl) {
    localTileEl.classList.add("hidden");
  }

  updateGridLayout();
}

/* -------------------------------------------------------
   Screen Share Stop
------------------------------------------------------- */
export function stopScreenShare(peerId) {
  const entry = participants.get(peerId);
  if (!entry) return;

  entry.isScreenSharing = false;
  entry.tracks.screen = null;

  entry.el.classList.remove("screen-share-active");
  entry.el.classList.remove("stage-primary");

  // Restore camera tile if camera exists
  if (entry.tracks.camera) {
    showCameraTile(entry);
  }

  // Remove stage mode if no one else is staged
  const anyStaged = [...participants.values()].some(p =>
    p.el.classList.contains("stage-primary")
  );

  if (!anyStaged) {
    gridEl.classList.remove("stage-mode");
  }

  if (localTileEl) {
    localTileEl.classList.remove("hidden");
  }

  updateGridLayout();
}

/* -------------------------------------------------------
   Camera Tile Restore
------------------------------------------------------- */
function showCameraTile(entry) {
  entry.videoEl.classList.add("show");
  entry.avatarEl?.classList.add("hidden");
}

/* -------------------------------------------------------
   Camera Off / On
------------------------------------------------------- */
export function setParticipantCameraOff(peerId, off) {
  const entry = participants.get(peerId);
  if (!entry) return;

  entry.cameraOff = off;

  if (off) {
    entry.videoEl.classList.remove("show");
    entry.avatarEl?.classList.remove("hidden");
  } else {
    entry.videoEl.classList.add("show");
    entry.avatarEl?.classList.add("hidden");
  }
}

/* -------------------------------------------------------
   Speaking Indicator
------------------------------------------------------- */
export function setParticipantSpeaking(peerId, active, level = 1) {
  const entry = participants.get(peerId);
  if (!entry) return;

  entry.el.classList.toggle("speaking", !!active);
  entry.el.style.setProperty("--audio-level", active ? String(level) : "0");
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
   Update Display Name
------------------------------------------------------- */
export function setParticipantName(peerId, name) {
  const entry = participants.get(peerId);
  if (!entry) return;

  if (entry.nameEl && name) entry.nameEl.textContent = name;
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

  if (localTileEl) {
    localTileEl.classList.remove("hidden");
  }

  updateGridLayout();
}
