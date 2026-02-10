// public/js/messaging.js
// -------------------------------------------------------
// Messaging System (NO PHP, Node backend, FULL LOGGING + UI ENHANCEMENTS)

// =======================================================
// UI ENHANCEMENT HOOKS ADDED:
// - Empty state logic
// - New message bubble
// - Typing indicator upgrade
// - Recording indicator
// - WhatsApp-style bubbles
// - iMessage spring physics
// - Smooth fade-in animations
// - Reaction hover animation
// - Voice waveform UI hooks
// - Unread badge hooks
// =======================================================

import {
  getMyUserId,
  messageWin,
  msgForm,
  msgInput,
  badge,
  messageBox,
  attachmentInput,
  attachmentBtn,
  previewDiv,
  safeJSON,
  playNotification,
} from "./session.js";

import { socket } from "./socket.js";
import { userNames, userAvatars } from "./shared/user-cache.js";

// ===== CONFIG =====
const MESSAGES_API_BASE = "https://letsee-backend.onrender.com/api/messages";
console.log("[messaging] Loaded messaging.js");

// ===== STATE =====
let receiver_id = null;
let lastSeenMessageId = 0;
let lastLoadedMessages = [];
let readObserver = null;
const previewEl = previewDiv;

// ===== UI ELEMENTS ADDED =====
const emptyStateEl = document.getElementById("messageEmptyState");
const newMessagesPill = document.getElementById("newMessagesPill");
const typingIndicator = document.querySelector(".typing-indicator");
const recordingIndicator = document.querySelector(".recording-indicator");

// Make sure emoji/GIF pickers start hidden
const emojiPicker = document.getElementById("emojiPicker");
const gifPicker = document.getElementById("gifPicker");
if (emojiPicker) emojiPicker.classList.remove("active");
if (gifPicker && !gifPicker.classList.contains("hidden")) {
  gifPicker.classList.add("hidden");
}

// ===== UI HELPERS =====
function showEmptyState() {
  if (!emptyStateEl || !messageWin) return;
  messageWin.innerHTML = "";
  emptyStateEl.classList.remove("hidden");
}

function hideEmptyState() {
  if (!emptyStateEl) return;
  emptyStateEl.classList.add("hidden");
}

function showNewMessagePill() {
  if (!newMessagesPill) return;
  newMessagesPill.classList.remove("hidden");
  requestAnimationFrame(() => newMessagesPill.classList.add("show"));
}

function hideNewMessagePill() {
  if (!newMessagesPill) return;
  newMessagesPill.classList.remove("show");
  setTimeout(() => newMessagesPill.classList.add("hidden"), 200);
}

newMessagesPill?.addEventListener("click", () => {
  if (!messageWin) return;
  messageWin.scrollTo({ top: messageWin.scrollHeight, behavior: "smooth" });
  hideNewMessagePill();
});

// ===== RTC ACCESSORS =====
function getDataChannel() {
  return typeof window !== "undefined" ? window.dataChannel : undefined;
}
function getPeerId() {
  return typeof window !== "undefined" ? window.peerId : undefined;
}
function isChannelOpen(dc) {
  return !!dc && dc.readyState === "open";
}

/* -------------------------------------------------------
   Receiver Setter
------------------------------------------------------- */

export function setReceiver(id) {
  receiver_id = id;
  if (typeof window !== "undefined") {
    window.receiver_id = id;
    window.currentReceiverId = id;
  }
  console.log("[messaging] Receiver set:", receiver_id);

  // Reset UI state
  hideNewMessagePill();
  hideEmptyState();
  if (messageWin) messageWin.innerHTML = "";
  if (typingIndicator) {
    typingIndicator.classList.remove("active");
    typingIndicator.textContent = "";
  }
  if (recordingIndicator) recordingIndicator.classList.remove("active");
  lastSeenMessageId = 0;
  lastLoadedMessages = [];

  // Load thread
  loadMessages().catch((err) =>
    console.error("[messaging] loadMessages after setReceiver failed:", err)
  );
}

export function getReceiver() {
  return receiver_id;
}

