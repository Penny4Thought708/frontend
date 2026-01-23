// public/js/contacts.js
// -------------------------------------------------------
// FULL CONTACT SYSTEM — ONE GIANT FILE
// Rendering, presence, lookup, profile modal, messaging,
// blocked list, local updates, and backend integration.
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
} from "../session.js";

import { setReceiver, loadMessages } from "../messaging.js";
import { setContactLookup } from "../call-log.js";

let activeContact = null;
let isProfileOpen = false;
let isMessagesOpen = false;
let openProfileUserId = null;
let autoCloseProfileOnMessages = true;


/* -------------------------------------------------------
   GLOBAL STATE
------------------------------------------------------- */
window.UserCache = window.UserCache || {};
window.pendingPresence = window.pendingPresence || new Map();

let activeContact = null;
let isProfileOpen = false;
let openProfileUserId = null;

/* -------------------------------------------------------
   HELPERS
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
    body: JSON.stringify(body)
  });
  return res.json();
}

/* -------------------------------------------------------
   NORMALIZE CONTACT
------------------------------------------------------- */
export function normalizeContact(raw) {
  if (!raw) return {};

  const safe = (v, fallback = "") =>
    v === null || v === undefined || v === "null" ? fallback : String(v);

  const avatar = raw.avatar
    ? (raw.avatar.startsWith("/uploads")
        ? raw.avatar
        : `/uploads/avatars/${raw.avatar}`)
    : "/img/defaultUser.png";

  const banner = raw.banner
    ? (raw.banner.startsWith("/uploads")
        ? raw.banner
        : `/uploads/banners/${raw.banner}`)
    : "/img/profile-banner.jpg";

  const last = raw.last_message || {};
  const lastMessage = {
    id: last.id ?? null,
    text: last.text ?? "",
    type: last.type ?? "text",
    file_url: last.file_url ?? null,
    created_at: last.created_at ?? null,
    unread: Number(last.unread ?? 0)
  };

  const user = {
    contact_id: safe(raw.id),
    contact_name: safe(raw.name),
    contact_email: safe(raw.email),

    contact_avatar: avatar,
    contact_banner: banner,

    contact_phone: safe(raw.phone),
    contact_bio: safe(raw.bio),

    contact_website: safe(raw.website),
    contact_twitter: safe(raw.twitter),
    contact_instagram: safe(raw.instagram),

    favorite: raw.favorite ?? false,
    added_on: raw.added_on ?? null,

    online: raw.online ?? false,

    last_message: lastMessage,
    last_message_at: lastMessage.created_at,
    unread_count: lastMessage.unread,

    fromLookup: raw.fromLookup === true
  };

  window.UserCache[user.contact_id] = {
    ...(window.UserCache[user.contact_id] || {}),
    ...user
  };

  return user;
}

/* -------------------------------------------------------
   RENDER CONTACT CARD
------------------------------------------------------- */
export function renderContactCard(userRaw) {
  const user = normalizeContact(userRaw);

  const li = document.createElement("li");
  li.className = "contact-card";
  li.dataset.contactId = String(user.contact_id);

  const lastText =
    user.last_message?.text?.trim() ||
    (user.last_message?.file_url ? "[Attachment]" : "");

  const unreadBadge =
    user.unread_count > 0
      ? `<span class="unread-badge">${user.unread_count}</span>`
      : "";

  li.innerHTML = `
    <div class="avatar-wrapper">
      <img class="contact-avatar" src="${user.contact_avatar}" alt="avatar">
      <span class="contact-status ${user.online ? "online" : "offline"}"
            title="${user.online ? "Online" : "Offline"}"></span>
    </div>

    <div class="contact-info">
      <div class="contact-name">${user.contact_name}</div>
      <div class="contact-email">${user.contact_email}</div>
      <div class="contact-last">${lastText}</div>
    </div>

    ${unreadBadge}

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
    const data = await postJson(
      "https://letsee-backend.onrender.com/api/contacts/block",
      { contact_id: user.contact_id }
    );
    if (data.success) loadContacts();
  };

  li.querySelector(".delete-btn").onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${user.contact_name}?`)) return;

    const data = await postJson(
      "https://letsee-backend.onrender.com/api/contacts/delete",
      { contact_id: user.contact_id }
    );

    if (data.success) loadContacts();
  };

  li.querySelector(".contact-avatar").onerror = () => {
    li.querySelector(".contact-avatar").src = "/img/defaultUser.png";
  };

  return li;
}

