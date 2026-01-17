// public/js/contacts.js
// -------------------------------------------------------
// Contacts, presence, lookup, and messaging entrypoint

// ✔ FIXED: GitHub Pages cannot load /NewApp/... paths
import { socket } from "../socket.js";

// ✔ FIXED: session imports must be relative
import {
  getMyUserId,
  lookupBtn,
  lookupInput,
  lookupResults,
  getVoiceBtn,
  getVideoBtn,
  messageBox,
} from "../session.js";

// ✔ FIXED: messaging module path
import { setReceiver, loadMessages } from "../messaging.js";

// ✔ FIXED: call log module path
import { setContactLookup } from "../call-log.js";

let activeContact = null;
let isProfileOpen = false;
let isMessagesOpen = false;
let openProfileUserId = null;
let autoCloseProfileOnMessages = true; // you can toggle this anytime

// Global cache of contacts (by id)
window.UserCache = window.UserCache || {};

/* -------------------------------------------------------
   Helpers (Node backend + GitHub Pages)
------------------------------------------------------- */

const API_BASE = "https://letsee-backend.onrender.com/api";

const $ = (sel, root = document) => root.querySelector(sel);
const $id = (id) => document.getElementById(id);

/**
 * GET JSON from backend
 */
async function fetchJSON(path, opts = {}) {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    credentials: "include",
    ...opts,
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("Non-JSON response:", text);
    throw new Error("Invalid JSON response");
  }
}

/**
 * POST JSON to backend
 */
