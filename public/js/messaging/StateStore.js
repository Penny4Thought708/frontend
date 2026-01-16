// public/js/messaging/StateStore.js
import { getMyUserId, getMyFullname } from "../session.js";

export const store = {
  get myId() {
    return getMyUserId(); // always fresh
  },

  get myFullname() {
    return getMyFullname(); // always fresh
  },

  activeContactId: null,
  contacts: new Map(),
  messagesByUser: new Map(),
  unreadCounts: new Map(),
};

export function setActiveContact(contactId) {
  store.activeContactId = contactId;
}

export function cacheMessages(contactId, messages) {
  store.messagesByUser.set(contactId, messages);
}

export function appendMessage(contactId, message) {
  const arr = store.messagesByUser.get(contactId) || [];
  arr.push(message);
  store.messagesByUser.set(contactId, arr);
}

export function getMessages(contactId) {
  return store.messagesByUser.get(contactId) || [];
}

export function setContact(contactId, data) {
  store.contacts.set(contactId, data);
}

export function getContact(contactId) {
  return store.contacts.get(contactId) || null;
}

export function setUnread(contactId, count) {
  store.unreadCounts.set(contactId, count);
}

export function incUnread(contactId) {
  const curr = store.unreadCounts.get(contactId) || 0;
  store.unreadCounts.set(contactId, curr + 1);
}

export function clearUnread(contactId) {
  store.unreadCounts.set(contactId, 0);
}