/* -------------------------------------------------------
   RENDER CONTACT LIST
------------------------------------------------------- */
export function renderContactList(users) {
  const list = $id("contact_list");
  if (!list) return;

  list.innerHTML = "";

  users.forEach((u) => {
    list.appendChild(renderContactCard(u));
  });
}

/* -------------------------------------------------------
   UPDATE CONTACT STATUS (presence)
------------------------------------------------------- */
export function updateContactStatus(contactId, online) {
  const id = String(contactId);

  if (window.UserCache[id]) {
    window.UserCache[id].online = online;
  }

  const card = document.querySelector(
    `.contact-card[data-contact-id="${id}"]`
  );
  if (!card) return false;

  const status = card.querySelector(".contact-status");
  if (status) {
    status.classList.toggle("online", online);
    status.classList.toggle("offline", !online);
  }

  return true;
}

/* -------------------------------------------------------
   LOAD CONTACTS
------------------------------------------------------- */
export async function loadContacts() {
  try {
    const data = await getJson(
      "https://letsee-backend.onrender.com/api/contacts"
    );

    const contacts = data.contacts.map(normalizeContact);
    renderContactList(contacts);

    const blockedList = $id("blocked-contacts");
    if (blockedList) {
      blockedList.innerHTML = "";
      data.blocked
        .map(normalizeContact)
        .forEach((c) => blockedList.appendChild(renderBlockedCard(c)));
    }

    setContactLookup(contacts);

    socket.emit("presence:get", { userId: getMyUserId() });
  } catch (err) {
    console.error("[contacts] loadContacts failed:", err);
  }
}

/* -------------------------------------------------------
   BLOCKED CARD
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

    <button class="unblock-btn">Unblock</button>
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
   OPEN MESSAGES
------------------------------------------------------- */
export function openMessagesFor(userRaw) {
  const user = normalizeContact(userRaw);

  activeContact = user;
  window.currentChatUserId = user.contact_id;

  setReceiver(user.contact_id);

  const header = $(".header_msg_box h2");
  if (header) header.textContent = user.contact_name;

  if (messageBox) messageBox.classList.add("active");

  loadMessages();
}

/* -------------------------------------------------------
   SELECT CARD
------------------------------------------------------- */
function selectCard(li) {
  document
    .querySelectorAll(".contact-card.selected")
    .forEach((c) => c.classList.remove("selected"));
  li.classList.add("selected");
}

/* -------------------------------------------------------
   FULL PROFILE MODAL
------------------------------------------------------- */
export function openFullProfile(userRaw) {
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

  const w = $id("fullProfileWebsite");
  if (user.contact_website) {
    w.textContent = user.contact_website;
    w.href = user.contact_website;
  } else {
    w.textContent = "None";
    w.removeAttribute("href");
  }

  const t = $id("fullProfileTwitter");
  if (user.contact_twitter) {
    t.textContent = user.contact_twitter;
    t.href = "https://twitter.com/" + user.contact_twitter.replace("@", "");
  } else {
    t.textContent = "None";
    t.removeAttribute("href");
  }

  const i = $id("fullProfileInstagram");
  if (user.contact_instagram) {
    i.textContent = user.contact_instagram;
    i.href = "https://instagram.com/" + user.contact_instagram.replace("@", "");
  } else {
    i.textContent = "None";
    i.removeAttribute("href");
  }

  $id("copyEmailBtn").onclick = () =>
    navigator.clipboard.writeText(user.contact_email);

  $id("copyPhoneBtn").onclick = () =>
    navigator.clipboard.writeText(user.contact_phone || "");
}

/* -------------------------------------------------------
   LOOKUP SEARCH
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
   RENDER LOOKUP CARD
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
























