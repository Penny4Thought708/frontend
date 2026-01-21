// public/js/messaging/ReactionUI.js

/**
 * Update the reaction row for a specific message.
 * Called by MessagingEngine when it receives "message:reactions".
 *
 * @param {Object} payload
 * @param {number} payload.message_id
 * @param {Array<{emoji: string, count: number}>} payload.reactions
 */
export function updateReactions(payload) {
  const { message_id, reactions } = payload;

  // Find the reaction container for this message
  const container = document.querySelector(
    `.msg-reactions[data-msg-id="${message_id}"]`
  );
  if (!container) return;

  // Hide if empty
  if (!reactions || reactions.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  // Show container
  container.style.display = "flex";

  // Reset content
  container.innerHTML = "";

  // Render each reaction pill
  reactions.forEach((r) => {
    const span = document.createElement("span");
    span.className = "reaction-pill";
    span.textContent = `${r.emoji} ${r.count ?? ""}`.trim();
    container.appendChild(span);
  });

  // ⭐ POP ANIMATION RESET ⭐
  container.classList.remove("reaction-pop");
  void container.offsetWidth; // force reflow
  container.classList.add("reaction-pop");
}

/**
 * Optional helper to attach reaction click handlers.
 * MessagingEngine can pass its toggleReaction() method here.
 */
export function initReactionClickHandlers(onToggleReaction) {
  document.addEventListener("click", (evt) => {
    const bubble = evt.target.closest(".msg-bubble");
    if (!bubble) return;

    const msgId = bubble.dataset.msgId;
    if (!msgId) return;

    // Example: right-click to toggle 👍
    if (evt.type === "contextmenu") {
      evt.preventDefault();
      onToggleReaction(Number(msgId), "👍");
    }
  });
}



