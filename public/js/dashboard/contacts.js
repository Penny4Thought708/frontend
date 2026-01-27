// public/js/contacts.js
// -------------------------------------------------------
// CONTACT SYSTEM — ULTRA DIAGNOSTIC VERSION (FIXED)
// Rendering, presence, lookup, profile modal, messaging,
// blocked list, local updates, and backend integration.
// -------------------------------------------------------

import { socket } from "../socket.js";
import {
  getMyUserId,
  lookupBtn,
  lookupInput,
  lookupResults,
  messageBox
} from "../session.js";
import { setReceiver, loadMessages } from "../messaging.js";
import { setContactLookup } from "../call-log.js";

let activeContact = null;
let isProfileOpen = false;
let openProfileUserId = null;

/* -------------------------------------------------------
   GLOBAL STATE
------------------------------------------------------- */
window.UserCache = window.UserCache || {};
window.pendingPresence = window.pendingPresence || new Map();

/* -------------------------------------------------------
   HELPERS WITH LOGGING
------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $id = (id) => document.getElementById(id);

const BACKEND_BASE = "https://letsee-backend.onrender.com";

async function getJson(url) {
  console.log("%c[contacts] GET → " + url, "color: #00bfff");

  try {
    const res = await fetch(url, { credentials: "include" });

    console.log(
      "%c[contacts] Response status: " + res.status,
      "color: #00bfff"
    );

    const json = await res.json();

    console.log(
      "%c[contacts] Response JSON:",
      "color: #00bfff",
      json
    );

    return json;
  } catch (err) {
    console.error("[contacts] GET FAILED:", err);
    return null;
  }
}

async function postJson(url, body = {}) {
  console.log("%c[contacts] POST → " + url, "color: #ff8800", body);

  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    console.log(
      "%c[contacts] POST status: " + res.status,
      "color: #ff8800"
    );

    const json = await res.json();

    console.log(
      "%c[contacts] POST JSON:",
      "color: #ff8800",
      json
    );

    return json;
  } catch (err) {
    console.error("[contacts] POST FAILED:", err);
    return null;
  }
}

/* -------------------------------------------------------
   NORMALIZE CONTACT (RAW FROM BACKEND ONLY)
------------------------------------------------------- */
export function normalizeContact(raw) {
  console.log("%c[contacts] normalizeContact(raw):", "color: #9b59b6", raw);

  if (!raw) {
    console.error("[contacts] normalizeContact received NULL raw contact");
    return {};
  }

  const safe = (v, fallback = "") =>
    v === null || v === undefined || v === "null" ? fallback : String(v);

  // Avatar path: backend uploads or default (relative for GitHub Pages)
  let avatar;
  if (raw.avatar) {
    if (raw.avatar.startsWith("http")) {
      avatar = raw.avatar;
    } else if (raw.avatar.startsWith("/uploads")) {
      avatar = BACKEND_BASE + raw.avatar;
    } else {
      avatar = `${BACKEND_BASE}/uploads/avatars/${raw.avatar}`;
    }
  } else {
    // no leading slash so it works on GitHub Pages
    avatar = "img/defaultUser.png";
  }

  // Banner path
  let banner;
  if (raw.banner) {
    if (raw.banner.startsWith("http")) {
      banner = raw.banner;
    } else if (raw.banner.startsWith("/uploads")) {
      banner = BACKEND_BASE + raw.banner;
    } else {
      banner = `${BACKEND_BASE}/uploads/banners/${raw.banner}`;
    }
  } else {
    banner = "img/profile-banner.jpg";
  }

  const last = raw.last_message || {};
  const lastMessage = {
    id: last.id ?? null,
    text: last.message ?? last.text ?? "",
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

  console.log("%c[contacts] normalized user:", "color: #9b59b6", user);

  window.UserCache[user.contact_id] = {
    ...(window.UserCache[user.contact_id] || {}),
    ...user
  };

  return user;
}

/* -------------------------------------------------------
   UPDATE CONTACT STATUS
------------------------------------------------------- */
export function updateContactStatus(contactId, online) {
  console.log(
    "%c[contacts] updateContactStatus()",
    "color: #e84393",
    contactId,
    online
  );

  const id = String(contactId);

  if (window.UserCache[id]) {
    window.UserCache[id].online = online;
  } else {
    console.warn("[contacts] updateContactStatus: no UserCache entry for", id);
  }

  const card = document.querySelector(
    `.contact-card[data-contact-id="${id}"]`
  );

  if (!card) {
    console.warn("[contacts] updateContactStatus: no card found for", id);
    return false;
  }

  const status = card.querySelector(".contact-status");
  if (status) {
    status.classList.toggle("online", online);
    status.classList.toggle("offline", !online);
  } else {
    console.warn("[contacts] updateContactStatus: no .contact-status for", id);
  }

  return true;
}

/* -------------------------------------------------------
   RENDER CONTACT CARD (TAKES NORMALIZED USER)
------------------------------------------------------- */
export function renderContactCard(user) {
  console.log("%c[contacts] renderContactCard()", "color: #2ecc71", user);

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
      <img class="contact-avatar" src="${user.contact_avatar}">
      <span class="contact-status ${user.online ? "online" : "offline"}"></span>
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

  // Info
  li.querySelector(".info-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    console.log("[contacts] info-btn clicked for", user.contact_id);
    openFullProfile(user);
  });

  // Chat
  li.querySelector(".chat-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    console.log("[contacts] chat-btn clicked for", user.contact_id);
    openMessagesFor(user);
    selectCard(li);
  });

  // Block
  li.querySelector(".block-btn")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    console.log("[contacts] block-btn clicked for", user.contact_id);

    const data = await postJson(
      `${BACKEND_BASE}/api/contacts/block`,
      { contact_id: user.contact_id }
    );

    if (!data?.success) {
      console.error("[contacts] Failed to block contact:", data?.error);
      return;
    }

    loadContacts();
  });

  // Delete
  li.querySelector(".delete-btn")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    console.log("[contacts] delete-btn clicked for", user.contact_id);

    if (!confirm(`Delete ${user.contact_name}?`)) return;

    const data = await postJson(
      `${BACKEND_BASE}/api/contacts/delete`,
      { contact_id: user.contact_id }
    );

    if (!data?.success) {
      console.error("[contacts] Failed to delete contact:", data?.error);
      return;
    }

    loadContacts();
  });

  return li;
}

