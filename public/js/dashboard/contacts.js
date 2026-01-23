// public/js/contacts.js
// -------------------------------------------------------
// Contacts, presence, lookup, and messaging entrypoint

import { socket } from "../socket.js";


import {
  getMyUserId,
  lookupBtn,
  lookupInput,
  lookupResults,
  getVoiceBtn,
  getVideoBtn,
  messageBox,
} from "../session.js";

import { setReceiver, loadMessages } from "../messaging.js";
import { setContactLookup } from "../call-log.js";

let activeContact = null;
let isProfileOpen = false;
let isMessagesOpen = false;
let openProfileUserId = null;
let autoCloseProfileOnMessages = true;

// Global cache of contacts
window.UserCache = window.UserCache || {};

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $id = (id) => document.getElementById(id);

async function getJson(url) {
  const res = await fetch(url, { credentials: "include" });
  return res.json();
}

async function postJson(url, body = {}) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/* -------------------------------------------------------
   Normalize Contact Object
------------------------------------------------------- */

function normalizeContact(raw) {
  if (!raw) return {};

  const safe = (v, fallback = "") =>
    v === null || v === undefined || v === "null" ? fallback : String(v);

  const user = {
    contact_id: safe(raw.id),
    contact_name: safe(raw.name),
    contact_email: safe(raw.email),

    contact_avatar: raw.avatar || "/img/defaultUser.png",
    contact_banner: raw.banner || "/img/profile-banner.jpg",

    contact_phone: safe(raw.phone),
    contact_bio: safe(raw.bio),

    contact_website: safe(raw.website),
    contact_twitter: safe(raw.twitter),
    contact_instagram: safe(raw.instagram),

    favorite: raw.favorite ?? false,
    added_on: raw.added_on ?? null,

    online: raw.online ?? false,

    // NEW last message structure
    last_message: raw.last_message || null,
    last_message_at: raw.last_message?.created_at || null,
    unread_count: raw.last_message?.unread || 0,

    fromLookup: raw.fromLookup === true
  };

  // Cache it
  UserCache[user.contact_id] = {
    ...(UserCache[user.contact_id] || {}),
    ...user,
  };

  return user;
}

/* -------------------------------------------------------
   Unified Local Update Engine
------------------------------------------------------- */

