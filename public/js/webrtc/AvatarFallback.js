// public/js/webrtc/AvatarFallback.js
// Premium unified avatar system for CALL UI + MESSAGING UI

const DEFAULT_AVATAR = "img/defaultUser.png";
const BACKEND_BASE = "https://letsee-backend.onrender.com";

/* -------------------------------------------------------
   NORMALIZE AVATAR PATH
   - Handles: full URLs, /uploads/..., uploads/..., filenames
   - Works on GitHub Pages + Node backend
------------------------------------------------------- */
function normalizeAvatarPath(path) {
  if (!path) return DEFAULT_AVATAR;

  try {
    // Full URL
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }

    // "/uploads/avatars/filename.jpg"
    if (path.startsWith("/uploads/avatars/")) {
      return `${BACKEND_BASE}${path}`;
    }

    // "uploads/avatars/filename.jpg"
    if (path.includes("uploads/avatars/")) {
      return `${BACKEND_BASE}/${path.replace(/^\//, "")}`;
    }

    // Bare filename
    return `${BACKEND_BASE}/uploads/avatars/${path}`;
  } catch (err) {
    console.warn("[AvatarFallback] normalize error:", err);
    return DEFAULT_AVATAR;
  }
}

/* -------------------------------------------------------
   CALL UI — REMOTE AVATAR
------------------------------------------------------- */
export function setRemoteAvatar(avatarUrl) {
  const img = document.getElementById("remoteAvatarImg");
  const wrapper = document.getElementById("remoteAvatar");
  if (!img || !wrapper) return;

  img.src = normalizeAvatarPath(avatarUrl);
  wrapper.style.display = "flex";
}

/* -------------------------------------------------------
   CALL UI — LOCAL AVATAR
------------------------------------------------------- */
export function setLocalAvatar(avatarUrl) {
  const img = document.getElementById("localAvatarImg");
  const wrapper = document.getElementById("localAvatar");
  if (!img || !wrapper) return;

  img.src = normalizeAvatarPath(avatarUrl);
  wrapper.style.display = "flex";
}

/* -------------------------------------------------------
   CALL UI — SHOW AVATAR WHEN VIDEO IS OFF
------------------------------------------------------- */
export function showRemoteAvatar() {
  const video = document.getElementById("remoteVideo");
  const avatar = document.getElementById("remoteAvatar");

  if (video) {
    video.style.display = "none";
    video.style.opacity = "0";
  }
  if (avatar) {
    avatar.style.display = "flex";
    avatar.style.opacity = "1";
  }
}

export function showLocalAvatar() {
  const video = document.getElementById("localVideo");
  const avatar = document.getElementById("localAvatar");

  if (video) {
    video.style.display = "none";
    video.style.opacity = "0";
  }
  if (avatar) {
    avatar.style.display = "flex";
    avatar.style.opacity = "1";
  }
}

/* -------------------------------------------------------
   CALL UI — SHOW VIDEO WHEN AVAILABLE
------------------------------------------------------- */
export function showRemoteVideo() {
  const video = document.getElementById("remoteVideo");
  const avatar = document.getElementById("remoteAvatar");

  if (avatar) {
    avatar.style.display = "flex"; // stays underneath for fade-in
    avatar.style.opacity = "1";
  }
  if (video) {
    video.style.display = "block";
  }
}

export function showLocalVideo() {
  const video = document.getElementById("localVideo");
  const avatar = document.getElementById("localAvatar");

  if (avatar) {
    avatar.style.display = "none";
    avatar.style.opacity = "0";
  }
  if (video) {
    video.style.display = "block";
  }
}

/* -------------------------------------------------------
   OPTIONAL — SPEAKING INDICATOR
------------------------------------------------------- */
export function setRemoteSpeaking(isSpeaking) {
  const ring = document.querySelector("#remoteAvatar .avatar-ring");
  if (!ring) return;
  ring.classList.toggle("speaking", isSpeaking);
}

export function setLocalSpeaking(isSpeaking) {
  const ring = document.querySelector("#localAvatar .avatar-ring");
  if (!ring) return;
  ring.classList.toggle("speaking", isSpeaking);
}

/* -------------------------------------------------------
   MESSAGING UI — AVATAR RENDERING
------------------------------------------------------- */
export function applyAvatar(wrapperEl, avatarUrl, fullName) {
  if (!wrapperEl) return;

  const avatarEl = wrapperEl.querySelector(".avatar-fallback");
  if (!avatarEl) return;

  avatarEl.innerHTML = "";

  const img = document.createElement("img");
  img.src = normalizeAvatarPath(avatarUrl);
  img.alt = fullName || "User";
  img.className = "avatar-img";
  avatarEl.appendChild(img);

  const nameSpan = document.createElement("span");
  nameSpan.className = "avatar-name";
  nameSpan.textContent = fullName?.trim()?.split(" ")[0] || "";
  avatarEl.appendChild(nameSpan);
}

/* -------------------------------------------------------
   MESSAGING UI — VISIBILITY HELPERS
------------------------------------------------------- */
export function showAvatar(wrapperEl) {
  if (!wrapperEl) return;

  const video = wrapperEl.querySelector("video");
  const avatarEl = wrapperEl.querySelector(".avatar-fallback");

  if (video) video.style.display = "none";
  if (avatarEl) avatarEl.style.display = "flex";
}

export function showVideo(wrapperEl) {
  if (!wrapperEl) return;

  const video = wrapperEl.querySelector("video");
  const avatarEl = wrapperEl.querySelector(".avatar-fallback");

  if (video) video.style.display = "block";
  if (avatarEl) avatarEl.style.display = "none";
}




