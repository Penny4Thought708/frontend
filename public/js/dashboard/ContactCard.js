// public/js/dashboard/ContactCard.js

import { setReceiver, loadMessages } from "../messaging.js";

export function renderContactCard(user, pendingPresence, updateContactStatus) {
  const li = document.createElement("li");
  li.className = "contact-card";
  li.dataset.contactId = String(user.contact_id);

  /* -------------------------------------------------------
     Status Dot
  ------------------------------------------------------- */
  const status = document.createElement("span");
  status.className = "contact-status";
  status.style.backgroundColor = user.online ? "green" : "gray";

  /* -------------------------------------------------------
     Contact Name
  ------------------------------------------------------- */
  const name = document.createElement("span");
  name.className = "contact-name";
  name.textContent = `${user.contact_name} (${user.contact_email})`;

  name.addEventListener("click", () => {
    window.activeContact = user;
    window.receiver_id = user.contact_id;

    // Update header
    const header = document.querySelector(".header_msg_box h2");
    if (header) header.textContent = user.contact_name;

    // Highlight selected contact
    document
      .querySelectorAll(".contact-card.selected")
      .forEach((c) => c.classList.remove("selected"));
    li.classList.add("selected");
  });

  li.append(status, name);

  /* -------------------------------------------------------
     Actions (Chat / Block / Delete)
  ------------------------------------------------------- */
  const actions = document.createElement("div");
  actions.className = "contact-actions";

  // ✅ CHAT BUTTON
  const chatBtn = document.createElement("button");
  chatBtn.textContent = "💬 Chat";

  chatBtn.addEventListener("click", async () => {
    window.activeContact = user;
    window.receiver_id = user.contact_id;

    // ✅ Open messaging panel
    document.getElementById("messaging_box")?.classList.add("active");

    // ✅ Update header name
    const header = document.querySelector(".header_msg_box h2");
    if (header) header.textContent = user.contact_name;

    // ✅ Tell messaging.js who the receiver is
    setReceiver(user.contact_id);

    // ✅ Load messages into .message_win1
    await loadMessages();
  });

  // BLOCK BUTTON
  const blockBtn = document.createElement("button");
  blockBtn.textContent = "🚫 Block";
  blockBtn.addEventListener("click", () => blockContact(user.contact_id));

  // DELETE BUTTON
  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "🗑 Delete";
  deleteBtn.addEventListener("click", () => deleteContact(user.contact_id));

  actions.append(chatBtn, blockBtn, deleteBtn);
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

/* -------------------------------------------------------
   Contact Actions
------------------------------------------------------- */

async function blockContact(contact_id) {
  const res = await fetch("https://letsee-backend.onrender.com/letsee/api/api/contacts/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id }),
  });

  const data = await res.json();
  if (data.success) alert("Contact blocked");
}


async function deleteContact(contact_id) {
  if (!confirm("Delete this contact")) return;

  const res = await fetch("https://letsee-backend.onrender.com/letsee/api/api/contacts/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id }),
  });

  const data = await res.json();
  if (data.success) alert("Contact deleted");
}