function showError(msg) {
  console.error("[messaging] ERROR:", msg);
  if (badge) {
    badge.textContent = "!";
    badge.style.display = "inline-block";
  }
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

function smartScroll() {
  if (!messageWin) return;
  const nearBottom =
    messageWin.scrollHeight -
      messageWin.scrollTop -
      messageWin.clientHeight <
    80;

  if (nearBottom) {
    messageWin.scrollTop = messageWin.scrollHeight;
    hideNewMessagePill();
  }
}

// ===== NETWORK HELPERS =====
async function apiGet(path) {
  const url = `${MESSAGES_API_BASE}${path}`;
  console.log("[messaging] GET:", url);

  try {
    const res = await fetch(url, { method: "GET", credentials: "include" });
    const text = await res.text();
    console.log("[messaging] GET response:", text);
    return JSON.parse(text);
  } catch (err) {
    console.error("[messaging] GET failed:", err);
    throw err;
  }
}

async function apiPost(path, body) {
  const url = `${MESSAGES_API_BASE}${path}`;
  console.log("[messaging] POST:", url, "BODY:", body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body || {}),
    });

    const text = await res.text();
    console.log("[messaging] POST response:", text);
    return JSON.parse(text);
  } catch (err) {
    console.error("[messaging] POST failed:", err);
    throw err;
  }
}

// ===== FILE RENDERING HELPER =====
function appendFileContentToParagraph(p, options) {
  const { name, url, comment = "" } = options;

  const src = url;
  if (!src) {
    console.warn("[messaging] Missing file URL/data for:", name);
    return;
  }

  if (/\.(png|jpe?g|gif|webp)$/i.test(name || "")) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = name;
    img.style.maxWidth = "200px";
    img.style.display = "block";
    img.loading = "lazy";
    p.appendChild(img);

    const caption = document.createElement("span");
    caption.textContent = name;
    caption.className = "file-caption";
    p.appendChild(caption);

    img.onclick = () => {
      const viewer = document.getElementById("img-viewer");
      const viewerImg = document.getElementById("img-viewer-img");
      if (viewer && viewerImg) {
        viewerImg.src = img.src;
        viewer.style.display = "flex";
      }
    };
  } else {
    const a = document.createElement("a");
    a.href = src;
    a.download = name;
    a.textContent = name;
    a.target = "_blank";
    p.appendChild(a);
  }

  if (comment) {
    const cmt = document.createElement("div");
    cmt.className = "file-comment";
    cmt.textContent = comment;
    p.appendChild(cmt);
  }
}

// Close full-screen viewer when clicking overlay
document.getElementById("img-viewer")?.addEventListener("click", () => {
  const viewer = document.getElementById("img-viewer");
  if (viewer) viewer.style.display = "none";
});

// ===== DELETE MESSAGE =====
async function deleteMessage(messageId) {
  console.log("[messaging] deleteMessage:", messageId);

  if (!messageId) {
    console.error("[messaging] deleteMessage missing ID");
    return;
  }

  const el = document.querySelector(`[data-msg-id="${String(messageId)}"]`);
  if (el) el.remove();

  try {
    await apiPost("/delete", { id: messageId });
    console.log("[messaging] deleteMessage success");
  } catch (err) {
    console.error("[messaging] deleteMessage failed:", err);
  }
}

// ===== REACTIONS =====
function addReactionToMessage(id, emoji) {
  console.log("[messaging] addReaction:", id, emoji);

  const container = document.querySelector(
    `[data-msg-id="${id}"] .reaction-display`
  );
  if (!container) {
    console.warn("[messaging] reaction container missing");
    return;
  }

  let bubble = container.querySelector(`[data-emoji="${emoji}"]`);

  if (bubble) {
    const countEl = bubble.querySelector(".react-count");
    const current = parseInt(countEl.textContent, 10) || 1;
    countEl.textContent = current + 1;
  } else {
    bubble = document.createElement("span");
    bubble.className = "reaction-bubble pop";
    bubble.dataset.emoji = emoji;
    bubble.innerHTML = `
      <span class="emoji-safe">${emoji}</span>
      <span class="react-count">1</span>
    `;
    container.appendChild(bubble);

    // Hover animation
    bubble.addEventListener("mouseenter", () =>
      bubble.classList.add("hover")
    );
    bubble.addEventListener("mouseleave", () =>
      bubble.classList.remove("hover")
    );

    setTimeout(() => bubble.classList.remove("pop"), 250);
  }
}

