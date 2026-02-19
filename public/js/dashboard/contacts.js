// -------------------------------------------------------
// CONTACT SYSTEM — ULTRA DIAGNOSTIC + NEW UI VERSION
// Full rewrite to match neon-glass layout, floating panels,
// updated HTML structure, and unified contact rendering.
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
import { userNames, userAvatars } from "../shared/user-cache.js";

let activeContact = null;
let isProfileOpen = false;
let openProfileUserId = null;

/* -------------------------------------------------------
   GLOBAL STATE
------------------------------------------------------- */
window.UserCache = window.UserCache || {};
window.pendingPresence = window.pendingPresence || new Map();

const $ = (sel, root = document) => root.querySelector(sel);
const $id = (id) => document.getElementById(id);

const BACKEND_BASE = "https://letsee-backend.onrender.com";

/* -------------------------------------------------------
   FETCH HELPERS
------------------------------------------------------- */
async function getJson(url) {
  console.log("%c[contacts] GET → " + url, "color: #00bfff");

  try {
    const res = await fetch(url, { credentials: "include" });
    console.log("%c[contacts] Status: " + res.status, "color: #00bfff");

    const json = await res.json();
    console.log("%c[contacts] JSON:", "color: #00bfff", json);

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

    console.log("%c[contacts] Status: " + res.status, "color: #ff8800");

    const json = await res.json();
    console.log("%c[contacts] JSON:", "color: #ff8800", json);

    return json;
  } catch (err) {
    console.error("[contacts] POST FAILED:", err);
    return null;
  }
}

/* -------------------------------------------------------
   NORMALIZE CONTACT
------------------------------------------------------- */
export function normalizeContact(raw) {
  console.log("%c[contacts] normalizeContact()", "color: #9b59b6", raw);

  if (!raw) return {};

  const safe = (v, fallback = "") =>
    v === null || v === undefined || v === "null" ? fallback : String(v);

  // Avatar
  let avatar;
  if (raw.avatar) {
    if (raw.avatar.startsWith("http")) avatar = raw.avatar;
    else if (raw.avatar.startsWith("/uploads")) avatar = BACKEND_BASE + raw.avatar;
    else avatar = `${BACKEND_BASE}/uploads/avatars/${raw.avatar}`;
  } else avatar = "img/defaultUser.png";

  // Banner
  let banner;
  if (raw.banner) {
    if (raw.banner.startsWith("http")) banner = raw.banner;
    else if (raw.banner.startsWith("/uploads")) banner = BACKEND_BASE + raw.banner;
    else banner = `${BACKEND_BASE}/uploads/banners/${raw.banner}`;
  } else banner = "img/profile-banner.jpg";

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

  window.UserCache[user.contact_id] = {
    ...(window.UserCache[user.contact_id] || {}),
    ...user
  };

  return user;
}

/* -------------------------------------------------------
   UPDATE CONTACT STATUS (ONLINE/OFFLINE)
------------------------------------------------------- */
export function updateContactStatus(contactId, online) {
  const id = String(contactId);

  if (window.UserCache[id]) {
    window.UserCache[id].online = online;
  }

  const card = document.querySelector(
    `.contact-card[data-contact-id="${id}"]`
  );

  if (!card) return;

  const status = card.querySelector(".contact-status");
  if (status) {
    status.classList.toggle("online", online);
    status.classList.toggle("offline", !online);
  }
}

/* -------------------------------------------------------
   RENDER CONTACT CARD
------------------------------------------------------- */
export function renderContactCard(user) {
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
    <div class="avatar-wrapper1">
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
    openFullProfile(user);
  });

  // Chat
  li.querySelector(".chat-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openMessagesFor(user);
    selectCard(li);
  });

  // Block
  li.querySelector(".block-btn")?.addEventListener("click", async (e) => {
    e.stopPropagation();

    const data = await postJson(
      `${BACKEND_BASE}/api/contacts/block`,
      { contact_id: user.contact_id }
    );

    if (data?.success) loadContacts();
  });

  // Delete
  li.querySelector(".delete-btn")?.addEventListener("click", async (e) => {
    e.stopPropagation();

    if (!confirm(`Delete ${user.contact_name}?`)) return;

    const data = await postJson(
      `${BACKEND_BASE}/api/contacts/delete`,
      { contact_id: user.contact_id }
    );

    if (data?.success) loadContacts();
  });

  return li;
}

