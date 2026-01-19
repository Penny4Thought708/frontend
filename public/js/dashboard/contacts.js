// public/js/dashboard/contacts.js
// -------------------------------------------------------
// Modern Contacts Module (Node backend, no last-message,
// no unread badges, clean UI, presence, lookup, messaging)
// -------------------------------------------------------

import { socket } from "../socket.js";

import {
  getMyUserId,
  getMyFullname,
  lookupBtn,
  lookupInput,
  lookupResults,
  getVoiceBtn,
  getVideoBtn,
  messageBox,
  getJson,
  postJson,
} from "../session.js";

import { setReceiver, loadMessages } from "../messaging.js";
import { setContactLookup } from "../call-log.js";

// -------------------------------------------------------
// State
// -------------------------------------------------------
let activeContact = null;
let isProfileOpen = false;
let isMessagesOpen = false;
let openProfileUserId = null;
let autoCloseProfileOnMessages = true;

// Global cache
window.UserCache = window.UserCache || {};

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $id = (id) => document.getElementById(id);

// -------------------------------------------------------
// Normalize Contact (Option B structure)
// -------------------------------------------------------
function normalizeContact(raw) {
  if (!raw) return null;

  const user = {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    avatar: raw.avatar,
    phone: raw.phone || "",
    bio: raw.bio || "",
    banner: raw.banner,
    is_favorite: raw.is_favorite || false,
    added_on: raw.added_on,
    online: raw.online || false,
    unread: raw.unread || 0,
    fromLookup: raw.fromLookup === true,
  };

  // Cache
  window.UserCache[user.id] = user;
  return user;
}

// -------------------------------------------------------
// Update Local Contact (UI sync)
// -------------------------------------------------------
export function updateLocalContact(userId, changes) {
  const u = window.UserCache[userId];
  if (!u) return;

  Object.assign(u, changes);

  // Update contact card
  const card = document.querySelector(
    `.contact-card[data-contact-id="${userId}"]`
  );
  if (card) {
    if (changes.name) card.querySelector(".contact-name").textContent = u.name;
    if (changes.email)
      card.querySelector(".contact-email").textContent = u.email;
    if (changes.avatar)
      card.querySelector(".contact-avatar").src = u.avatar;
  }

  // Update profile modal
  if (isProfileOpen && openProfileUserId === userId) {
    $id("fullProfileName").textContent = u.name;
    $id("fullProfileEmail").textContent = u.email;
    $id("fullProfilePhone").textContent = u.phone || "No phone";
    $id("fullProfileBio").textContent = u.bio || "No bio";
    $id("fullProfileAvatar").src = u.avatar;
    $id("fullProfileBanner").src = u.banner;
  }
}

// -------------------------------------------------------
// Call Buttons
// -------------------------------------------------------
function wireGlobalCallButtons(user) {
  const voiceBtn = getVoiceBtn?.();
  const videoBtn = getVideoBtn?.();

  if (voiceBtn) {
    voiceBtn.dataset.targetId = user.id;
    voiceBtn.dataset.targetName = user.name;
  }

  if (videoBtn) {
    videoBtn.dataset.targetId = user.id;
    videoBtn.dataset.targetName = user.name;
  }
}

// -------------------------------------------------------
// Messaging Panel Toggle
// -------------------------------------------------------
function showMessages() {
  if (!messageBox) return;

  if (messageBox.classList.contains("active")) {
    messageBox.classList.remove("active");
    messageBox.classList.add("closing");
    setTimeout(() => messageBox.classList.remove("closing"), 750);
    return;
  }

  messageBox.classList.add("active");
}

// -------------------------------------------------------
// Messaging Logic
// -------------------------------------------------------
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

  if (isMessagesOpen && activeContact?.id === user.id) {
    showMessages();
    isMessagesOpen = false;
    return;
  }

  activeContact = user;

  setReceiver(user.id);
  window.currentChatUserId = user.id;

  isMessagesOpen = true;

  wireGlobalCallButtons(user);
  updateMessageHeader(user.name);

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

