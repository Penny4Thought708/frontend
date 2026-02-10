// public/js/messaging.js
// -------------------------------------------------------
// Messaging System (Node backend, floating layout, full UI integration)
// -------------------------------------------------------

import {
  getMyUserId,
  messageWin,
  msgForm,
  msgInput,
  badge,
  attachmentInput,
  safeJSON,
  playNotification,
} from "./session.js";

import { socket } from "./socket.js";
import { userNames, userAvatars } from "./shared/user-cache.js";

const MESSAGES_API_BASE = "https://letsee-backend.onrender.com/api/messages";
console.log("[messaging] Loaded messaging.js (UI-clean, production-ready)");

let receiver_id = null;
let lastSeenMessageId = 0;
let lastLoadedMessages = [];
let readObserver = null;
let activeDataChannel = null;

// UI elements
const previewEl = document.getElementById("attachmentPreview");
const emptyStateEl = document.getElementById("messageEmptyState");
const typingIndicator = document.querySelector(".typing-indicator");
const recordingIndicator = document.querySelector(".recording-indicator");
const newMsgBubble = document.querySelector(".new-message-bubble");

// -------------------------------------------------------
// Empty State Helpers
// -------------------------------------------------------

function showEmptyState() {
  if (!messageWin || !emptyStateEl) return;
  messageWin.innerHTML = "";
  emptyStateEl.classList.remove("hidden");
}

function hideEmptyState() {
  if (!emptyStateEl) return;
  emptyStateEl.classList.add("hidden");
}

// -------------------------------------------------------
// New Message Bubble (appears when user is scrolled up)
// -------------------------------------------------------

function showNewMessageBubble() {
  if (!newMsgBubble) return;
  newMsgBubble.classList.remove("hidden");
  requestAnimationFrame(() => newMsgBubble.classList.add("show"));
}

function hideNewMessageBubble() {
  if (!newMsgBubble) return;
  newMsgBubble.classList.remove("show");
  setTimeout(() => newMsgBubble.classList.add("hidden"), 200);
}

newMsgBubble?.addEventListener("click", () => {
  messageWin.scrollTo({ top: messageWin.scrollHeight, behavior: "smooth" });
  hideNewMessageBubble();
});

// ===== Normalization =====
function normalizeMessage(msg) {
  const myUserId = getMyUserId();

  return {
    ...msg,
    is_me: msg.sender_id === myUserId,
    sender_name:
      userNames[String(msg.sender_id)] || `User ${msg.sender_id}`,
    sender_avatar:
      userAvatars[String(msg.sender_id)] || "img/defaultUser.png",
  };
}
// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function sanitizeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function getDataChannel() {
  return activeDataChannel;
}

function getPeerId() {
  return window?.peerId;
}

function isChannelOpen(dc) {
  return !!dc && dc.readyState === "open";
}

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
    hideNewMessageBubble();
  }
}
/// ===== Loading messages =====/
export async function loadMessages() {
  console.log("[messaging] loadMessages called for receiver:", receiver_id);
  console.log("userNames cache right now:", userNames);

  if (!receiver_id) {
    console.warn("[messaging] loadMessages: no receiver_id");
    return [];
  }

  try {
    const res = await apiGet(`/thread/${encodeURIComponent(receiver_id)}`);
    console.log("[messaging] loadMessages raw:", res);

    if (!res || !res.success || !Array.isArray(res.messages)) {
      console.error("[messaging] loadMessages: invalid response format");
      return [];
    }

    let messages = res.messages.map(normalizeMessage);
    lastLoadedMessages = messages;
    const myUserId = getMyUserId();

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

        if (msg.reactions) {
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
    }

    if (last && typeof last.id === "number") {
      lastSeenMessageId = last.id;
    }

    observeMessagesForRead();
    return messages;
  } catch (err) {
    console.error("[messaging] loadMessages failed:", err);
    return [];
  }
}
// -------------------------------------------------------
// Network helpers
// -------------------------------------------------------

async function apiGet(path) {
  const url = `${MESSAGES_API_BASE}${path}`;
  console.log("[messaging] GET:", url);

  try {
    const res = await fetch(url, { method: "GET", credentials: "include" });
    const text = await res.text();
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
    return JSON.parse(text);
  } catch (err) {
    console.error("[messaging] POST failed:", err);
    throw err;
  }
}

async function safeSendMessage(payload) {
  try {
    return await apiPost("/send", payload);
  } catch (err) {
    console.warn("[messaging] Send failed, retrying in 1s…", err);
    await new Promise((res) => setTimeout(res, 1000));
    return apiPost("/send", payload);
  }
}

// -------------------------------------------------------
// Receiver
// -------------------------------------------------------

export function setReceiver(id) {
  receiver_id = id;
  window.receiver_id = id;
  window.currentReceiverId = id;

  console.log("[messaging] Receiver set:", id);

  // Reset UI
  if (messageWin) messageWin.innerHTML = "";
  hideEmptyState();
  typingIndicator?.classList.remove("active");
  recordingIndicator?.classList.remove("active");
  hideNewMessageBubble();

  // Load thread
  loadMessages().catch((err) =>
    console.error("[messaging] loadMessages after setReceiver failed:", err)
  );
}

