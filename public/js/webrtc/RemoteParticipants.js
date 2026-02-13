// public/js/webrtc/RemoteParticipants.js
// PURE TILE MANAGER — no layout logic, no screen-share logic, no active-speaker layout.
// CallUI.js owns ALL layout classes and UI behavior.
// This file ONLY manages:
//   - participant tiles
//   - media binding
//   - basic state (cameraOff, speaking, avatar/name)

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
   Register Local Tile
------------------------------------------------------- */
export function registerLocalTile(el) {
  localTileEl = el || null;
  if (localTileEl) {
    localTileEl.dataset.peerId = "local";
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
   Create Tile
------------------------------------------------------- */
function createTile(peerId, displayName, avatarUrl) {
  ensureInitialized();
  if (!gridEl) {
    console.warn("[RemoteParticipants] createTile aborted — no gridEl");
    return null;
  }

  if (peerId === undefined || peerId === null) {
    console.warn("[RemoteParticipants] createTile called without peerId");
    return null;
  }

  if (participants.has(peerId)) return participants.get(peerId);

  const node = safeCloneTemplate("remoteParticipantTemplate");
  if (!node) return null;

  node.dataset.peerId = String(peerId);

  const videoEl  = node.querySelector("video");
  const avatarEl = node.querySelector(".avatar-wrapper");
  const imgEl    = node.querySelector(".avatar-img");
  const nameEl   = node.querySelector(".name-tag");

  if (nameEl && displayName) nameEl.textContent = displayName;
  if (avatarUrl && imgEl) imgEl.src = avatarUrl;

  // Join animation (CSS can handle .joining/.joined)
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
   (this is what attachRemoteTrack() calls via attachParticipantStream)
------------------------------------------------------- */
export function attachParticipantStream(peerId, stream) {
  if (!stream) {
    console.warn("[RemoteParticipants] attachParticipantStream called with null stream for peer:", peerId);
  }

  const entry = participants.get(peerId) || createTile(peerId);
  if (!entry) {
    console.warn("[RemoteParticipants] attachParticipantStream: no entry for peer:", peerId);
    return null;
  }

  entry.stream = stream || null;

  if (entry.videoEl && stream) {
    try {
      entry.videoEl.srcObject = stream;
      entry.videoEl.playsInline = true;

      // Remote video element stays muted; audio is routed via #remoteAudio
      entry.videoEl.muted = true;

      // Ensure CSS shows the video element
      entry.videoEl.classList.add("show");

      entry.videoEl.onloadedmetadata = () => {
        entry.videoEl
          .play()
          .catch((err) => {
            console.warn(
              "[RemoteParticipants] remote video play blocked:",
              err?.name || err
            );
          });
      };
    } catch (err) {
      console.error("[RemoteParticipants] Failed to bind remote video:", err);
    }
  }

  return entry;
}

/* -------------------------------------------------------
   Backwards‑compat alias (if anything still calls attachStream)
------------------------------------------------------- */
export function attachStream(peerId, stream) {
  return attachParticipantStream(peerId, stream);
}

/* -------------------------------------------------------
   Camera Off / On (CallUI handles layout classes)
------------------------------------------------------- */
export function setParticipantCameraOff(peerId, off) {
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
   Speaking Indicator (CallUI handles active-speaker layout)
------------------------------------------------------- */
export function setParticipantSpeaking(peerId, active, level = 1) {
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
  const entry = participants.get(peerId);
  if (!entry) return;

  if (entry.imgEl && typeof url === "string" && url.length > 0) {
    entry.imgEl.src = url;
    entry.avatarUrl = url;
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