/* -------------------------------------------------------
   RENDER CONTACT LIST
------------------------------------------------------- */
export function renderContactList(users) {
  const list = $id("contacts");
  if (!list) return;

  list.innerHTML = "";
  users.forEach((u) => list.appendChild(renderContactCard(u)));
}

/* -------------------------------------------------------
   LOAD CONTACTS
------------------------------------------------------- */
export async function loadContacts() {
  const url = `${BACKEND_BASE}/api/contacts`;
  const data = await getJson(url);

  if (!data?.contacts) return;

  const contacts = data.contacts.map((c) => normalizeContact(c));
  renderContactList(contacts);

  // Blocked list
  const blockedList = $id("blocked-contacts");
  if (blockedList) {
    blockedList.innerHTML = "";
    (data.blocked || [])
      .map((c) => normalizeContact(c))
      .forEach((c) => blockedList.appendChild(renderBlockedCard(c)));
  }

  setContactLookup(contacts);
  socket.emit("presence:get", { userId: getMyUserId() });
}

/* -------------------------------------------------------
   BLOCKED CARD
------------------------------------------------------- */
export function renderBlockedCard(user) {
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
    const data = await postJson(
      `${BACKEND_BASE}/api/contacts/unblock`,
      { contact_id: user.contact_id }
    );

    if (data?.success) loadContacts();
  });

  return li;
}