/* -------------------------------------------------------
   RENDER CONTACT LIST
------------------------------------------------------- */
export function renderContactList(users) {
  console.log("%c[contacts] renderContactList()", "color: #3498db", users);

  const list = $id("contacts");
  if (!list) {
    console.error("[contacts] ERROR: #contacts element not found in DOM");
    return;
  }

  list.innerHTML = "";
  users.forEach((u) => list.appendChild(renderContactCard(u)));
}

/* -------------------------------------------------------
   LOAD CONTACTS — MAXIMUM LOGGING
------------------------------------------------------- */
export async function loadContacts() {
  console.log("%c[contacts] loadContacts() START", "color: #e67e22");

  try {
    const url = `${BACKEND_BASE}/api/contacts`;

    console.log("%c[contacts] Fetching contacts…", "color: #e67e22");

    const data = await getJson(url);

    console.log("%c[contacts] Backend returned:", "color: #e67e22", data);

    if (!data) {
      console.error("[contacts] ERROR: No response from backend");
      return;
    }

    if (data.success === false) {
      console.error("[contacts] BACKEND ERROR:", data.error);
      return;
    }

    if (!Array.isArray(data.contacts)) {
      console.error(
        "[contacts] ERROR: data.contacts is not an array:",
        data.contacts
      );
      return;
    }

    console.log(
      "%c[contacts] Normalizing contacts…",
      "color: #e67e22"
    );

    const contacts = data.contacts.map((c) => normalizeContact(c));

    console.log(
      "%c[contacts] Normalized contacts:",
      "color: #e67e22",
      contacts
    );

    renderContactList(contacts);

    // Blocked list
    const blockedList = $id("blocked-contacts");
    if (!blockedList) {
      console.warn("[contacts] WARNING: #blocked-contacts not found");
    } else {
      blockedList.innerHTML = "";
      (data.blocked || [])
        .map((c) => normalizeContact(c))
        .forEach((c) => blockedList.appendChild(renderBlockedCard(c)));
    }

    console.log("%c[contacts] Setting lookup cache", "color: #e67e22");
    setContactLookup(contacts);

    console.log("%c[contacts] Requesting presence update", "color: #e67e22");
    socket.emit("presence:get", { userId: getMyUserId() });

    console.log("%c[contacts] loadContacts() COMPLETE", "color: #2ecc71");
  } catch (err) {
    console.error("[contacts] loadContacts() FAILED:", err);
  }
}

/* -------------------------------------------------------
   BLOCKED CARD
------------------------------------------------------- */
export function renderBlockedCard(user) {
  console.log("%c[contacts] renderBlockedCard()", "color: #c0392b", user);

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

  li.querySelector(".unblock-btn")?.addEventListener("click", async () => {
    console.log("[contacts] unblock-btn clicked for", user.contact_id);

    const data = await postJson(
      `${BACKEND_BASE}/api/contacts/unblock`,
      { contact_id: user.contact_id }
    );

    if (!data?.success) {
      console.error("[contacts] Failed to unblock:", data?.error);
      return;
    }

    loadContacts();
  });

  return li;
}

/* -------------------------------------------------------
   OPEN MESSAGES
------------------------------------------------------- */
export function openMessagesFor(user) {
  console.log("%c[contacts] openMessagesFor()", "color: #1abc9c", user);

  activeContact = user;
  window.currentChatUserId = user.contact_id;

  setReceiver(user.contact_id);

  const header = $(".header_msg_box h2");
  if (!header) {
    console.error("[contacts] ERROR: .header_msg_box h2 not found");
  } else {
    header.textContent = user.contact_name;
  }

  if (!messageBox) {
    console.error("[contacts] ERROR: messageBox not found");
  } else {
    messageBox.classList.add("active");
  }

  loadMessages();
}