function removeReactionFromMessage(id, emoji) {
  console.log("[messaging] removeReaction:", id, emoji);

  const container = document.querySelector(
    `[data-msg-id="${id}"] .reaction-display`
  );
  if (!container) return;

  const bubble = container.querySelector(`[data-emoji="${emoji}"]`);
  if (!bubble) return;

  const countEl = bubble.querySelector(".react-count");
  const current = parseInt(countEl.textContent, 10);

  if (current > 1) {
    countEl.textContent = current - 1;
  } else {
    bubble.remove();
  }
}

// Live reaction updates from backend
socket.on("message:reaction:update", ({ messageId, emoji, action }) => {
  if (!messageId || !emoji || !action) return;
  if (action === "added") {
    addReactionToMessage(messageId, emoji);
  } else if (action === "removed") {
    removeReactionFromMessage(messageId, emoji);
  }
});

// ===== RENDER MESSAGE (NEW LAYOUT + ANIMATIONS) =====
function renderMessage(msg) {
  console.log("[messaging] renderMessage:", msg);

  if (!messageWin) {
    console.error("[messaging] messageWin missing");
    return;
  }

  hideEmptyState();

  const isFileMessage =
    msg.type === "file" ||
    msg.file ||
    /^File:/i.test(msg.message || "");

  // ===== Outer wrapper =====
  const wrapper = document.createElement("div");
  wrapper.className =
    msg.is_me ? "msg-wrapper sender_msg" : "msg-wrapper receiver_msg";

  // WhatsApp-style bubble shape
  wrapper.classList.add("bubble-style");

  // iMessage spring physics
  wrapper.style.animation = "msgPop 0.25s cubic-bezier(.17,.89,.32,1.49)";

  // Smooth fade-in
  wrapper.style.opacity = "0";
  requestAnimationFrame(() => {
    wrapper.style.transition = "opacity 0.25s ease";
    wrapper.style.opacity = "1";
  });

  if (msg.id != null) wrapper.dataset.msgId = String(msg.id);
  if (!msg.is_me && msg.sender_id)
    wrapper.dataset.senderId = String(msg.sender_id);

  // ===== Sender name (only for received messages) =====
  if (!msg.is_me) {
    const nameEl = document.createElement("div");
    nameEl.className = "msg-sender-name";
    nameEl.textContent =
      msg.sender_name ||
      userNames[String(msg.sender_id)] ||
      "Unknown";
    wrapper.appendChild(nameEl);
  }

  // ===== Bubble =====
  const bubble = document.createElement("p");
  bubble.className = "msg-bubble-text";
  wrapper.appendChild(bubble);

  // ===== File or Text =====
  if (isFileMessage) {
    const name =
      msg.name ||
      msg.filename ||
      (msg.message || "").replace(/^File:\s*/, "");

    const fileUrl = msg.url || msg.file_url || msg.data || null;

    appendFileContentToParagraph(bubble, {
      name,
      url: fileUrl,
      comment: msg.comment,
    });
  } else {
    bubble.textContent = msg.message ?? "";

    // ===== Inline editing for your messages =====
    if (msg.is_me && msg.id) {
      bubble.ondblclick = () => {
        console.log("[messaging] edit dblclick:", msg.id);

        const original = msg.message ?? "";
        const input = document.createElement("input");
        input.type = "text";
        input.value = original;
        input.className = "edit-input";

        bubble.innerHTML = "";
        bubble.appendChild(input);
        input.focus();

        input.onkeydown = async (e) => {
          if (e.key === "Escape") {
            bubble.textContent = original;
          }
          if (e.key === "Enter") {
            const newText = input.value.trim();
            if (!newText || newText === original) {
              bubble.textContent = original;
              return;
            }

            bubble.textContent = newText;

            try {
              const res = await apiPost("/edit", {
                id: msg.id,
                message: newText,
              });
              console.log("[messaging] edit success:", res);
            } catch (err) {
              console.error("[messaging] edit failed:", err);
            }
          }
        };
      };
    }
  }

  // ===== Reaction display container =====
  const reactionDisplay = document.createElement("div");
  reactionDisplay.className = "reaction-display";
  wrapper.appendChild(reactionDisplay);

  // ===== Reaction bar =====
  const reactionBar = document.createElement("div");
  reactionBar.className = "reaction-bar";
  reactionBar.innerHTML = `
    <span class="react-emoji">👍</span>
    <span class="react-emoji">❤️</span>
    <span class="react-emoji">😂</span>
    <span class="react-emoji">😮</span>
    <span class="react-emoji">😢</span>
  `;
  wrapper.appendChild(reactionBar);

  reactionBar.addEventListener("click", (e) => {
    const emoji = e.target.closest(".react-emoji")?.textContent;
    if (!emoji || !msg.id) return;

    console.log("[messaging] reaction clicked:", emoji, "msg:", msg.id);

    socket.emit("message:reaction", {
      messageId: msg.id,
      emoji,
    });

    // Optimistic update; backend will sync via message:reaction:update
    addReactionToMessage(msg.id, emoji);
  });

  // ===== Meta (timestamp + delete) =====
  const ts =
    msg.created_at instanceof Date
      ? msg.created_at
      : new Date(msg.created_at || Date.now());

  const small = document.createElement("small");
  small.textContent = ts.toLocaleString();

  const statusSpan = document.createElement("span");
  statusSpan.className = "status-flags";

  if (msg.id) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-msg";
    del.textContent = "🗑";
    del.addEventListener("click", () => deleteMessage(msg.id));
    statusSpan.appendChild(del);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.appendChild(small);
  meta.appendChild(statusSpan);
  wrapper.appendChild(meta);

  // ===== Append to DOM =====
  messageWin.appendChild(wrapper);
  smartScroll();
  observeMessagesForRead();
}

