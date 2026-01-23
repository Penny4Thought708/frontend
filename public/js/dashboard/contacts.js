// public/js/contacts.js
// Unified Contacts, Lookup, Profile Modal, Messaging Entry

import { normalizeContact } from "./dashboard/contacts.js";
import { renderContactCard } from "./dashboard/ContactCard.js";
import { renderContactList } from "./dashboard/ContactList.js";
import { updateContactStatus } from "./dashboard/contacts.js";
import { socket } from "./socket.js";
import { getMyUserId, lookupBtn, lookupInput, lookupResults, messageBox } from "./session.js";
import { setReceiver, loadMessages } from "./messaging.js";
import { setContactLookup } from "./call-log.js";

/* -------------------------------------------------------
   Global State
------------------------------------------------------- */
window.UserCache = window.UserCache || {};
window.pendingPresence = window.pendingPresence || new Map();

let activeContact = null;
let isProfileOpen = false;
let openProfileUserId = null;

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
   Load Contacts (uses new modular renderer)
------------------------------------------------------- */
export async function loadContacts() {
  try {
    const data = await getJson("https://letsee-backend.onrender.com/api/contacts");

    const list = $id("contact_list");
    const blockedList = $id("blocked-contacts");

    if (list && Array.isArray(data.contacts)) {
      const normalized = data.contacts.map(normalizeContact);
      window.ContactList = normalized;

      renderContactList(normalized, window.pendingPresence, updateContactStatus);
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
    console.error("[contacts] Failed to load contacts:", err);
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
   Messaging Entry
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
   Full Profile Modal
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




















