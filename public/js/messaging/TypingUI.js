// public/js/messaging/TypingUI.js

// The typing indicator element in your DOM
const typingIndicator = document.querySelector(".typing-indicator");

// Timeout handler so the indicator auto-hides
let typingTimeout = null;

/**
 * Show the typing indicator.
 * Called by MessagingEngine when it receives "typing:start".
 *
 * @param {string} fromName - The name of the user who is typing.
 */
export function showTyping(fromName = "Contact") {
  if (!typingIndicator) return;

  typingIndicator.textContent = `${fromName} is typing...`;
  typingIndicator.style.display = "block";

  // Reset auto-hide timer
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingIndicator.style.display = "none";
  }, 2000);
}

/**
 * Hide the typing indicator.
 * Called by MessagingEngine when it receives "typing:stop".
 */
export function hideTyping() {
  if (!typingIndicator) return;
  typingIndicator.style.display = "none";
}