/* -------------------------------------------------------
   SELECT CARD
------------------------------------------------------- */
function selectCard(li) {
  console.log("%c[contacts] selectCard()", "color: #8e44ad", li);

  document
    .querySelectorAll(".contact-card.selected")
    .forEach((c) => c.classList.remove("selected"));

  li.classList.add("selected");
}

/* -------------------------------------------------------
   FULL PROFILE MODAL
------------------------------------------------------- */
export function openFullProfile(user) {
  console.log("%c[contacts] openFullProfile()", "color: #f39c12", user);

  activeContact = user;
  openProfileUserId = user.contact_id;

  const modal = $id("fullProfileModal");
  if (!modal) {
    console.error("[contacts] ERROR: #fullProfileModal not found");
    return;
  }

  modal.classList.add("open");
  isProfileOpen = true;

  const avatarEl = $id("fullProfileAvatar");
  const bannerEl = $id("fullProfileBanner");
  const nameEl = $id("fullProfileName");
  const emailEl = $id("fullProfileEmail");
  const phoneEl = $id("fullProfilePhone");
  const bioEl = $id("fullProfileBio");
  const webEl = $id("fullProfileWebsite");
  const twEl = $id("fullProfileTwitter");
  const igEl = $id("fullProfileInstagram");

  if (avatarEl) avatarEl.src = user.contact_avatar;
  if (bannerEl) bannerEl.src = user.contact_banner;

  if (nameEl) nameEl.textContent = user.contact_name;
  if (emailEl) emailEl.textContent = user.contact_email;
  if (phoneEl) phoneEl.textContent = user.contact_phone || "No phone";
  if (bioEl) bioEl.textContent = user.contact_bio || "No bio";

  if (webEl) {
    if (user.contact_website) {
      webEl.textContent = user.contact_website;
      webEl.href = user.contact_website;
    } else {
      webEl.textContent = "None";
      webEl.removeAttribute("href");
    }
  }

  if (twEl) {
    if (user.contact_twitter) {
      twEl.textContent = user.contact_twitter;
      twEl.href =
        "https://twitter.com/" + user.contact_twitter.replace("@", "");
    } else {
      twEl.textContent = "None";
      twEl.removeAttribute("href");
    }
  }

  if (igEl) {
    if (user.contact_instagram) {
      igEl.textContent = user.contact_instagram;
      igEl.href =
        "https://instagram.com/" + user.contact_instagram.replace("@", "");
    } else {
      igEl.textContent = "None";
      igEl.removeAttribute("href");
    }
  }
}

/* -------------------------------------------------------
   LOOKUP SEARCH
------------------------------------------------------- */
function runLookup(query) {
  console.log("%c[contacts] runLookup()", "color: #16a085", query);

  if (!lookupResults) {
    console.error("[contacts] ERROR: lookupResults element missing");
    return;
  }

  if (!query) {
    lookupResults.innerHTML = "";
    return;
  }

  lookupResults.innerHTML = `<li class="empty">Searching...</li>`;

  getJson(
    `${BACKEND_BASE}/api/users/search?query=${encodeURIComponent(query)}`
  )
    .then((data) => {
      console.log("%c[contacts] Lookup response:", "color: #16a085", data);

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
    .catch((err) => {
      console.error("[contacts] Lookup error:", err);
      lookupResults.innerHTML = `<li class="empty">Lookup error</li>`;
    });
}

lookupBtn?.addEventListener("click", () => {
  console.log("[contacts] lookupBtn clicked");
  runLookup(lookupInput?.value?.trim() ?? "");
});

lookupInput?.addEventListener("input", () => {
  clearTimeout(window.lookupTimer);
  window.lookupTimer = setTimeout(() => {
    console.log("[contacts] lookupInput changed:", lookupInput.value.trim());
    runLookup(lookupInput.value.trim());
  }, 300);
});

/* -------------------------------------------------------
   RENDER LOOKUP CARD
------------------------------------------------------- */
export function renderLookupCard(user) {
  console.log("%c[contacts] renderLookupCard()", "color: #2980b9", user);

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

  li.querySelector(".lookup-info-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    console.log("[contacts] lookup info clicked for", user.contact_id);
    openFullProfile(user);
  });

  li.querySelector(".lookup-open-chat")?.addEventListener("click", (e) => {
    e.stopPropagation();
    console.log("[contacts] lookup chat clicked for", user.contact_id);
    openMessagesFor(user);
  });

  li.addEventListener("click", () => {
    console.log("[contacts] lookup card clicked for", user.contact_id);
    openFullProfile(user);
  });

  return li;
}

/* -------------------------------------------------------
   EXPOSE GLOBALS
------------------------------------------------------- */
window.openFullProfile = openFullProfile;
window.openMessagesFor = openMessagesFor;
window.loadContacts = loadContacts;
window.updateContactStatus = updateContactStatus;








