// -------------------------------------------------------
// Presence
// -------------------------------------------------------
export function registerPresence() {
  socket.emit("session:init", {
    userId: getMyUserId(),
    fullname: getMyFullname(),
  });

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

// -------------------------------------------------------
// Load Contacts
// -------------------------------------------------------
export async function loadContacts() {
  try {
    const data = await getJson("/contacts");
    console.log("CONTACTS API RESPONSE:", data);

    const list = $id("contacts");
    const blockedList = $id("blocked-contacts");

    if (list && Array.isArray(data.contacts)) {
      list.innerHTML = "";

      const normalized = data.contacts.map(normalizeContact);

      normalized
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((c) => list.appendChild(renderContactCard(c)));

      setContactLookup(normalized);
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

// -------------------------------------------------------
// Render Blocked Card
// -------------------------------------------------------
function renderBlockedCard(user) {
  const li = document.createElement("li");
  li.className = "blocked-card";
  li.dataset.userId = user.id;

  li.innerHTML = `
    <div class="blocked-avatar">
      <img src="${user.avatar}">
    </div>

    <div class="blocked-info">
      <div class="blocked-name">${user.name}</div>
      <div class="blocked-email">${user.email}</div>
    </div>

    <button class="unblock-btn" data-id="${user.id}">Unblock</button>
  `;

  li.querySelector(".unblock-btn").onclick = async () => {
    const data = await postJson("/contacts/unblock", {
      contact_id: user.id,
    });
    if (data.success) loadContacts();
  };

  return li;
}

// -------------------------------------------------------
// Render Contact Card
// -------------------------------------------------------
export function renderContactCard(user) {
  const li = document.createElement("li");
  li.className = "contact-card";
  li.dataset.contactId = String(user.id);

  li.innerHTML = `
    <img class="contact-avatar" src="${user.avatar}">
    <span class="contact-status" title="${
      user.online ? "Online" : "Offline"
    }"></span>

    <div class="contact-info">
      <div class="contact-name">${user.name}</div>
      <div class="contact-email">${user.email}</div>
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
    const data = await postJson("/contacts/block", {
      contact_id: user.id,
    });
    if (data.success) loadContacts();
  };

  li.querySelector(".delete-btn").onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${user.name}?`)) return;
    const data = await postJson("/contacts/delete", {
      contact_id: user.id,
    });
    if (data.success) loadContacts();
  };

  return li;
}

// -------------------------------------------------------
// FULL PROFILE MODAL
// -------------------------------------------------------
function openFullProfile(user) {
  activeContact = user;
  openProfileUserId = user.id;

  const modal = $id("fullProfileModal");
  if (!modal) return;
  modal.classList.add("open");
  isProfileOpen = true;

  $id("fullProfileAvatar").src = user.avatar;
  $id("fullProfileBanner").src = user.banner;

  $id("fullProfileName").textContent = user.name;
  $id("fullProfileEmail").textContent = user.email;
  $id("fullProfilePhone").textContent = user.phone || "No phone";
  $id("fullProfileBio").textContent = user.bio || "No bio";

  const callBtn = $id("profileCallBtn");
  const videoBtn = $id("profileVideoBtn");
  const blockBtn = $id("profileBlockBtn");

  callBtn?.addEventListener("click", () => {
    if (typeof window.startCall === "function")
      window.startCall(user.id, false);
  });

  videoBtn?.addEventListener("click", () => {
    if (typeof window.startCall === "function")
      window.startCall(user.id, true);
  });

  blockBtn?.addEventListener("click", async () => {
    if (!confirm(`Block ${user.name}?`)) return;
    const data = await postJson("/contacts/block", {
      contact_id: user.id,
    });
    if (data.success) {
      loadContacts();
      modal.classList.remove("open");
      isProfileOpen = false;
      openProfileUserId = null;
    }
  });
}

// -------------------------------------------------------
// Lookup Search
// -------------------------------------------------------
function runLookup(query) {
  if (!lookupResults) return;
  if (!query) {
    lookupResults.innerHTML = "";
    return;
  }

  lookupResults.innerHTML = `<li class="empty">Searching...</li>`;

  getJson(`/users/search?query=${encodeURIComponent(query)}`)
    .then((data) => {
      lookupResults.innerHTML = "";

      if (Array.isArray(data) && data.length) {
        data.forEach((u) => {
          const normalized = normalizeContact({
            ...u,
            fromLookup: true,
          });
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

// -------------------------------------------------------
// Render Lookup Card
// -------------------------------------------------------
export function renderLookupCard(user) {
  const li = document.createElement("li");
  li.className = "lookup-card";
  li.dataset.id = user.id;

  li.innerHTML = `
    <div class="lookup-avatar">
      <img src="${user.avatar}">
    </div>

    <div class="lookup-info">
      <div class="lookup-name">${user.name}</div>
      <div class="lookup-email">${user.email}</div>
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









