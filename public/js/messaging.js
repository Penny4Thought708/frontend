// public/js/messaging.js
// -------------------------------------------------------
// Messaging System (Node backend, FULL LOGGING + UI ENHANCEMENTS)

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

// ===== UI ELEMENTS =====
const emptyStateEl = document.getElementById("messageEmptyState");
const newMessagesPill = document.getElementById("newMessagesPill");
const typingIndicator = document.querySelector(".typing-indicator");
const recordingIndicator = document.querySelector(".recording-indicator");

const deleteMenuSheet = document.getElementById("deleteMenuSheet");
const btnDeleteForMe = document.getElementById("btnDeleteForMe");
const btnDeleteForEveryone = document.getElementById("btnDeleteForEveryone");
const btnDeleteCancel = document.getElementById("btnDeleteCancel");
const undoToast = document.getElementById("undoToast");
const btnUndoDelete = document.getElementById("btnUndoDelete");

let pendingDeleteMessageId = null;
let pendingDeleteScope = null; // "me" | "everyone"
let undoTimer = null;

// Emoji / GIF pickers (start hidden)
const emojiPicker = document.getElementById("emojiPicker");
const gifPicker = document.getElementById("gifPicker");
if (emojiPicker) emojiPicker.classList.remove("active");
if (gifPicker && !gifPicker.classList.contains("hidden")) {
  gifPicker.classList.add("hidden");
}

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

function showError(msg) {
  console.error("[messaging] ERROR:", msg);
  if (badge) {
    badge.textContent = "!";
    badge.style.display = "inline-block";
  }
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

// ===== RECEIVER SETTER =====
export function setReceiver(id) {
  receiver_id = id;
  if (typeof window !== "undefined") {
    window.receiver_id = id;
    window.currentReceiverId = id;
  }
  console.log("[messaging] Receiver set:", receiver_id);

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

  loadMessages().catch((err) =>
    console.error("[messaging] loadMessages after setReceiver failed:", err)
  );
}

export function getReceiver() {
  return receiver_id;
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

// ===== DELETE MENU + UNDO =====
function openDeleteMenu(messageId, isMine) {
  pendingDeleteMessageId = messageId;
  pendingDeleteScope = null;

  deleteMenuSheet?.classList.add("active");

  if (btnDeleteForEveryone) {
    btnDeleteForEveryone.style.display = isMine ? "block" : "none";
  }
}

function closeDeleteMenu() {
  deleteMenuSheet?.classList.remove("active");
}

function showUndoToast(scope) {
  pendingDeleteScope = scope;
  undoToast?.classList.add("show");

  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoToast?.classList.remove("show");
    pendingDeleteMessageId = null;
    pendingDeleteScope = null;
  }, 5000);
}

function hideUndoToast() {
  undoToast?.classList.remove("show");
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = null;
}

btnDeleteCancel?.addEventListener("click", () => {
  closeDeleteMenu();
});

btnDeleteForMe?.addEventListener("click", async () => {
  if (!pendingDeleteMessageId) return;
  const id = pendingDeleteMessageId;

  closeDeleteMenu();
  document.querySelector(`[data-msg-id="${id}"]`)?.remove();

  try {
    await apiPost("/delete-for-me", { message_id: id });
    showUndoToast("me");
  } catch (err) {
    console.error("[delete-for-me] failed:", err);
    loadMessages();
  }
});

btnDeleteForEveryone?.addEventListener("click", async () => {
  if (!pendingDeleteMessageId) return;
  const id = pendingDeleteMessageId;

  closeDeleteMenu();
  document.querySelector(`[data-msg-id="${id}"]`)?.remove();

  try {
    await apiPost("/delete-for-everyone", { message_id: id });
    showUndoToast("everyone");
    socket.emit("message:delete-everyone", { messageId: id });
  } catch (err) {
    console.error("[delete-for-everyone] failed:", err);
    loadMessages();
  }
});

btnUndoDelete?.addEventListener("click", async () => {
  if (!pendingDeleteMessageId || !pendingDeleteScope) return;
  const id = pendingDeleteMessageId;
  const scope = pendingDeleteScope;

  hideUndoToast();

  if (scope === "me") {
    try {
      await apiPost("/restore", { message_id: id });
      await loadMessages();
    } catch (err) {
      console.error("[restore] failed:", err);
    }
  } else if (scope === "everyone") {
    console.log("[undo] for everyone not supported with hard delete");
  }

  pendingDeleteMessageId = null;
  pendingDeleteScope = null;
});

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

socket.on("message:reaction:update", ({ messageId, emoji, action }) => {
  if (!messageId || !emoji || !action) return;
  if (action === "added") {
    addReactionToMessage(messageId, emoji);
  } else if (action === "removed") {
    removeReactionFromMessage(messageId, emoji);
  }
});