/* -------------------------------------------------------
   OPEN MESSAGES (NEW FLOATING PANEL)
------------------------------------------------------- */
export function openMessagesFor(user) {
  userNames[String(user.contact_id)] = user.contact_name;

  activeContact = user;
  window.currentChatUserId = user.contact_id;

  setReceiver(user.contact_id);

  const header = $id("msgHeaderName");
  if (header) header.textContent = user.contact_name;

  const panel = $id("messaging_box");
  if (panel) {
    panel.style.display = "flex";
    panel.classList.remove("hidden");
  }

  const bubble = $id("miniChatBubble");
  if (bubble) bubble.style.display = "none";

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
  const w = $id("fullProfileWebsite");
  if (user.contact_website) {
    w.textContent = user.contact_website;
    w.href = user.contact_website.startsWith("http")
      ? user.contact_website
      : "https://" + user.contact_website;
  } else {
    w.textContent = "None";
    w.removeAttribute("href");
  }

  // Twitter
  const t = $id("fullProfileTwitter");
  if (user.contact_twitter) {
    t.textContent = user.contact_twitter;
    t.href = "https://twitter.com/" + user.contact_twitter.replace("@", "");
  } else {
    t.textContent = "None";
    t.removeAttribute("href");
  }

  // Instagram
  const i = $id("fullProfileInstagram");
  if (user.contact_instagram) {
    i.textContent = user.contact_instagram;
    i.href = "https://instagram.com/" + user.contact_instagram.replace("@", "");
  } else {
    i.textContent = "None";
    i.removeAttribute("href");
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

  // Save lookup contact
  const saveBtn = $id("saveLookupContact");
  if (saveBtn) {
    if (user.fromLookup) {
      saveBtn.style.display = "block";
      saveBtn.onclick = () => window.saveLookupContact(user.contact_id);
    } else {
      saveBtn.style.display = "none";
      saveBtn.onclick = null;
    }
  }
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
    `${BACKEND_BASE}/api/users/search?query=${encodeURIComponent(query)}`
  )
    .then((data) => {
      lookupResults.innerHTML = "";

      if (data?.success && Array.isArray(data.users) && data.users.length) {
        data.users.forEach((u) => {
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

/* -------------------------------------------------------
   SAVE LOOKUP CONTACT
------------------------------------------------------- */
window.saveLookupContact = async function (contactId) {
  const data = await postJson(
    `${BACKEND_BASE}/api/contacts/add`,
    { contact_id: contactId }
  );

  if (data?.success) {
    loadContacts();
    const modal = $id("fullProfileModal");
    if (modal) modal.classList.remove("open");
  }
};

/* -------------------------------------------------------
   UPDATE LOCAL CONTACT — FULL UI SYNC
------------------------------------------------------- */
window.updateLocalContact = function (contactId, updates) {
  const id = String(contactId);

  if (id === String(getMyUserId())) return;

  const contact = window.UserCache[id];
  if (!contact) return;

  Object.assign(contact, updates);

  /* -------------------------------------------------------
     1. CONTACT LIST
  ------------------------------------------------------- */
  const card = document.querySelector(`.contact-card[data-contact-id="${id}"]`);
  if (card) {
    if (updates.contact_name) {
      const el = card.querySelector(".contact-name");
      if (el) el.textContent = updates.contact_name;
    }

    if (updates.contact_email) {
      const el = card.querySelector(".contact-email");
      if (el) el.textContent = updates.contact_email;
    }

    if (updates.contact_avatar || updates.avatar) {
      const el = card.querySelector(".contact-avatar");
      if (el) el.src = updates.contact_avatar || updates.avatar;
    }

    if (updates.contact_bio) {
      const el = card.querySelector(".contact-last");
      if (el) el.textContent = updates.contact_bio;
    }
  }

  /* -------------------------------------------------------
     2. LOOKUP CARDS
  ------------------------------------------------------- */
  document.querySelectorAll(`.lookup-card[data-id="${id}"]`).forEach((lc) => {
    if (updates.contact_name) {
      const el = lc.querySelector(".lookup-name");
      if (el) el.textContent = updates.contact_name;
    }

    if (updates.contact_email) {
      const el = lc.querySelector(".lookup-email");
      if (el) el.textContent = updates.contact_email;
    }

    if (updates.contact_avatar || updates.avatar) {
      const el = lc.querySelector(".lookup-avatar img");
      if (el) el.src = updates.contact_avatar || updates.avatar;
    }
  });

  /* -------------------------------------------------------
     3. BLOCKED LIST CARDS
  ------------------------------------------------------- */
  document.querySelectorAll(`.blocked-card[data-user-id="${id}"]`).forEach((bc) => {
    if (updates.contact_name) {
      const el = bc.querySelector(".blocked-name");
      if (el) el.textContent = updates.contact_name;
    }

    if (updates.contact_email) {
      const el = bc.querySelector(".blocked-email");
      if (el) el.textContent = updates.contact_email;
    }

    if (updates.contact_avatar || updates.avatar) {
      const el = bc.querySelector(".blocked-avatar img");
      if (el) el.src = updates.contact_avatar || updates.avatar;
    }
  });

  /* -------------------------------------------------------
     4. FULL PROFILE MODAL (if open)
  ------------------------------------------------------- */
  const modal = document.getElementById("fullProfileModal");
  if (modal && modal.classList.contains("open") && openProfileUserId === id) {
    if (updates.contact_name) {
      const el = document.getElementById("fullProfileName");
      if (el) el.textContent = updates.contact_name;
    }

    if (updates.contact_email) {
      const el = document.getElementById("fullProfileEmail");
      if (el) el.textContent = updates.contact_email;
    }

    if (updates.contact_phone) {
      const el = document.getElementById("fullProfilePhone");
      if (el) el.textContent = updates.contact_phone;
    }

    if (updates.contact_bio) {
      const el = document.getElementById("fullProfileBio");
      if (el) el.textContent = updates.contact_bio;
    }

    if (updates.contact_avatar || updates.avatar) {
      const el = document.getElementById("fullProfileAvatar");
      if (el) el.src = updates.contact_avatar || updates.avatar;
    }

    if (updates.contact_banner) {
      const el = document.getElementById("fullProfileBanner");
      if (el) el.src = updates.contact_banner;
    }
  }

  /* -------------------------------------------------------
     5. MESSAGING HEADER (if chatting with this user)
  ------------------------------------------------------- */
  if (window.currentChatUserId === id) {
    if (updates.contact_name) {
      const el = document.getElementById("msgHeaderName");
      if (el) el.textContent = updates.contact_name;
    }

    if (updates.contact_avatar || updates.avatar) {
      const el = document.getElementById("msgHeaderAvatar");
      if (el) el.src = updates.contact_avatar || updates.avatar;
    }
  }
};


















































