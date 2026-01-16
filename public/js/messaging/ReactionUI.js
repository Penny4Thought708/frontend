// public/js/messaging/ReactionUI.js
import { store } from "./StateStore.js";
export function updateReactionUI(payload) {
  const { message_id, reactions } = payload;

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


// Optional: attach click handlers for adding reactions
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