async function postJSON(path, body = {}) {
  return fetchJSON(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* -------------------------------------------------------
   Normalize Contact Object (ALL DB FIELDS)
------------------------------------------------------- */

function normalizeContact(raw) {
  if (!raw) return {};

  const safe = (v, fallback = "") =>
    v === null || v === undefined || v === "null" ? fallback : String(v);

  const toBool = (v) => v == 1 || v === "1" || v === true;

  // Avatar
  let avatar = safe(raw.contact_avatar || raw.avatar);
  if (!avatar || avatar.length < 3 || avatar === "null") {
    avatar = "/NewApp/img/defaultUser.png";
  }

  // Banner
  let banner = safe(raw.contact_banner || raw.banner);
  if (!banner || banner.length < 3 || banner === "null") {
    banner = "/NewApp/img/profile-banner.jpg";
  }

  // Website
  let website = safe(raw.contact_website || raw.website);
  if (website && !website.startsWith("http")) {
    website = "https://" + website;
  }

  // Twitter
  let twitter = safe(raw.contact_twitter || raw.twitter);
  if (twitter.startsWith("https://twitter.com/")) {
    twitter = twitter.replace("https://twitter.com/", "");
  }

  // Instagram
  let instagram = safe(raw.contact_instagram || raw.instagram);
  if (instagram.startsWith("https://instagram.com/")) {
    instagram = instagram.replace("https://instagram.com/", "");
  }

  const user = {
    contact_id: safe(raw.contact_id || raw.user_id || null),
    contact_name: safe(raw.fullname || raw.contact_name),
    contact_email: safe(raw.email || raw.contact_email),
    contact_avatar: avatar,
    contact_phone: safe(raw.phone || raw.contact_phone),
    contact_bio: safe(raw.bio || raw.contact_bio),
    contact_banner: banner,

    contact_website: website || "",
    contact_twitter: twitter || "",
    contact_instagram: instagram || "",

    // ⭐ Correct toggle logic
    contact_show_online: toBool(
      raw.contact_show_online ?? raw.show_online ?? 1
    ),
    contact_allow_messages: toBool(
      raw.contact_allow_messages ?? raw.allow_messages ?? 1
    ),

    last_message: raw.last_message ?? null,
    last_message_at: raw.last_message_at ?? null,
    unread_count: raw.unread_count ?? 0,

    online: raw.online ?? false,
    fromLookup: raw.fromLookup === true,
  };

  // Cache
  if (user.contact_id) {
    UserCache[user.contact_id] = {
      ...(UserCache[user.contact_id] || {}),
      ...user,
    };
  }

  return user;
}

/* -------------------------------------------------------
   Unified local update engine
------------------------------------------------------- */

export function updateLocalContact(userId, changes) {
  if (!userId) return;

  // 1. Update cache
  if (!UserCache[userId]) UserCache[userId] = {};
  Object.assign(UserCache[userId], changes);
  const u = UserCache[userId];

  // 2. Update contact list
  const contactCard = document.querySelector(
    `.contact-card[data-contact-id="${userId}"]`
  );
  if (contactCard) {
    if (changes.fullname || changes.contact_name) {
      const name = changes.fullname || changes.contact_name || u.contact_name;
      const el = contactCard.querySelector(".contact-name");
      if (el) el.textContent = name;
    }
    if (changes.email || changes.contact_email) {
      const email = changes.email || changes.contact_email || u.contact_email;
      const el = contactCard.querySelector(".contact-email");
      if (el) el.textContent = email;
    }
    if (changes.avatar || changes.contact_avatar) {
      const avatar =
        changes.avatar || changes.contact_avatar || u.contact_avatar;
      const img = contactCard.querySelector(".contact-avatar");
      if (img) img.src = avatar;
    }
  }

  // 3. Update full profile modal (if open)
  if (isProfileOpen && openProfileUserId == userId) {
    if (changes.fullname || changes.contact_name) {
      $id("fullProfileName").textContent =
        changes.fullname || changes.contact_name || u.contact_name;
    }
    if (changes.email || changes.contact_email) {
      $id("fullProfileEmail").textContent =
        changes.email || changes.contact_email || u.contact_email;
    }
    if (changes.phone || changes.contact_phone) {
      $id("fullProfilePhone").textContent =
        changes.phone || changes.contact_phone || u.contact_phone || "No phone";
    }
    if (changes.bio || changes.contact_bio) {
      $id("fullProfileBio").textContent =
        changes.bio || changes.contact_bio || u.contact_bio || "No bio";
    }
    if (changes.avatar || changes.contact_avatar) {
      const avatar =
        changes.avatar || changes.contact_avatar || u.contact_avatar;
      $id("fullProfileAvatar").src = avatar;
    }
    if (changes.banner || changes.contact_banner) {
      const banner =
        changes.banner || changes.contact_banner || u.contact_banner;
      $id("fullProfileBanner").src = banner;
    }
    if (changes.website || changes.contact_website) {
      const website =
        changes.website || changes.contact_website || u.contact_website || "";
      const w = $id("fullProfileWebsite");
      if (website) {
        w.textContent = website;
        w.href = website.startsWith("http") ? website : "https://" + website;
      } else {
        w.textContent = "None";
        w.removeAttribute("href");
      }
    }
    if (changes.twitter || changes.contact_twitter) {
      const twitter =
        changes.twitter || changes.contact_twitter || u.contact_twitter || "";
      const t = $id("fullProfileTwitter");
      if (twitter) {
        t.textContent = twitter;
        t.href = "https://twitter.com/" + twitter.replace("@", "");
      } else {
        t.textContent = "None";
        t.removeAttribute("href");
      }
    }
    if (changes.instagram || changes.contact_instagram) {
      const instagram =
        changes.instagram ||
        changes.contact_instagram ||
        u.contact_instagram ||
        "";
      const i = $id("fullProfileInstagram");
      if (instagram) {
        i.textContent = instagram;
        i.href = "https://instagram.com/" + instagram.replace("@", "");
      } else {
        i.textContent = "None";
        i.removeAttribute("href");
      }
    }
    if (
      changes.show_online !== undefined ||
      changes.contact_show_online !== undefined
    ) {
      const val =
        changes.show_online ??
        changes.contact_show_online ??
        u.contact_show_online;
      const el = $id("fullProfileShowOnline");
      el.textContent = val ? "Online" : "Offline";
      el.classList.toggle("status-online", !!val);
      el.classList.toggle("status-offline", !val);
    }
    if (
      changes.allow_messages !== undefined ||
      changes.contact_allow_messages !== undefined
    ) {
      const val =
        changes.allow_messages ??
        changes.contact_allow_messages ??
        u.contact_allow_messages;
      const el = $id("fullProfileAllowMessages");
      el.textContent = val ? "Messages Allowed" : "Messages Blocked";
      el.classList.toggle("status-online", !!val);
      el.classList.toggle("status-offline", !val);
    }
  }

  // 4. Update lookup cards
  document
    .querySelectorAll(`.lookup-card[data-id="${userId}"]`)
    .forEach((card) => {
      if (changes.fullname || changes.contact_name) {
        const name = changes.fullname || changes.contact_name || u.contact_name;
        const el = card.querySelector(".lookup-name");
        if (el) el.textContent = name;
      }
      if (changes.email || changes.contact_email) {
        const email = changes.email || changes.contact_email || u.contact_email;
        const el = card.querySelector(".lookup-email");
        if (el) el.textContent = email;
      }
      if (changes.avatar || changes.contact_avatar) {
        const avatar =
          changes.avatar || changes.contact_avatar || u.contact_avatar;
        const img = card.querySelector(".lookup-avatar img");
        if (img) img.src = avatar;
      }
    });

  // 5. Update message header if chatting with them
  if (window.currentChatUserId == userId) {
    const header = $(".header_msg_box h2");
    const avatarEl = $(".header_msg_box .chat-header-avatar");
    if (header && (changes.fullname || changes.contact_name)) {
      header.textContent =
        changes.fullname || changes.contact_name || u.contact_name;
    }
    if (avatarEl && (changes.avatar || changes.contact_avatar)) {
      avatarEl.src =
        changes.avatar || changes.contact_avatar || u.contact_avatar;
    }
  }
}

/* -------------------------------------------------------
   Call Buttons
------------------------------------------------------- */

function wireGlobalCallButtons(user) {
  const voiceBtn = getVoiceBtn?.();
  const videoBtn = getVideoBtn?.();

  if (voiceBtn) {
    voiceBtn.dataset.targetId = user.contact_id;
    voiceBtn.dataset.targetName = user.contact_name;
  }

  if (videoBtn) {
    videoBtn.dataset.targetId = user.contact_id;
    videoBtn.dataset.targetName = user.contact_name;
  }
}

/* -------------------------------------------------------
   Messaging Panel Toggle
------------------------------------------------------- */

function showMessages() {
  const box = messageBox;
  if (!box) return;

  if (box.classList.contains("active")) {
    box.classList.remove("active");
    box.classList.add("closing");
    setTimeout(() => box.classList.remove("closing"), 750);
    return;
  }

  box.classList.add("active");
}

/* -------------------------------------------------------
   Messaging Logic
------------------------------------------------------- */

function updateMessageHeader(name) {
  const header = $(".header_msg_box h2");
  if (header) header.textContent = name ?? "Messages";
}

export function openMessagesFor(userRaw) {
  const user = normalizeContact(userRaw);
  const profileModal = $id("fullProfileModal");

  // ⭐ Auto-close profile modal if enabled
  if (autoCloseProfileOnMessages && isProfileOpen && profileModal) {
    profileModal.classList.remove("open");
    isProfileOpen = false;
    openProfileUserId = null;
  }

  if (isMessagesOpen && activeContact?.contact_id === user.contact_id) {
    showMessages();
    isMessagesOpen = false;
    return;
  }

  activeContact = user;

  setReceiver(user.contact_id);
  window.currentChatUserId = user.contact_id;

  isMessagesOpen = true;

  wireGlobalCallButtons(user);
  updateMessageHeader(user.contact_name);

  if (messageBox) messageBox.classList.add("active");
  loadMessages();
}
const closeBtn = $id("closeFullProfile");

if (closeBtn) {
  closeBtn.onclick = () => {
    const modal = $id("fullProfileModal");
    if (modal) modal.classList.remove("open");
    isProfileOpen = false;
    openProfileUserId = null;
  };
}

function selectCard(li) {
  document
    .querySelectorAll(".contact-card.selected")
    .forEach((c) => c.classList.remove("selected"));
  li.classList.add("selected");
}

/* -------------------------------------------------------
   Presence
------------------------------------------------------- */

export function registerPresence() {
  socket.emit("register", getMyUserId());

  socket.on("statusUpdate", ({ contact_id, online }) => {
    updateContactStatus(contact_id, online);
  });

  // Real-time profile updates (global)
  socket.on("profile:updated", (data) => {
    const userId = data.user_id;
    if (!userId) return;
    const changes = { ...data };
    delete changes.user_id;
    updateLocalContact(userId, changes);
  });
}

export function updateContactStatus(contactId, isOnline) {
  const card = document.querySelector(
    `.contact-card[data-contact-id="${contactId}"]`
  );
  if (!card) return;

  const status = card.querySelector(".contact-status");
  if (status) {
    status.style.backgroundColor = isOnline ? "green" : "gray";
    status.title = isOnline ? "Online" : "Offline";
  }
}

/* -------------------------------------------------------
   Load Contacts
------------------------------------------------------- */

export async function loadContacts() {
  try {
    const data = await fetchJSON("get_contacts.php");
    console.log("CONTACTS API RESPONSE:", data);

    const list = $id("contacts");
    const blockedList = $id("blocked-contacts");

    if (list && Array.isArray(data.contacts)) {
      list.innerHTML = "";
      const normalizedContacts = data.contacts.map(normalizeContact);

      normalizedContacts
        .sort((a, b) => a.contact_name.localeCompare(b.contact_name))
        .forEach((c) => list.appendChild(renderContactCard(c)));

      setContactLookup(normalizedContacts);
    }

    if (blockedList && Array.isArray(data.blocked)) {
      blockedList.innerHTML = "";
      data.blocked
        .map(normalizeContact)
        .forEach((c) => blockedList.appendChild(renderBlockedCard(c)));
    }

    socket.emit("presence:get", { userId: getMyUserId() });
  } catch (err) {
    console.error("Failed to load contacts:", err);
  }
}

/* -------------------------------------------------------
   Render Contact Card (LIST)
------------------------------------------------------- */

function renderBlockedCard(userRaw) {
  const user = normalizeContact(userRaw);

  const li = document.createElement("li");
  li.className = "blocked-card";
  li.dataset.userId = user.contact_id;

  li.innerHTML = `
    <div class="blocked-avatar">
      <img src="${user.contact_avatar}">
    </div>

    <div class="blocked-info">
      <div class="blocked-name">${user.contact_name}</div>
      <div class="blocked-email">${user.contact_email}</div>
    </div>

    <button class="unblock-btn" data-id="${user.contact_id}">Unblock</button>
  `;

  li.querySelector(".unblock-btn").onclick = async () => {
    const data = await postForm("unblock_contact.php", {
      contact_id: user.contact_id,
    });
    if (data.success) loadContacts();
  };

  return li;
}

export function renderContactCard(userRaw) {
  const user = normalizeContact(userRaw);

  const li = document.createElement("li");
  li.className = "contact-card";
  li.dataset.contactId = String(user.contact_id);

  li.innerHTML = `
    <img class="contact-avatar" src="${user.contact_avatar}">
    <span class="contact-status" title="${
      user.online ? "Online" : "Offline"
    }"></span>

    <div class="contact-info">
      <div class="contact-name">${user.contact_name}</div>
      <div class="contact-email">${user.contact_email}</div>
    </div>

    <div class="contact-actions">
      <button class="info-btn">ℹ️</button>
      <button class="chat-btn">💬</button>
      <button class="block-btn">🚫</button>
      <button class="delete-btn">🗑</button>
    </div>
  `;

  li.querySelector(".info-btn").onclick = (e) => {
    e.stopPropagation();
    openFullProfile(user);
  };

  li.querySelector(".chat-btn").onclick = (e) => {
    e.stopPropagation();
    openMessagesFor(user);
    selectCard(li);
  };

  li.querySelector(".block-btn").onclick = async (e) => {
    e.stopPropagation();
    const data = await postForm("block_contact.php", {
      contact_id: user.contact_id,
    });
    if (data.success) loadContacts();
  };

  li.querySelector(".delete-btn").onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${user.contact_name}?`)) return;
    const data = await postForm("delete_contact.php", {
      contact_id: user.contact_id,
    });
    if (data.success) loadContacts();
  };

  return li;
}

/* -------------------------------------------------------
   FULL PROFILE MODAL (ALL FIELDS, REAL-TIME READY)
------------------------------------------------------- */

function openFullProfile(userRaw) {
  const user = normalizeContact(userRaw);
  activeContact = user;
  openProfileUserId = user.contact_id;

  const modal = $id("fullProfileModal");
  modal.classList.add("open");
  isProfileOpen = true;

  // Avatar + Banner
  $id("fullProfileAvatar").src = user.contact_avatar;
  $id("fullProfileBanner").src = user.contact_banner;

  // Basic Info
  $id("fullProfileName").textContent = user.contact_name;
  $id("fullProfileEmail").textContent = user.contact_email;
  $id("fullProfilePhone").textContent = user.contact_phone || "No phone";

  // Bio
  $id("fullProfileBio").textContent = user.contact_bio || "No bio";

  // Website
  if (user.contact_website) {
    const w = $id("fullProfileWebsite");
    w.textContent = user.contact_website;
    w.href = user.contact_website.startsWith("http")
      ? user.contact_website
      : "https://" + user.contact_website;
  } else {
    $id("fullProfileWebsite").textContent = "None";
    $id("fullProfileWebsite").removeAttribute("href");
  }

  // Twitter
  if (user.contact_twitter) {
    const t = $id("fullProfileTwitter");
    t.textContent = user.contact_twitter;
    t.href = "https://twitter.com/" + user.contact_twitter.replace("@", "");
  } else {
    $id("fullProfileTwitter").textContent = "None";
    $id("fullProfileTwitter").removeAttribute("href");
  }

  // Instagram
  if (user.contact_instagram) {
    const i = $id("fullProfileInstagram");
    i.textContent = user.contact_instagram;
    i.href = "https://instagram.com/" + user.contact_instagram.replace("@", "");
  } else {
    $id("fullProfileInstagram").textContent = "None";
    $id("fullProfileInstagram").removeAttribute("href");
  }

  // Permissions
  const showOnlineEl = $id("fullProfileShowOnline");
  showOnlineEl.textContent = user.contact_show_online ? "Online" : "Offline";
  showOnlineEl.classList.toggle("status-online", user.contact_show_online);
  showOnlineEl.classList.toggle("status-offline", !user.contact_show_online);

  const allowMsgEl = $id("fullProfileAllowMessages");
  allowMsgEl.textContent = user.contact_allow_messages
    ? "Messages Allowed"
    : "Messages Blocked";
  allowMsgEl.classList.toggle("status-online", user.contact_allow_messages);
  allowMsgEl.classList.toggle("status-offline", !user.contact_allow_messages);

  // Copy buttons
  $id("copyEmailBtn").onclick = () =>
    navigator.clipboard.writeText(user.contact_email);

  $id("copyPhoneBtn").onclick = () =>
    navigator.clipboard.writeText(user.contact_phone || "");

  // Buttons
  const callBtn = $id("profileCallBtn");
  const videoBtn = $id("profileVideoBtn");
  const blockBtn = $id("profileBlockBtn");
  const saveBtn = $id("saveLookupContact");

  // Use safe checks in case elements are not present
  callBtn?.addEventListener("click", () => {
    if (typeof window.startCall === "function")
      window.startCall(user.contact_id, false);
    else console.warn("startCall is not available");
  });
  videoBtn?.addEventListener("click", () => {
    if (typeof window.startCall === "function")
      window.startCall(user.contact_id, true);
    else console.warn("startCall is not available");
  });

  blockBtn?.addEventListener("click", async () => {
    if (!confirm(`Block ${user.contact_name}?`)) return;
    const data = await postForm("block_contact.php", {
      contact_id: user.contact_id,
    });
    if (data.success) {
      alert("User blocked");
      loadContacts();
      if (modal) modal.classList.remove("open");
      isProfileOpen = false;
      openProfileUserId = null;
    }
  });

  // Only touch saveBtn if it exists and ensure the handler is safe
  if (saveBtn) {
    if (user.fromLookup) {
      saveBtn.style.display = "block";
      saveBtn.onclick = () => {
        if (typeof window.saveLookupContact === "function") {
          window.saveLookupContact(user.contact_id);
        } else {
          console.error("saveLookupContact is not defined");
        }
      };
    } else {
      saveBtn.style.display = "none";
      saveBtn.onclick = null;
    }
  }
}

/* -------------------------------------------------------
   Lookup Search
------------------------------------------------------- */

function runLookup(query) {
  if (!lookupResults) return;
  if (!query) {
    lookupResults.innerHTML = "";
    return;
  }

  lookupResults.innerHTML = `<li class="empty">Searching...</li>`;

  fetchJSON(`lookup_contacts.php?query=${encodeURIComponent(query)}`)
    .then((data) => {
      lookupResults.innerHTML = "";

      if (Array.isArray(data) && data.length) {
        data.forEach((u) => {
          const normalized = normalizeContact(u);
          normalized.fromLookup = true;
          lookupResults.appendChild(renderLookupCard(normalized));
        });
      } else {
        lookupResults.innerHTML = `<li class="empty">No contacts found</li>`;
      }
    })
    .catch(() => {
      lookupResults.innerHTML = `<li class="empty">Lookup error</li>`;
    });
}

lookupBtn?.addEventListener("click", () => {
  runLookup(lookupInput?.value?.trim() ?? "");
});

lookupInput?.addEventListener("input", () => {
  clearTimeout(window.lookupTimer);
  window.lookupTimer = setTimeout(() => {
    runLookup(lookupInput.value.trim());
  }, 300);
});

/* -------------------------------------------------------
   Render Lookup Card
------------------------------------------------------- */

export function renderLookupCard(user) {
  const li = document.createElement("li");
  li.className = "lookup-card";
  li.dataset.id = user.contact_id;

  li.innerHTML = `
    <div class="lookup-avatar">
      <img src="${user.contact_avatar}">
    </div>

    <div class="lookup-info">
      <div class="lookup-name">${user.contact_name}</div>
      <div class="lookup-email">${user.contact_email}</div>
    </div>

    <div class="lookup-actions">
      <button class="lookup-info-btn">ℹ️</button>
      <button class="lookup-open-chat">💬</button>
    </div>
  `;

  li.querySelector(".lookup-info-btn").onclick = (e) => {
    e.stopPropagation();
    openFullProfile(user);
  };

  li.querySelector(".lookup-open-chat").onclick = (e) => {
    e.stopPropagation();
    openMessagesFor(user);
  };

  li.onclick = () => openFullProfile(user);

  return li;
}


