// public/js/reactions.js

import { getMyUserId() } from "./session.js";

const DEFAULT_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

/**
 * Attach event delegation for reaction buttons.
 * Should be called once from messaging.js after DOM ready.
 */
export function initReactions(socket) {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".reaction-btn");
    if (!btn) return;

    const msgEl = btn.closest(".message");
    if (!msgEl) return;

    const messageId = msgEl.dataset.messageId;
    if (!messageId) return;

    // For now: simple cycle picker via prompt or inline menu
    const emoji = prompt(
      "React with emoji (or leave empty to remove):",
      DEFAULT_EMOJIS[0]
    );
    if (!emoji) {
      socket.emit("message:reaction", {
        messageId,
        from: getMyUserId(),
        emoji: null
      });
      return;
    }

    socket.emit("message:reaction", {
      messageId,
      from: getMyUserId(),
      emoji
    });
  });

  // Handle incoming reaction updates
  socket.on("message:reaction", (data) => {
    applyReactionToMessage(data);
  });
}

/**
 * Update the DOM for a reaction event.
 * data: { messageId, from, emoji }
 */
export function applyReactionToMessage({ messageId, from, emoji }) {
  const msgEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
  if (!msgEl) return;

  const reactionsEl =
    msgEl.querySelector(".message-reactions") ||
    createReactionsStrip(msgEl);

  const userKey = `u${from}`;

  // We store reactions in dataset as JSON: { u123: "👍", u456: "❤️" }
  let map = {};
  try {
    map = JSON.parse(reactionsEl.dataset.reactions || "{}");
  } catch {
    map = {};
  }

  if (!emoji) {
    delete map[userKey];
  } else {
    map[userKey] = emoji;
  }

  reactionsEl.dataset.reactions = JSON.stringify(map);
  renderReactionsStrip(reactionsEl, map);
}

function createReactionsStrip(msgEl) {
  const div = document.createElement("div");
  div.className = "message-reactions";
  msgEl.appendChild(div);
  return div;
}

function renderReactionsStrip(container, map) {
  container.innerHTML = "";

  const counts = {};
  for (const key in map) {
    const emo = map[key];
    counts[emo] = (counts[emo] || 0) + 1;
  }

  Object.entries(counts).forEach(([emoji, count]) => {
    const span = document.createElement("span");
    span.className = "reaction-chip";
    span.textContent = count > 1 ? `${emoji} ${count}` : emoji;
    container.appendChild(span);
  });

  container.style.display = Object.keys(counts).length ? "inline-flex" : "none";
}
