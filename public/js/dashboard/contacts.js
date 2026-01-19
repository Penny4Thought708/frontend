// public/js/dashboard/contacts.js
// -------------------------------------------------------
// Contacts, presence, lookup, and messaging entrypoint
// Node backend version (mapped to legacy UI fields)
// -------------------------------------------------------

import { socket } from "../socket.js";

import {
  getMyUserId,
  lookupBtn,
  lookupInput,
  lookupResults,
  getVoiceBtn,
  getVideoBtn,
  messageBox,
  getJson,
  postJson
} from "../session.js";

import { setReceiver, loadMessages } from "../messaging.js";
import { setContactLookup } from "../call-log.js";

let activeContact = null;
let isProfileOpen = false;
let isMessagesOpen = false;
let openProfileUserId = null;
let autoCloseProfileOnMessages = true;

window.UserCache = window.UserCache || {};

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $id = (id) => document.getElementById(id);

// -------------------------------------------------------
// Normalize backend → legacy UI fields
// -------------------------------------------------------
function normalizeContact(raw) {
  if (!raw) return null;

  const user = {
    contact_id: raw.id,
    contact_name: raw.name,
    contact_email: raw.email,
    contact_avatar: raw.avatar || "img/defaultUser.png",
    contact_phone: raw.phone || "",
    contact_bio: raw.bio || "",
    contact_banner: raw.banner || "img/profile-banner.jpg",

    online: raw.online ?? false,
    unread_count: raw.unread ?? 0,

    fromLookup: raw.fromLookup === true
  };

  window.UserCache[user.contact_id] = user;
  return user;
}

// -------------------------------------------------------
// Update Local Contact
// -------------------------------------------------------
export function updateLocalContact(userId, changes) {
  if (!UserCache[userId]) UserCache[userId] = {};
  Object.assign(UserCache[userId], changes);

  const u = UserCache[userId];

  const card = document.querySelector(
    `.contact-card[data-contact-id="${userId}"]`
  );

  if (card) {
    if (changes.contact_name)
      card.querySelector(".contact-name").textContent = u.contact_name;

    if (changes.contact_email)
      card.querySelector(".contact-email").textContent = u.contact_email;

    if (changes.contact_avatar)
      card.querySelector(".contact-avatar").src = u.contact_avatar;
  }

  if (isProfileOpen && openProfileUserId === userId) {
    $id("fullProfileName").textContent = u.contact_name;
    $id("fullProfileEmail").textContent = u.contact_email;
    $id("fullProfilePhone").textContent = u.contact_phone || "No phone";
    $id("fullProfileBio").textContent = u.contact_bio || "No bio";
    $id("fullProfileAvatar").src = u.contact_avatar;
    $id("fullProfileBanner").src = u.contact_banner;
  }
}

// -------------------------------------------------------
// Call Buttons
// -------------------------------------------------------
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

// -------------------------------------------------------
// Presence
// -------------------------------------------------------
export function registerPresence() {
  socket.emit("session:init", {
    userId: getMyUserId()
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

    const list = $id("contacts");
    const blockedList = $id("blocked-contacts");

    if (list && Array.isArray(data.contacts)) {
      list.innerHTML = "";

      const normalized = data.contacts.map(normalizeContact);

      normalized
        .sort((a, b) => a.contact_name.localeCompare(b.contact_name))
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
    const data = await postJson("/contacts/unblock", {
      contact_id: user.contact_id
    });
    if (data.success) loadContacts();
  };

  return li;
}

// -------------------------------------------------------
// Render Contact Card
// -------------------------------------------------------
export function renderContactCard(userRaw) {
  const user = normalizeContact(userRaw);

  const li = document.createElement("li");
  li.className = "contact-card";
  li.dataset.contactId = String(user.contact_id);

  li.innerHTML = `
    <img class="contact-avatar" src="${user.contact_avatar}">
    <span class="contact-status" title="${user.online ? "Online" : "Offline"}"></span>

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
    const data = await postJson("/contacts/block", {
      contact_id: user.contact_id
    });
    if (data.success) loadContacts();
  };

  li.querySelector(".delete-btn").onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${user.contact_name}?`)) return;
    const data = await postJson("/contacts/delete", {
      contact_id: user.contact_id
    });
    if (data.success) loadContacts();
  };

  return li;
}

// -------------------------------------------------------
// FULL PROFILE MODAL
// -------------------------------------------------------
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
    const data = await postJson("/contacts/block", {
      contact_id: user.contact_id
    });
    if (data.success) {
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
          const normalized = normalizeContact({ ...u, fromLookup: true });
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