// ===== FILE PREVIEW =====
function renderPreviews(files) {
  console.log("[messaging] renderPreviews:", files);

  if (!previewEl) return;
  previewEl.innerHTML = "";

  files.forEach((file) => {
    const wrapper = document.createElement("div");
    wrapper.className = "preview-wrapper";

    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      const objUrl = URL.createObjectURL(file);
      img.src = objUrl;
      img.alt = file.name;
      img.style.maxWidth = "100px";
      img.style.maxHeight = "100px";
      img.onload = () => URL.revokeObjectURL(objUrl);
      wrapper.appendChild(img);
    } else {
      const link = document.createElement("a");
      const objUrl = URL.createObjectURL(file);
      link.href = objUrl;
      link.download = file.name;
      link.textContent = file.name;
      wrapper.appendChild(link);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✖";
    removeBtn.className = "remove-preview";
    removeBtn.onclick = () => {
      console.log("[messaging] removePreview:", file.name);

      const current = Array.from(attachmentInput.files || []);
      const newFiles = current.filter((f) => f !== file);
      const dt = new DataTransfer();
      newFiles.forEach((f) => dt.items.add(f));
      attachmentInput.files = dt.files;
      renderPreviews(newFiles);
    };
    wrapper.appendChild(removeBtn);

    previewEl.appendChild(wrapper);
  });
}

// ===== Receiving messages via DataChannel (text + files) =====
export function setupDataChannel(channel) {
  console.log("[messaging] setupDataChannel called");

  if (!channel) {
    console.error("[messaging] setupDataChannel: no channel");
    return;
  }

  if (typeof window !== "undefined") window.dataChannel = channel;

  channel.onmessage = async (e) => {
    console.log("[messaging] DataChannel message:", e.data);

    let payload = e.data;

    if (typeof e.data === "string") {
      try {
        payload = JSON.parse(e.data);
      } catch {
        console.warn("[messaging] DataChannel payload not JSON");
        payload = e.data;
      }
    }

    playNotification();
    const myUserId = getMyUserId();

    // FILE
    if (payload && payload.type === "file") {
      console.log("[messaging] Incoming P2P file:", payload);

      const unified = {
        id: null,
        type: "file",
        name: payload.name,
        url: payload.url || null,
        data: payload.data || null,
        comment: payload.comment || "",
        sender_id: getPeerId(),
        sender_name: payload.sender_name || "Peer",
        created_at: new Date(),
        is_me: false,
        file: 1,
      };

      hideEmptyState();
      renderMessage(unified);

      socket.emit("message:delivered", {
        from: getPeerId() || "",
        to: myUserId,
        messageId: null,
      });

      try {
        const res = await apiPost("/send", {
          sender_id: getPeerId() || "",
          receiver_id: myUserId || "",
          message: `File: ${payload.name}`,
          transport: "webrtc",
          file: 1,
          filename: payload.name,
          file_url: null,
          comment: payload.comment || "",
        });

        console.log("[messaging] Persist incoming P2P file:", res);
      } catch (err) {
        console.error("[messaging] Persist incoming P2P file failed:", err);
      }

      return;
    }

    // TEXT
    const text =
      typeof payload === "string" ? payload : safeJSON(payload);

    console.log("[messaging] Incoming P2P text:", text);

    hideEmptyState();
    renderMessage({
      is_me: false,
      message: text,
      created_at: new Date(),
      sender_name: "Peer",
    });

    socket.emit("message:delivered", {
      from: getPeerId() || "",
      to: myUserId,
      messageId: null,
    });

    observeMessagesForRead();
  };
}

