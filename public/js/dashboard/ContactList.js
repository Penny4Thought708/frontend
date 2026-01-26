// public/js/dashboard/ContactList.js

import { renderContactCard } from "./ContactCard.js";

/* -------------------------------------------------------
   Render Contact List (FINAL VERSION)
------------------------------------------------------- */
export function renderContactList(
  users,
  pendingPresence,
  updateContactStatus
) {
  const list = document.getElementById("contacts"); // FIXED
  if (!list) return;

  list.innerHTML = "";

  if (!Array.isArray(users) || users.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-contacts";
    empty.textContent = "No contacts found";
    list.appendChild(empty);
    return;
  }

  users.forEach((user) => {
    const card = renderContactCard(
      user,
      pendingPresence,
      updateContactStatus
    );
    list.appendChild(card);
  });
}




