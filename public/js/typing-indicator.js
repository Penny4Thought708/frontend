// public/js/typing-indicator.js

import { getMyUserId } from "./session.js";

const typingIndicator = document.querySelector(".typing-indicator");
const typingAvatar = document.querySelector(".typing-indicator .typing-avatar");

let hideTimeout = null;

export function showTypingIndicator({ from, avatar }) {
  if (!typingIndicator) return;
  if (from === getMyUserId()) return;

  if (avatar && typingAvatar) {
    typingAvatar.src = avatar;
  }

  typingIndicator.style.display = "flex";

  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    hideTypingIndicator();
  }, 4000);
}

export function hideTypingIndicator() {
  if (!typingIndicator) return;
  typingIndicator.style.display = "none";
}

/**
 * Wire socket events for typing, called from messaging.js
 */
export function initTypingSocketHandlers(socket) {
  socket.on("typing:start", (data) => {
    showTypingIndicator(data);
  });

  socket.on("typing:stop", () => {
    hideTypingIndicator();
  });
}
