// public/js/webrtc/AvatarFallback.js
// Unified avatar system for CALL UI + MESSAGING UI

const DEFAULT_AVATAR = "/NewApp/img/defaultUser.png";

/* -------------------------------------------------------
   NORMALIZE PATH
------------------------------------------------------- */
function normalizeAvatarPath(path) {
  if (!path) return DEFAULT_AVATAR;

  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/NewApp/")) return path;
  if (path.startsWith("/uploads/avatars/")) return "/NewApp" + path;
  if (path.includes("uploads/avatars/")) return "/NewApp/" + path.replace(/^\//, "");

  return `/NewApp/uploads/avatars/${path}`;
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
// Remote: avatar visible, video hidden (no camera / stopped)
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

// Local: avatar visible, video hidden
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
// Remote: Discord style → video on top, avatar still exists underneath
export function showRemoteVideo() {
  const video = document.getElementById("remoteVideo");
  const avatar = document.getElementById("remoteAvatar");

  if (avatar) {
    avatar.style.display = "flex";  // keep it there, let CSS handle layering
    avatar.style.opacity = "1";
  }
  if (video) {
    video.style.display = "block";
    // opacity + scale animation handled in controller via fadeInVideo()
  }
}

// Local: B2 → local avatar hides when camera ON
export function showLocalVideo() {
  const video = document.getElementById("localVideo");
  const avatar = document.getElementById("localAvatar");

  if (avatar) {
    avatar.style.display = "none";
    avatar.style.opacity = "0";
  }
  if (video) {
    video.style.display = "block";
    // opacity + scale animation handled in controller via fadeInVideo()
  }
}

/* -------------------------------------------------------
   OPTIONAL — SPEAKING INDICATOR (WebRTC audio levels)
------------------------------------------------------- */
export function setRemoteSpeaking(isSpeaking) {
  const ring = document.querySelector("#remoteAvatar .avatar-ring");
  if (!ring) return;

  if (isSpeaking) ring.classList.add("speaking");
  else ring.classList.remove("speaking");
}

export function setLocalSpeaking(isSpeaking) {
  const ring = document.querySelector("#localAvatar .avatar-ring");
  if (!ring) return;

  if (isSpeaking) ring.classList.add("speaking");
  else ring.classList.remove("speaking");
}

/* -------------------------------------------------------
   MESSAGING UI — avatar rendering
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
   MESSAGING UI — visibility helpers
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