export function getReceiver() {
  return receiver_id;
}

// -------------------------------------------------------
// File rendering
// -------------------------------------------------------

function appendFileContentToParagraph(p, options) {
  const { name, url, comment = "" } = options;

  if (!url) return;

  if (/\.(png|jpe?g|gif|webp)$/i.test(name)) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = name;
    img.loading = "lazy";
    img.style.maxWidth = "200px";
    img.style.display = "block";
    p.appendChild(img);

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
    a.href = url;
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

document.getElementById("img-viewer")?.addEventListener("click", () => {
  document.getElementById("img-viewer").style.display = "none";
});

// -------------------------------------------------------
// Delete message
// -------------------------------------------------------

async function deleteMessage(messageId) {
  if (!messageId) return;

  const el = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (el) el.remove();

  try {
    await apiPost("/delete", { id: messageId });
  } catch (err) {
    console.error("[messaging] deleteMessage failed:", err);
  }
}

// -------------------------------------------------------
// Reactions
// -------------------------------------------------------

function addReactionToMessage(id, emoji) {
  const container = document.querySelector(
    `[data-msg-id="${id}"] .reaction-display`
  );
  if (!container) return;

  let bubble = container.querySelector(`[data-emoji="${emoji}"]`);

  if (bubble) {
    const countEl = bubble.querySelector(".react-count");
    countEl.textContent = Number(countEl.textContent) + 1;
  } else {
    bubble = document.createElement("span");
    bubble.className = "reaction-bubble pop";
    bubble.dataset.emoji = emoji;
    bubble.innerHTML = `
      <span class="emoji-safe">${emoji}</span>
      <span class="react-count">1</span>
    `;
    container.appendChild(bubble);
    setTimeout(() => bubble.classList.remove("pop"), 250);
  }
}

// -------------------------------------------------------
// Render message
// -------------------------------------------------------

function renderMessage(msg) {
  if (!messageWin) return;

  hideEmptyState();

  if (!msg.id) {
    msg.id = `rtc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const wrapper = document.createElement("div");
  wrapper.className = msg.is_me
    ? "msg-wrapper sender_msg"
    : "msg-wrapper receiver_msg";

  wrapper.dataset.msgId = msg.id;
  if (!msg.is_me && msg.sender_id)
    wrapper.dataset.senderId = msg.sender_id;

  if (!msg.is_me) {
    const nameEl = document.createElement("div");
    nameEl.className = "msg-sender-name";
    nameEl.textContent =
      msg.sender_name ||
      userNames[msg.sender_id] ||
      "Unknown";
    wrapper.appendChild(nameEl);
  }

  const bubble = document.createElement("p");
  bubble.className = "msg-bubble-text";
  wrapper.appendChild(bubble);

  const isFileMessage =
    msg.type === "file" ||
    msg.file ||
    /^File:/i.test(msg.message || "");

  if (isFileMessage) {
    appendFileContentToParagraph(bubble, {
      name: msg.name || msg.filename,
      url: msg.url || msg.data,
      comment: msg.comment,
    });
  } else {
    bubble.textContent = sanitizeHTML(msg.message ?? "");
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

    socket.emit("message:reaction", {
      messageId: msg.id,
      from: getMyUserId(),
      emoji,
    });

    addReactionToMessage(msg.id, emoji);
  });

  const ts = new Date(msg.created_at || Date.now());
  const meta = document.createElement("div");
  meta.className = "meta";

  const small = document.createElement("small");
  small.textContent = ts.toLocaleString();
  meta.appendChild(small);

  if (msg.id) {
    const del = document.createElement("button");
    del.className = "delete-msg";
    del.textContent = "🗑";
    del.onclick = () => deleteMessage(msg.id);
    meta.appendChild(del);
  }

  wrapper.appendChild(meta);

  messageWin.appendChild(wrapper);

  const nearBottom =
    messageWin.scrollHeight -
      messageWin.scrollTop -
      messageWin.clientHeight <
    80;

  if (nearBottom) {
    smartScroll();
  } else {
    showNewMessageBubble();
  }

  observeMessagesForRead();
}

// -------------------------------------------------------
// File preview strip
// -------------------------------------------------------

function renderPreviews(files) {
  if (!previewEl) return;

  previewEl.innerHTML = "";

  if (!files.length) {
    previewEl.classList.add("hidden");
    return;
  }

  previewEl.classList.remove("hidden");

  files.forEach((file) => {
    const wrap = document.createElement("div");
    wrap.className = "preview-wrapper";

    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.onload = () => URL.revokeObjectURL(img.src);
      img.loading = "lazy";
      wrap.appendChild(img);
    } else {
      const link = document.createElement("span");
      link.textContent = file.name;
      wrap.appendChild(link);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-preview";
    removeBtn.textContent = "✖";
    removeBtn.onclick = () => {
      const current = Array.from(attachmentInput.files);
      const newFiles = current.filter((f) => f !== file);
      const dt = new DataTransfer();
      newFiles.forEach((f) => dt.items.add(f));
      attachmentInput.files = dt.files;
      renderPreviews(newFiles);
    };

    wrap.appendChild(removeBtn);
    previewEl.appendChild(wrap);
  });
}

attachmentInput?.addEventListener("change", () => {
  renderPreviews(Array.from(attachmentInput.files));
});

// -------------------------------------------------------
// Send messages
// -------------------------------------------------------

msgForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = msgInput?.innerText.trim() || "";
  const files = Array.from(attachmentInput?.files || []);
  const dc = getDataChannel();
  const peerId = getPeerId();
  const targetId = peerId || receiver_id;
  const myUserId = getMyUserId();

  if (!targetId && !text && !files.length) {
    showError("No receiver selected");
    showEmptyState();
    return;
  }

  const MAX_SIZE = 25 * 1024 * 1024;
  const ALLOWED_PREFIXES = ["image/", "audio/", "video/", "application/pdf"];

  // FILES
  for (const file of files) {
    if (
      !ALLOWED_PREFIXES.some((p) => file.type.startsWith(p)) ||
      file.size > MAX_SIZE
    ) {
      showError("Unsupported or too large file");
      continue;
    }

    if (isChannelOpen(dc)) {
      const reader = new FileReader();

      reader.onload = async () => {
        const payload = {
          type: "file",
          name: file.name,
          mime: file.type,
          size: file.size,
          data: reader.result,
          sender_name: "You",
        };
        try {
          dc.send(JSON.stringify(payload));

          await safeSendMessage({
            receiver_id: targetId,
            message: `File: ${file.name}`,
            transport: "webrtc",
            file: 1,
            filename: file.name,
          });

          renderMessage({
            is_me: true,
            type: "file",
            name: file.name,
            data: reader.result,
            created_at: new Date(),
            sender_id: myUserId,
            sender_name: "You",
            file: 1,
          });
        } catch (err) {
          showError("Failed to send file");
        }
      };

      reader.onerror = () => {
        showError("Failed to read file");
      };

      reader.readAsDataURL(file);
    } else {
      try {
        const fd = new FormData();
        fd.append("audio", file);

        const uploadRes = await fetch(`${MESSAGES_API_BASE}/audio`, {
          method: "POST",
          body: fd,
          credentials: "include",
        });

        const uploadData = await uploadRes.json();

        if (uploadData?.success && uploadData.url) {
          const msgRes = await safeSendMessage({
            receiver_id: targetId,
            message: `File: ${file.name}`,
            transport: "http",
            file: 1,
            filename: file.name,
            file_url: uploadData.url,
          });

          renderMessage({
            id: msgRes.id,
            is_me: true,
            type: "file",
            filename: msgRes.filename || file.name,
            url: msgRes.url || uploadData.url,
            created_at: msgRes.created_at,
            sender_id: myUserId,
            sender_name: "You",
            file: 1,
          });
        } else {
          showError("Upload failed");
        }
      } catch (err) {
        console.error("[messaging] upload failed:", err);
        showError("Upload failed");
      }
    }
  }

  attachmentInput.value = "";
  renderPreviews([]);

  // TEXT
  if (text && targetId) {
    if (isChannelOpen(dc)) {
      try {
        dc.send(text);

        renderMessage({
          is_me: true,
          message: text,
          created_at: new Date(),
          sender_id: myUserId,
          sender_name: "You",
        });

        safeSendMessage({
          receiver_id: targetId,
          message: text,
          transport: "webrtc",
        });
      } catch (err) {
        showError("Failed to send message");
      }
    } else {
      try {
        const data = await safeSendMessage({
          receiver_id: targetId,
          message: text,
        });

        if (data?.success) {
          renderMessage({
            id: data.id,
            is_me: true,
            message: data.message,
            created_at: data.created_at,
            sender_id: myUserId,
            sender_name: "You",
          });
        } else {
          showError("Failed to send message");
        }
      } catch (err) {
        showError("Failed to send message");
      }
    }
  }

  msgInput.innerText = "";
});

// -------------------------------------------------------
// Receive via datachannel
// -------------------------------------------------------

export function setupDataChannel(channel) {
  if (!channel) return;
  activeDataChannel = channel;

  channel.onmessage = async (e) => {
    let payload = e.data;

    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        // plain text
      }
    }

    playNotification();
    const myUserId = getMyUserId();

    // FILE
    if (payload?.type === "file") {
      renderMessage({
        id: null,
        type: "file",
        name: payload.name,
        url: payload.url || null,
        data: payload.data || null,
        sender_id: getPeerId(),
        sender_name: payload.sender_name || "Peer",
        created_at: new Date(),
        is_me: false,
        file: 1,
      });

          safeSendMessage({
        sender_id: getPeerId(),
        receiver_id: myUserId,
        message: `File: ${payload.name}`,
        transport: "webrtc",
        file: 1,
        filename: payload.name,
      });

      return;
    }

    // TEXT
    const text =
      typeof payload === "string"
        ? sanitizeHTML(payload)
        : sanitizeHTML(safeJSON(payload));

    renderMessage({
      is_me: false,
      message: text,
      created_at: new Date(),
      sender_name: "Peer",
    });

    observeMessagesForRead();
  };
}
































































