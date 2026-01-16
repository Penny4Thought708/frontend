// public/js/dashboard/ContactList.js

import { renderContactCard } from "./ContactCard.js";

export function renderContactList(users, pendingPresence, updateContactStatus, loadMessages) {
  const list = document.getElementById("contact_list");
  list.innerHTML = "";

  users.forEach(user => {
    const card = renderContactCard(user, pendingPresence, updateContactStatus, loadMessages);
    list.appendChild(card);
  });
}