// ===== RENDER MESSAGE =====
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

  const wrapper = document.createElement("div");
  wrapper.className =
    msg.is_me ? "msg-wrapper sender_msg" : "msg-wrapper receiver_msg";
  wrapper.classList.add("bubble-style");

  wrapper.style.animation = "msgPop 0.25s cubic-bezier(.17,.89,.32,1.49)";
  wrapper.style.opacity = "0";
  requestAnimationFrame(() => {
    wrapper.style.transition = "opacity 0.25s ease";
    wrapper.style.opacity = "1";
  });

  if (msg.id != null) wrapper.dataset.msgId = String(msg.id);
  if (!msg.is_me && msg.sender_id)
    wrapper.dataset.senderId = String(msg.sender_id);

  if (!msg.is_me) {
    const nameEl = document.createElement("div");
    nameEl.className = "msg-sender-name";
    nameEl.textContent =
      msg.sender_name ||
      userNames[String(msg.sender_id)] ||
      "Unknown";
    wrapper.appendChild(nameEl);
  }

  const bubble = document.createElement("p");
  bubble.className = "msg-bubble-text";
  wrapper.appendChild(bubble);

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

  const reactionDisplay = document.createElement("div");
  reactionDisplay.className = "reaction-display";
  wrapper.appendChild(reactionDisplay);

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

    addReactionToMessage(msg.id, emoji);
  });

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

    del.addEventListener("click", (e) => {
      e.stopPropagation();
      openDeleteMenu(msg.id, !!msg.is_me);
    });

    statusSpan.appendChild(del);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.appendChild(small);
  meta.appendChild(statusSpan);
  wrapper.appendChild(meta);

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

// ===== LOADING MESSAGES =====
function normalizeMessage(raw) {
  const myUserId = getMyUserId();
  const isMe = String(raw.sender_id) === String(myUserId);

  return {
    id: raw.id,
    sender_id: raw.sender_id,
    receiver_id: raw.receiver_id,
    message: raw.text ?? raw.message ?? "",
    file_url: raw.file_url,
    created_at: raw.created_at,
    type: raw.type || "message",
    reactions: Array.isArray(raw.reactions)
      ? raw.reactions
      : safeJSON(raw.reactions, []),
    is_me: isMe,
  };
}

export async function loadMessages() {
  console.log("[messaging] loadMessages called for receiver:", receiver_id);
  console.log("userNames cache right now:", userNames);

  if (!receiver_id) {
    console.warn("[messaging] loadMessages: no receiver_id");
    showEmptyState();
    return [];
  }

  try {
    const res = await apiGet(`/thread/${encodeURIComponent(receiver_id)}`);
    console.log("[messaging] loadMessages raw:", res);

    if (!res || !res.success || !Array.isArray(res.messages)) {
      console.error("[messaging] loadMessages: invalid response format");
      showEmptyState();
      return [];
    }

    let messages = res.messages.map(normalizeMessage);
    lastLoadedMessages = messages;
    const myUserId = getMyUserId();

    if (messages.length === 0) {
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

    const last = messages[messages.length - 1];
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
    return messages;
  } catch (err) {
    console.error("[messaging] loadMessages failed:", err);
    showEmptyState();
    return [];
  }
}

// ===== TYPING INDICATORS =====
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

socket.on("typing:start", ({ from }) => {
  const currentChatPartner = receiver_id || getPeerId();
  if (!typingIndicator || !currentChatPartner) return;

  if (String(from) === String(currentChatPartner)) {
    typingIndicator.classList.add("active");
  }
});

socket.on("typing:stop", ({ from }) => {
  const currentChatPartner = receiver_id || getPeerId();
  if (!typingIndicator || !currentChatPartner) return;

  if (String(from) === String(currentChatPartner)) {
    typingIndicator.classList.remove("active");
  }
});

// ===== READ RECEIPTS =====
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

// ===== PRESENCE UPDATES =====
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

// ===== READ OBSERVER =====
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

// ===== ACTIVITY TRACKING =====
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

// ===== POLLING =====
setInterval(() => {
  if (receiver_id) {
    loadMessages().catch((err) =>
      console.error("[messaging] Poll failed:", err)
    );
  }
}, 8000);

// ===== SOCKET DELETE-EVERYONE SYNC =====
socket.on("message:delete-everyone", ({ messageId }) => {
  if (!messageId) return;
  document.querySelector(`[data-msg-id="${messageId}"]`)?.remove();
});

// ===== DATA CHANNEL (P2P) =====
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

      renderMessage(unified);
      return;
    }

    if (typeof payload === "string") {
      const unified = {
        id: null,
        type: "message",
        message: payload,
        sender_id: getPeerId(),
        sender_name: "Peer",
        created_at: new Date(),
        is_me: false,
      };
      renderMessage(unified);
    }
  };
}

// ===== FORM SUBMIT (TEXT + FILES) =====
msgForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!receiver_id) {
    showError("No receiver selected");
    return;
  }

  const text = msgInput?.value.trim() || "";
  const files = Array.from(attachmentInput?.files || []);

  if (!text && files.length === 0) return;

  const myUserId = getMyUserId();
  const dc = getDataChannel();

  if (files.length > 0) {
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const payload = {
          type: "file",
          name: file.name,
          data: reader.result,
          sender_name: "Me",
        };

        if (isChannelOpen(dc)) {
          dc.send(JSON.stringify(payload));
        }

        const unified = {
          id: null,
          type: "file",
          name: file.name,
          url: null,
          data: reader.result,
          comment: "",
          sender_id: myUserId,
          sender_name: "Me",
          created_at: new Date(),
          is_me: true,
          file: 1,
        };

        renderMessage(unified);
      };
      reader.readAsDataURL(file);
    }
  }

  if (text) {
    const unified = {
      id: null,
      type: "message",
      message: text,
      sender_id: myUserId,
      sender_name: "Me",
      created_at: new Date(),
      is_me: true,
    };
    renderMessage(unified);

    socket.emit("message:new", {
      from: myUserId,
      to: receiver_id,
      message: text,
    });

    try {
      await apiPost("/send", {
        to: receiver_id,
        message: text,
      });
    } catch (err) {
      console.error("[messaging] send failed:", err);
    }
  }

  if (msgInput) msgInput.value = "";
  if (attachmentInput) {
    attachmentInput.value = "";
    renderPreviews([]);
  }
});


































































