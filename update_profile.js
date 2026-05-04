// ===============================
//  FRONTEND PROFILE CONTROLLER
//  Updated for Node + Express +
//  Socket.IO real-time sync
// ===============================

// Socket.IO client (with session cookie)
const socket = io("https://letsee-backend.onrender.com", {
  withCredentials: true,
  transports: ["websocket", "polling"]
});

// Elements
const profileForm = document.getElementById("profileForm");
const saveBtn = document.getElementById("saveProfileBtn");
const cancelBtn = document.getElementById("cancelProfileBtn");

const avatarInput = document.getElementById("profileAvatar");
const bannerInput = document.getElementById("profileBanner");

// -------------------------------
// Helper: JSON API wrapper
// -------------------------------
async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// -------------------------------
// Load current profile
// -------------------------------
async function loadProfile() {
  try {
    const me = await apiJson("https://letsee-backend.onrender.com/api/auth/me", {
      method: "GET"
    });

    const profile = me.profile || me;

    document.getElementById("profileDisplayName").value = profile.displayName || "";
    document.getElementById("profileUsername").value = profile.username || "";
    document.getElementById("profilePronouns").value = profile.pronouns || "";
    document.getElementById("profileStatus").value = profile.status || "";
    document.getElementById("profileAbout").value = profile.about || "";
    document.getElementById("profileEmail").value = profile.email || "";
    document.getElementById("profileLocation").value = profile.location || "";
    document.getElementById("profileWebsite").value = profile.website || "";

    document.getElementById("profileX").value = profile.social?.x || "";
    document.getElementById("profileInstagram").value = profile.social?.instagram || "";
    document.getElementById("profileGithub").value = profile.social?.github || "";
    document.getElementById("profileLinkedIn").value = profile.social?.linkedIn || "";
    document.getElementById("profileYouTube").value = profile.social?.youTube || "";

    document.getElementById("profileShowStatus").checked = !!profile.preferences?.showStatus;
    document.getElementById("profileAllowFriends").checked = !!profile.preferences?.allowFriends;
    document.getElementById("profileTheme").value = profile.preferences?.theme || "system";

  } catch (err) {
    console.error("Failed to load profile", err);
  }
}

// Call on window open
loadProfile();

// -------------------------------
// Collect form payload
// -------------------------------
async function collectProfilePayload() {
  return {
    displayName: document.getElementById("profileDisplayName").value.trim(),
    username: document.getElementById("profileUsername").value.trim(),
    pronouns: document.getElementById("profilePronouns").value.trim(),
    status: document.getElementById("profileStatus").value.trim(),
    about: document.getElementById("profileAbout").value.trim(),
    email: document.getElementById("profileEmail").value.trim(),
    location: document.getElementById("profileLocation").value.trim(),
    website: document.getElementById("profileWebsite").value.trim(),
    social: {
      x: document.getElementById("profileX").value.trim(),
      instagram: document.getElementById("profileInstagram").value.trim(),
      github: document.getElementById("profileGithub").value.trim(),
      linkedIn: document.getElementById("profileLinkedIn").value.trim(),
      youTube: document.getElementById("profileYouTube").value.trim()
    },
    preferences: {
      showStatus: document.getElementById("profileShowStatus").checked,
      allowFriends: document.getElementById("profileAllowFriends").checked,
      theme: document.getElementById("profileTheme").value
    }
  };
}

// -------------------------------
// Save profile → PUT /update
// -------------------------------
async function saveProfile() {
  try {
    const payload = await collectProfilePayload();

    const updated = await apiJson("https://letsee-backend.onrender.com/api/profile/update", {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    // Real-time broadcast
    socket.emit("profile:updated", updated);

    console.log("Profile saved", updated);
  } catch (err) {
    console.error("Failed to save profile", err);
  }
}

saveBtn.addEventListener("click", saveProfile);

// -------------------------------
// Cancel → reload from server
// -------------------------------
cancelBtn.addEventListener("click", () => {
  loadProfile();
  document.getElementById("profileWindow").classList.add("hidden");
});

// -------------------------------
// Avatar & Banner Upload
// -------------------------------
async function uploadFile(url, fieldName, file) {
  const fd = new FormData();
  fd.append(fieldName, file);

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    body: fd
  });

  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

// Local preview helper
function previewImage(inputEl, targetSelector) {
  inputEl.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const target = document.querySelector(targetSelector);
    if (target) {
      target.style.backgroundImage = `url(${url})`;
      target.style.backgroundSize = "cover";
      target.style.backgroundPosition = "center";
    }
  });
}

// Previews
previewImage(avatarInput, ".avatar-upload");
previewImage(bannerInput, ".banner-upload");

// Upload avatar
avatarInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const result = await uploadFile(
      "https://letsee-backend.onrender.com/api/profile/avatar",
      "avatar",
      file
    );

    socket.emit("profile:updated", result.profile || result);
  } catch (err) {
    console.error("Avatar upload failed", err);
  }
});

// Upload banner
bannerInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const result = await uploadFile(
      "https://letsee-backend.onrender.com/api/profile/banner",
      "banner",
      file
    );

    socket.emit("profile:updated", result.profile || result);
  } catch (err) {
    console.error("Banner upload failed", err);
  }
});

// -------------------------------
// Real-time incoming updates
// -------------------------------
socket.on("profile:refresh", (profile) => {
  document.getElementById("profileDisplayName").value = profile.displayName || "";
  document.getElementById("profileStatus").value = profile.status || "";
});