// ===== Normalization =====
function normalizeMessage(msg) {
  const myUserId = getMyUserId();

  return {
    ...msg,
    message: msg.text ?? msg.message ?? "",
    is_me: String(msg.sender_id) === String(myUserId),
    sender_name:
      userNames[String(msg.sender_id)] || `User ${msg.sender_id}`,
    sender_avatar:
      userAvatars[String(msg.sender_id)] || "img/defaultUser.png",
  };
}

// ===== Loading messages (incremental with since_id) =====
export async function loadMessages() {
  console.log("[messaging] loadMessages called for receiver:", receiver_id);
  console.log("userNames cache right now:", userNames);

  if (!receiver_id) {
    console.warn("[messaging] loadMessages: no receiver_id");
    showEmptyState();
    return [];
  }

  const sinceParam =
    lastSeenMessageId && Number.isFinite(lastSeenMessageId)
      ? `?since_id=${encodeURIComponent(lastSeenMessageId)}`
      : "";

  try {
    const res = await apiGet(
      `/thread/${encodeURIComponent(receiver_id)}${sinceParam}`
    );
    console.log("[messaging] loadMessages raw:", res);

    if (!res || !res.success || !Array.isArray(res.messages)) {
      console.error("[messaging] loadMessages: invalid response format");
      showEmptyState();
      return [];
    }

    let messages = res.messages.map(normalizeMessage);
    if (!sinceParam) {
      lastLoadedMessages = messages;
    } else {
      lastLoadedMessages = [...lastLoadedMessages, ...messages];
    }

    const myUserId = getMyUserId();

    if (lastLoadedMessages.length === 0) {
      showEmptyState();
      return [];
    }

    hideEmptyState();

    if (messageWin) {
      messages.forEach((msg) => {
        const msgId = msg.id != null ? String(msg.id) : null;

        const exists = msgId
          ? document.querySelector(`[data-msg-id="${msgId}"]`)
          : null;

        if (!exists) {
          renderMessage(msg);

          if (!msg.is_me && msg.id !== undefined) {
            socket.emit("message:delivered", {
              from: msg.sender_id,
              to: myUserId,
              messageId: msg.id,
            });
          }
        }

        const display = document.querySelector(
          `[data-msg-id="${msg.id}"] .reaction-display`
        );
        if (display) display.innerHTML = "";

        if (msg.reactions && msg.reactions.length) {
          const counts = {};
          msg.reactions.forEach((emoji) => {
            counts[emoji] = (counts[emoji] || 0) + 1;
          });

          Object.entries(counts).forEach(([emoji, count]) => {
            for (let i = 0; i < count; i++) {
              addReactionToMessage(msg.id, emoji);
            }
          });
        }
      });
    }

    const last = lastLoadedMessages[lastLoadedMessages.length - 1];
    if (
      last &&
      typeof last.id === "number" &&
      last.id > lastSeenMessageId &&
      !last.is_me
    ) {
      playNotification();
      const bell = document.querySelector(".notification-bell");
      if (bell) {
        bell.classList.add("active");
        setTimeout(() => bell.classList.remove("active"), 1000);
      }

      const nearBottom =
        messageWin.scrollHeight -
          messageWin.scrollTop -
          messageWin.clientHeight <
        80;

      if (!nearBottom) showNewMessagePill();
    }

    if (last && typeof last.id === "number") {
      lastSeenMessageId = last.id;
    }

    observeMessagesForRead();
    return lastLoadedMessages;
  } catch (err) {
    console.error("[messaging] loadMessages failed:", err);
    showEmptyState();
    return [];
  }
}

