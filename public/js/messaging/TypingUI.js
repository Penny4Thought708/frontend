// public/js/messaging/TypingUI.js
import { msgInput } from "../session.js";
import { store } from "./StateStore.js";

const typingIndicator = document.querySelector(".typing-indicator");
let typingTimeout = null;

function showTyping(fromName) {
  if (!typingIndicator) return;
  typingIndicator.textContent = `${fromName} is typing...`;
  typingIndicator.style.display = "block";

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingIndicator.style.display = "none";
  }, 2000);
}

// Emit typing events
if (msgInput && typeof socket !== "undefined") {
  msgInput.addEventListener("input", () => {
    if (!store.activeContactId) return;
    socket.emit("typing", {
      to: store.activeContactId,
      from: store.myId,
    });
  });
}

// Listen for typing events
if (typeof socket !== "undefined") {
  socket.on("typing", (data) => {
    if (!typingIndicator) return;
    if (data.to !== store.myId) return;
    showTyping(data.fromName || "Contact");
  });
}
