// public/js/messaging.js
// -------------------------------------------------------
// Messaging System (NO PHP, Node backend, FULL LOGGING)

import {
  getMyUserId,
  messageWin,
  msgForm,
  msgInput,
  badge,
  messageBox,
  msgOpenBtn,
  closeMsgBtn,
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

// ===== HELPERS =====
export function setReceiver(id) {
  receiver_id = id;
  console.log("[messaging] Receiver set:", receiver_id);
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
  if (nearBottom) messageWin.scrollTop = messageWin.scrollHeight;
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

// ===== RENDER MESSAGE =====
function renderMessage(msg) {
  console.log("[messaging] renderMessage:", msg);

  if (!messageWin) {
    console.error("[messaging] messageWin missing");
    return;
  }

  const isFileMessage =
    msg.type === "file" ||
    msg.file ||
    /^File:/i.test(msg.message || "");

  const div = document.createElement("div");
  div.className = msg.is_me ? "sender_msg" : "receiver_msg";

  if (msg.id != null) div.dataset.msgId = String(msg.id);
  if (!msg.is_me && msg.sender_id) div.dataset.senderId = String(msg.sender_id);

  // ===== Modern wrapper =====
  const wrapper = document.createElement("div");
  wrapper.className = "msg-wrapper";

  // ===== Name (only for received messages) =====
  if (!msg.is_me) {
    const nameEl = document.createElement("div");
    nameEl.className = "msg-sender-name";
    nameEl.textContent = msg.sender_name || "Unknown";
    wrapper.appendChild(nameEl);
  }

  // ===== Bubble =====
  const p = document.createElement("p");
  p.className = "msg-bubble-text";
  wrapper.appendChild(p);

  // ===== File or Text =====
  if (isFileMessage) {
    const name =
      msg.name ||
      msg.filename ||
      (msg.message || "").replace(/^File:\s*/, "");

    const fileUrl = msg.url || msg.file_url || msg.data || null;

    appendFileContentToParagraph(p, {
      name,
      url: fileUrl,
      comment: msg.comment,
    });

  } else {
    p.appendChild(document.createTextNode(msg.message ?? ""));

    // ===== Inline editing for your messages =====
    if (msg.is_me && msg.id) {
      p.ondblclick = () => {
        console.log("[messaging] edit dblclick:", msg.id);

        const original = msg.message ?? "";
        const input = document.createElement("input");
        input.type = "text";
        input.value = original;
        input.className = "edit-input";

        p.innerHTML = "";
        p.appendChild(input);
        input.focus();

        input.onkeydown = async (e) => {
          if (e.key === "Escape") {
            p.textContent = original;
          }
          if (e.key === "Enter") {
            const newText = input.value.trim();
            if (!newText || newText === original) {
              p.textContent = original;
              return;
            }

            p.textContent = newText;

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

  // ===== Reaction bar =====
reactionBar.addEventListener("click", (e) => {
  const emoji = e.target.closest(".react-emoji")?.textContent;
  if (!emoji || !msg.id) return;

  console.log("[messaging] reaction clicked:", emoji, "msg:", msg.id);

  socket.emit("message:reaction", {
    messageId: msg.id,
    from: getMyUserId(),
    emoji
  });

  addReactionToMessage(msg.id, emoji);
});


  // ===== Reaction display container =====
  const reactionDisplay = document.createElement("div");
  reactionDisplay.className = "reaction-display";

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

  // ===== Append everything in correct order =====
  div.appendChild(wrapper);          // name + bubble
  div.appendChild(reactionBar);      // emoji bar
  div.appendChild(reactionDisplay);  // reaction counts
  div.appendChild(meta);             // timestamp + delete

  messageWin.appendChild(div);

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

attachmentBtn?.addEventListener("click", () => {
  console.log("[messaging] attachmentBtn clicked");
  attachmentInput?.click();
});

attachmentInput?.addEventListener("change", () => {
  console.log("[messaging] attachmentInput changed");
  const files = Array.from(attachmentInput.files || []);
  renderPreviews(files);
});

// ===== DRAG & DROP =====
if (messageWin) {
  messageWin.addEventListener("dragover", (e) => {
    e.preventDefault();
    messageWin.classList.add("drag-over");
  });

  messageWin.addEventListener("dragleave", (e) => {
    if (e.target === messageWin) {
      messageWin.classList.remove("drag-over");
    }
  });

  messageWin.addEventListener("drop", (e) => {
    e.preventDefault();
    messageWin.classList.remove("drag-over");

    const dt = new DataTransfer();
    [...e.dataTransfer.files].forEach((f) => dt.items.add(f));
    attachmentInput.files = dt.files;

    renderPreviews([...dt.files]);
  });
}

// ===== SEND MESSAGES =====
if (msgForm) {
  msgForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    console.log("[messaging] msgForm submit");

    const message = (msgInput?.value ?? "").trim();
    const files = Array.from(attachmentInput?.files || []);

    const dc = getDataChannel();
    const peerId = getPeerId();
    const targetId = peerId || receiver_id;
    const myUserId = getMyUserId();

    if (!targetId && (!message && !files.length)) {
      showError("No receiver selected");
      return;
    }

    // FILES
    if (files.length > 0) {
      console.log("[messaging] sending files:", files);

      for (const file of files) {
        if (isChannelOpen(dc)) {
          console.log("[messaging] sending file via WebRTC:", file.name);

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
            dc.send(JSON.stringify(payload));

            try {
              const res = await apiPost("/send", {
                receiver_id: targetId,
                message: `File: ${file.name}`,
                transport: "webrtc",
                file: 1,
                filename: file.name,
                file_url: null,
              });
              console.log("[messaging] persist P2P file:", res);
            } catch (err) {
              console.error("[messaging] persist P2P file failed:", err);
            }

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
          };
          reader.readAsDataURL(file);
        } else {
          console.log("[messaging] uploading file via HTTP:", file.name);

          const fd = new FormData();
          fd.append("audio", file);

          try {
            const uploadRes = await fetch(`${MESSAGES_API_BASE}/audio`, {
              method: "POST",
              body: fd,
              credentials: "include",
            });

            const uploadData = await uploadRes.json();
            console.log("[messaging] upload response:", uploadData);

            if (uploadData?.success && uploadData.url) {
              const msgRes = await apiPost("/send", {
                receiver_id: targetId,
                message: `File: ${file.name}`,
                transport: "http",
                file: 1,
                filename: file.name,
                file_url: uploadData.url,
              });

              console.log("[messaging] send file response:", msgRes);

              renderMessage({
                id: msgRes.id,
                is_me: true,
                type: "file",
                filename: msgRes.filename || file.name,
                url: msgRes.url || uploadData.url,
                comment: msgRes.comment || "",
                created_at: msgRes.created_at,
                sender_id: myUserId,
                sender_name: "You",
                file: 1,
              });
            } else {
              showError("Upload failed");
            }
          } catch (err) {
            console.error("[messaging] upload HTTP failed:", err);
            showError("Upload failed");
          }
        }
      }

      attachmentInput.value = "";
      if (previewEl) previewEl.innerHTML = "";
    }

    // TEXT
    if (message && targetId) {
      console.log("[messaging] sending text:", message);

      if (isChannelOpen(dc)) {
        dc.send(message);

        renderMessage({
          is_me: true,
          message,
          created_at: new Date(),
          sender_id: myUserId,
          sender_name: "You",
        });

        apiPost("/send", {
          receiver_id: targetId,
          message,
          transport: "webrtc",
        })
          .then((res) => {
            console.log("[messaging] P2P text persisted:", res);
          })
          .catch((err) => {
            console.error("[messaging] P2P text persist failed:", err);
          });
      } else {
        console.log("[messaging] sending text via HTTP:", message);

        try {
          const data = await apiPost("/send", {
            receiver_id: targetId,
            message,
          });
          console.log("[messaging] HTTP text send response:", data);

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
            console.error("[messaging] HTTP text send failed:", data);
            showError(data?.error || "Failed to send message");
          }
        } catch (err) {
          console.error("[messaging] HTTP text send exception:", err);
          showError("Failed to send message");
        }
      }
    }

    if (msgInput) msgInput.value = "";
  });
} else {
  console.warn("[messaging] msgForm not found — submit handler not attached");
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
    is_me: msg.sender_id === myUserId,
    sender_name:
      userNames[String(msg.sender_id)] || `User ${msg.sender_id}`,
    sender_avatar:
      userAvatars[String(msg.sender_id)] || "img/defaultUser.png",
  };
}

// ===== Loading messages =====
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
    if (last && typeof last.id === "number" && last.id > lastSeenMessageId && !last.is_me) {
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

// ===== Typing indicators =====
const typingIndicator = $(".typing-indicator");
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

  messageWin.querySelectorAll(".receiver_msg").forEach((el) => {
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

// ===== Polling =====
setInterval(() => {
  if (receiver_id) {
    loadMessages().catch((err) =>
      console.error("[messaging] Poll failed:", err)
    );
  }
}, 8000);
























