// ===== Typing indicators =====
let typingStopTimer = null;

msgInput?.addEventListener("input", () => {
  const myUserId = getMyUserId();
  const targetId = getPeerId() || receiver_id;
  if (!targetId) return;

  socket.emit("typing:start", { from: myUserId, to: targetId });

  if (typingStopTimer) clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(() => {
    socket.emit("typing:stop", { from: myUserId, to: targetId });
  }, 800);
});

socket.on("typing:start", ({ from, fullname }) => {
  const currentChatPartner = receiver_id || getPeerId();
  if (!typingIndicator || !currentChatPartner) return;

  if (String(from) === String(currentChatPartner)) {
    const name =
      fullname || userNames[String(from)] || `User ${from}`;
    typingIndicator.classList.add("active");
    typingIndicator.textContent = `${name} is typing...`;
  }
});

socket.on("typing:stop", ({ from }) => {
  const currentChatPartner = receiver_id || getPeerId();
  if (!typingIndicator || !currentChatPartner) return;

  if (String(from) === String(currentChatPartner)) {
    typingIndicator.classList.remove("active");
    typingIndicator.textContent = "";
  }
});

// ===== Read receipts =====
socket.on("message:delivered", ({ messageId }) => {
  if (!messageId) return;

  const el = document.querySelector(
    `[data-msg-id="${String(messageId)}"] small`
  );
  if (el && !el.textContent.includes("✓ delivered")) {
    el.textContent += " ✓ delivered";
  }
});

socket.on("message:read", ({ messageId }) => {
  if (!messageId) return;

  const el = document.querySelector(
    `[data-msg-id="${String(messageId)}"] small`
  );
  if (el && !el.textContent.includes("✓ read")) {
    el.textContent += " ✓ read";
  }
});

// ===== Presence updates =====
socket.on("statusUpdate", ({ contact_id, online, away }) => {
  const statusText = away ? "Away" : online ? "Online" : "Offline";
  console.log(`[messaging] Contact ${contact_id} is ${statusText}`);

  const el = document.querySelector(
    `[data-contact-id="${contact_id}"] .status`
  );
  if (el) {
    el.textContent = statusText;
    el.className = `status ${statusText.toLowerCase()}`;
  }
});

// ===== Read observer =====
function createReadObserver() {
  if (!messageWin) return null;

  return new IntersectionObserver(
    (entries, observer) => {
      const myUserId = getMyUserId();

      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const msgEl = entry.target;
        const msgId = msgEl.dataset.msgId;
        const senderId = msgEl.dataset.senderId;

        if (msgId && senderId && senderId !== String(myUserId)) {
          socket.emit("message:read", {
            from: senderId,
            to: myUserId,
            messageId: msgId,
          });

          observer.unobserve(msgEl);
          delete msgEl.dataset.observing;
        }
      });
    },
    { root: messageWin, threshold: 0.8 }
  );
}

function observeMessagesForRead() {
  if (!messageWin) return;

  if (!readObserver) {
    readObserver = createReadObserver();
    if (!readObserver) return;
  }

  messageWin
    .querySelectorAll(".msg-wrapper.receiver_msg")
    .forEach((el) => {
      if (!el.dataset.observing) {
        readObserver.observe(el);
        el.dataset.observing = "1";
      }
    });
}

// ===== Activity tracking =====
let activityTimeout;
["keydown", "mousemove", "click", "scroll"].forEach((evt) => {
  document.addEventListener(evt, () => {
    clearTimeout(activityTimeout);
    activityTimeout = setTimeout(() => {
      if (socket && socket.connected) {
        socket.emit("activity");
      }
    }, 750);

    observeMessagesForRead();
  });
});

// ===== Polling (light recovery) =====
setInterval(() => {
  if (receiver_id) {
    loadMessages().catch((err) =>
      console.error("[messaging] Poll failed:", err)
    );
  }
}, 60000);

// -------------------------------------------------------
// ⭐ COMPOSER UI CONTROLS
// -------------------------------------------------------