export function updateLocalContact(userId, changes) {
  if (!userId) return;

  if (!UserCache[userId]) UserCache[userId] = {};
  Object.assign(UserCache[userId], changes);

  const u = UserCache[userId];

  // Update contact list
  const card = document.querySelector(
    `.contact-card[data-contact-id="${userId}"]`
  );
  if (card) {
    if (changes.contact_name) {
      const el = card.querySelector(".contact-name");
      if (el) el.textContent = changes.contact_name;
    }
    if (changes.contact_email) {
      const el = card.querySelector(".contact-email");
      if (el) el.textContent = changes.contact_email;
    }
    if (changes.contact_avatar) {
      const img = card.querySelector(".contact-avatar");
      if (img) img.src = changes.contact_avatar;
    }
  }

  // Update full profile modal
  if (isProfileOpen && openProfileUserId == userId) {
    if (changes.contact_name) $id("fullProfileName").textContent = changes.contact_name;
    if (changes.contact_email) $id("fullProfileEmail").textContent = changes.contact_email;
    if (changes.contact_phone) $id("fullProfilePhone").textContent = changes.contact_phone;
    if (changes.contact_bio) $id("fullProfileBio").textContent = changes.contact_bio;
    if (changes.contact_avatar) $id("fullProfileAvatar").src = changes.contact_avatar;
    if (changes.contact_banner) $id("fullProfileBanner").src = changes.contact_banner;
  }

  // Update lookup cards
  document
    .querySelectorAll(`.lookup-card[data-id="${userId}"]`)
    .forEach((card) => {
      if (changes.contact_name) {
        const el = card.querySelector(".lookup-name");
        if (el) el.textContent = changes.contact_name;
      }
      if (changes.contact_email) {
        const el = card.querySelector(".lookup-email");
        if (el) el.textContent = changes.contact_email;
      }
      if (changes.contact_avatar) {
        const img = card.querySelector(".lookup-avatar img");
        if (img) img.src = changes.contact_avatar;
      }
    });

  // Update message header
  if (window.currentChatUserId == userId) {
    const header = $(".header_msg_box h2");
    if (header && changes.contact_name) header.textContent = changes.contact_name;
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

function updateMessageHeader(name) {
  const header = $(".header_msg_box h2");
  if (header) header.textContent = name ?? "Messages";
}

export function openMessagesFor(userRaw) {
  const user = normalizeContact(userRaw);
  const profileModal = $id("fullProfileModal");

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
    const data = await getJson(
      "https://letsee-backend.onrender.com/api/contacts"
    );

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
   Render Blocked Card
------------------------------------------------------- */

export function renderBlockedCard(userRaw) {
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
    const data = await postJson(
      "https://letsee-backend.onrender.com/api/contacts/unblock",
      { contact_id: user.contact_id }
    );
    if (data.success) loadContacts();
  };

  return li;
}

/* -------------------------------------------------------
   Render Contact Card
------------------------------------------------------- */

export function renderContactCard(userRaw) {
  const user = normalizeContact(userRaw);

  const li = document.createElement("li");
  li.className = "contact-card";
  li.dataset.contactId = String(user.contact_id);

  const lastText = user.last_message?.text || "";
  const unread = user.unread_count > 0 ? `<span class="unread-badge">${user.unread_count}</span>` : "";

  li.innerHTML = `
    <img class="contact-avatar" src="${user.contact_avatar}">
    <span class="contact-status" title="${user.online ? "Online" : "Offline"}"></span>

    <div class="contact-info">
      <div class="contact-name">${user.contact_name}</div>
      <div class="contact-email">${user.contact_email}</div>
      <div class="contact-last">${lastText}</div>
    </div>

    ${unread}

    <div class="contact-actions">
      <button class="info-btn">ℹ️</button>
      <button class="chat-btn">💬</button>
      <button class="block-btn">🚫</button>
      <button class="delete-btn">🗑</button>
    </div>
  `;

  // Info button
  li.querySelector(".info-btn").onclick = (e) => {
    e.stopPropagation();
    openFullProfile(user);
  };

  // Chat button
  li.querySelector(".chat-btn").onclick = (e) => {
    e.stopPropagation();
    openMessagesFor(user);
    selectCard(li);
  };

  // Block button
  li.querySelector(".block-btn").onclick = async (e) => {
    e.stopPropagation();
    const data = await postJson(
      "https://letsee-backend.onrender.com/api/contacts/block",
      { contact_id: user.contact_id }
    );
    if (data.success) loadContacts();
  };

  // Delete button
  li.querySelector(".delete-btn").onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${user.contact_name}?`)) return;
    const data = await postJson(
      "https://letsee-backend.onrender.com/api/contacts/delete",
      { contact_id: user.contact_id }
    );
    if (data.success) loadContacts();
  };

  return li;
}

/* -------------------------------------------------------
   FULL PROFILE MODAL
------------------------------------------------------- */

function openFullProfile(userRaw) {
  const user = normalizeContact(userRaw);
  activeContact = user;
  openProfileUserId = user.contact_id;

  const modal = $id("fullProfileModal");
  modal.classList.add("open");
  isProfileOpen = true;

  $id("fullProfileAvatar").src = user.contact_avatar;
  $id("fullProfileBanner").src = user.contact_banner;

  $id("fullProfileName").textContent = user.contact_name;
  $id("fullProfileEmail").textContent = user.contact_email;
  $id("fullProfilePhone").textContent = user.contact_phone || "No phone";
  $id("fullProfileBio").textContent = user.contact_bio || "No bio";

  if (user.contact_website) {
    const w = $id("fullProfileWebsite");
    w.textContent = user.contact_website;
    w.href = user.contact_website;
  } else {
    $id("fullProfileWebsite").textContent = "None";
    $id("fullProfileWebsite").removeAttribute("href");
  }

  if (user.contact_twitter) {
    const t = $id("fullProfileTwitter");
    t.textContent = user.contact_twitter;
    t.href = "https://twitter.com/" + user.contact_twitter.replace("@", "");
  } else {
    $id("fullProfileTwitter").textContent = "None";
    $id("fullProfileTwitter").removeAttribute("href");
  }

  if (user.contact_instagram) {
    const i = $id("fullProfileInstagram");
    i.textContent = user.contact_instagram;
    i.href =
      "https://instagram.com/" + user.contact_instagram.replace("@", "");
  } else {
    $id("fullProfileInstagram").textContent = "None";
    $id("fullProfileInstagram").removeAttribute("href");
  }

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

  callBtn?.addEventListener("click", () => {
    if (typeof window.startCall === "function")
      window.startCall(user.contact_id, false);
  });

  videoBtn?.addEventListener("click", () => {
    if (typeof window.startCall === "function")
      window.startCall(user.contact_id, true);
  });

  blockBtn?.addEventListener("click", async () => {
    if (!confirm(`Block ${user.contact_name}?`)) return;
    const data = await postJson(
      "https://letsee-backend.onrender.com/api/contacts/block",
      { contact_id: user.contact_id }
    );
    if (data.success) {
      alert("User blocked");
      loadContacts();
      modal.classList.remove("open");
      isProfileOpen = false;
      openProfileUserId = null;
    }
  });

  if (saveBtn) {
    if (user.fromLookup) {
      saveBtn.style.display = "block";
      saveBtn.onclick = () => {
        if (typeof window.saveLookupContact === "function") {
          window.saveLookupContact(user.contact_id);
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

  getJson(
    `https://letsee-backend.onrender.com/api/users/search?query=${encodeURIComponent(
      query
    )}`
  )
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

















