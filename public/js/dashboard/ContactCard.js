// public/js/dashboard/ContactCard.js

import { setReceiver, loadMessages } from "../messaging.js";

/* -------------------------------------------------------
   Render Contact Card (FINAL VERSION)
------------------------------------------------------- */
export function renderContactCard(user, pendingPresence, updateContactStatus) {
  const li = document.createElement("li");
  li.className = "contact-card";
  li.dataset.contactId = String(user.contact_id);

  /* -------------------------------------------------------
     Avatar + Status
  ------------------------------------------------------- */
  const avatarWrapper = document.createElement("div");
  avatarWrapper.className = "avatar-wrapper";

  const avatar = document.createElement("img");
  avatar.className = "contact-avatar";
  avatar.src = user.contact_avatar;
  avatar.alt = "avatar";

  avatar.onerror = () => {
    avatar.src = "/img/defaultUser.png";
  };

  const status = document.createElement("span");
  status.className = "contact-status";
  status.classList.toggle("online", user.online);
  status.classList.toggle("offline", !user.online);

  avatarWrapper.append(avatar, status);

  /* -------------------------------------------------------
     Contact Info
  ------------------------------------------------------- */
  const info = document.createElement("div");
  info.className = "contact-info";

  const name = document.createElement("div");
  name.className = "contact-name";
  name.textContent = user.contact_name;

  const email = document.createElement("div");
  email.className = "contact-email";
  email.textContent = user.contact_email;

  const last = document.createElement("div");
  last.className = "contact-last";
  last.textContent =
    user.last_message?.text?.trim() ||
    (user.last_message?.file_url ? "[Attachment]" : "");

  info.append(name, email, last);

  /* -------------------------------------------------------
     Unread Badge
  ------------------------------------------------------- */
  let unreadBadge = null;
  if (user.unread_count > 0) {
    unreadBadge = document.createElement("span");
    unreadBadge.className = "unread-badge";
    unreadBadge.textContent = user.unread_count;
  }

  /* -------------------------------------------------------
     Actions (Info / Chat / Block / Delete)
  ------------------------------------------------------- */
  const actions = document.createElement("div");
  actions.className = "contact-actions";

  const infoBtn = document.createElement("button");
  infoBtn.className = "info-btn";
  infoBtn.textContent = "ℹ️";

  infoBtn.onclick = (e) => {
    e.stopPropagation();
    window.openFullProfile?.(user);
  };

  const chatBtn = document.createElement("button");
  chatBtn.className = "chat-btn";
  chatBtn.textContent = "💬";

  chatBtn.onclick = async (e) => {
    e.stopPropagation();

    window.activeContact = user;
    window.receiver_id = user.contact_id;

    document.getElementById("messaging_box")?.classList.add("active");

    const header = document.querySelector(".header_msg_box h2");
    if (header) header.textContent = user.contact_name;

    setReceiver(user.contact_id);
    await loadMessages();

    document
      .querySelectorAll(".contact-card.selected")
      .forEach((c) => c.classList.remove("selected"));
    li.classList.add("selected");
  };

  const blockBtn = document.createElement("button");
  blockBtn.className = "block-btn";
  blockBtn.textContent = "🚫";

  blockBtn.onclick = async (e) => {
    e.stopPropagation();
    await fetch("https://letsee-backend.onrender.com/api/contacts/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: user.contact_id }),
    });
    window.loadContacts?.();
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "🗑";

  deleteBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${user.contact_name}?`)) return;

    await fetch("https://letsee-backend.onrender.com/api/contacts/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: user.contact_id }),
    });

    window.loadContacts?.();
  };

  actions.append(infoBtn, chatBtn, blockBtn, deleteBtn);

  /* -------------------------------------------------------
     Assemble Card
  ------------------------------------------------------- */
  li.append(avatarWrapper, info);
  if (unreadBadge) li.append(unreadBadge);
  li.append(actions);

  /* -------------------------------------------------------
     Apply Buffered Presence
  ------------------------------------------------------- */
  const buffered = pendingPresence.get(String(user.contact_id));
  if (typeof buffered === "boolean") {
    updateContactStatus(String(user.contact_id), buffered);
    pendingPresence.delete(String(user.contact_id));
  }

  return li;
}