const plusBtn = document.getElementById("plusBtn");
const bottomSheet = document.getElementById("bottomSheet");
const sheetEmoji = document.getElementById("sheetEmoji");
const sheetGif = document.getElementById("sheetGif");
const sheetFile = document.getElementById("sheetFile");
const sheetAudio = document.getElementById("sheetAudio");
const gifSearch = document.getElementById("gifSearch");
const gifResults = document.getElementById("gifResults");
const micBtn = document.getElementById("micBtn");

// ===== Toggle bottom sheet =====
plusBtn?.addEventListener("click", () => {
  bottomSheet?.classList.toggle("active");
});

// ===== Emoji Picker =====
sheetEmoji?.addEventListener("click", () => {
  bottomSheet?.classList.remove("active");
  if (!emojiPicker) return;
  emojiPicker.classList.toggle("active");
});

emojiPicker?.addEventListener("emoji-click", (e) => {
  msgInput.textContent += e.detail.unicode;
  emojiPicker.classList.remove("active");
});

// ===== GIF Picker =====
sheetGif?.addEventListener("click", () => {
  bottomSheet?.classList.remove("active");
  if (!gifPicker) return;
  gifPicker.classList.toggle("hidden");
  if (!gifPicker.classList.contains("hidden")) {
    gifSearch?.focus();
  }
});

// Simple GIF search using Tenor API
gifSearch?.addEventListener("input", async () => {
  const q = gifSearch.value.trim();
  if (!q) return;

  if (!gifResults) return;
  gifResults.innerHTML = "Searching…";

  try {
    const res = await fetch(
      `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(
        q
      )}&key=AIzaSyAdubke7aspKLSHGddez2EbaeRYrHtvtCQ&limit=20`
    );
    const data = await res.json();

    gifResults.innerHTML = "";

    data.results.forEach((gif) => {
      const img = document.createElement("img");
      img.src = gif.media_formats?.tinygif?.url;
      img.className = "gif-thumb";
      img.onclick = () => {
        msgInput.textContent += gif.media_formats?.tinygif?.url;
        if (gifPicker) gifPicker.classList.add("hidden");
      };
      gifResults.appendChild(img);
    });
  } catch (err) {
    gifResults.innerHTML = "Error loading GIFs";
  }
});

// ===== File Picker =====
sheetFile?.addEventListener("click", () => {
  bottomSheet?.classList.remove("active");
  attachmentInput?.click();
});

attachmentInput?.addEventListener("change", () => {
  const files = Array.from(attachmentInput.files || []);
  renderPreviews(files);
});

// ===== Audio Recording (placeholder + bubble toggle) =====
sheetAudio?.addEventListener("click", () => {
  bottomSheet?.classList.remove("active");
  if (recordingIndicator) {
    recordingIndicator.classList.toggle("active");
  }
  console.log("[composer] Voice message coming soon");
});

// ===== Mic Button (toggle recording bubble) =====
micBtn?.addEventListener("click", () => {
  console.log("[composer] Mic button clicked");
  if (recordingIndicator) {
    recordingIndicator.classList.toggle("active");
  }
});

// ===== Sending messages =====
async function sendMessage() {
  if (!receiver_id) {
    console.warn("[messaging] sendMessage: no receiver_id");
    return;
  }

  const text = (msgInput.textContent || "").trim();
  const files = Array.from(attachmentInput?.files || []);

  if (!text && files.length === 0) {
    console.log("[messaging] sendMessage: nothing to send");
    return;
  }

  try {
    const res = await apiPost("/send", {
      receiver_id,
      message: text || "",
      file: files.length > 0,
      file_url: null,
    });

    console.log("[messaging] sendMessage response:", res);

    if (res && res.success && res.message) {
      const normalized = normalizeMessage(res.message);
      renderMessage(normalized);
      msgInput.textContent = "";
      if (previewEl) previewEl.innerHTML = "";
      if (attachmentInput) attachmentInput.value = "";
    }
  } catch (err) {
    console.error("[messaging] sendMessage failed:", err);
    showError("Failed to send message");
  }
}

// Prevent form reload + send
msgForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage();
});

// ===== END OF FILE =====
console.log("[messaging] Fully upgraded messaging.js loaded");

































































