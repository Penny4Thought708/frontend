// public/js/messaging.js
// -------------------------------------------------------
// Messaging System (NO WebRTC, Node backend)

import {
  myUserId,
  messageWin,
  msgForm,
  msgInput,
  badge,
  messageBox,
  notificationSound,
  msgOpenBtn,
  closeMsgBtn,
  attachmentInput,
  attachmentBtn,
  previewDiv,
  safeJSON,
  playNotification,
  getJson,
  postForm,
} from "./session.js";

import { socket } from "./socket.js";

// ===== State =====
let receiver_id = null;
let lastSeenMessageId = 0;
let lastLoadedMessages = [];
const userNames = {}; // cache of userId → fullname

// Single IntersectionObserver instance for read receipts
let readObserver = null;

// Convenience alias for preview element
const previewEl = previewDiv;

// ===== RTC accessors =====
function getDataChannel() {
  return typeof window !== "undefined" ? window.dataChannel : undefined;
}
function getPeerId() {
  return typeof window !== "undefined" ? window.peerId : undefined;
}
function isChannelOpen(dc) {
  return !!dc && dc.readyState === "open";
}

// ===== Helpers =====
export function setReceiver(id) {
  receiver_id = id;
  console.log("[messaging] Receiver set to:", receiver_id);
}

function showError(msg) {
  console.error(msg);
  if (badge) {
    badge.textContent = "!";
    badge.style.display = "inline-block";
  }
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

// Smooth auto-scroll: only scroll if user is near bottom
function smartScroll() {
  if (!messageWin) return;
  const nearBottom =
    messageWin.scrollHeight -
      messageWin.scrollTop -
      messageWin.clientHeight <
    80;
  if (nearBottom) {
    messageWin.scrollTop = messageWin.scrollHeight;
  }
}

// Delete a message (UI and server)
async function deleteMessage(messageId) {
  if (!messageId) return;

  // Optimistically remove from DOM
  const el = document.querySelector(`[data-msg-id="${String(messageId)}"]`);
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }

  try {
    await postForm("messages_delete.php", { id: messageId });
    console.log("[messaging] Deleted message", messageId);
  } catch (err) {
    console.warn("Failed to delete message", err);
  }
}

// Global reaction helper
function addReactionToMessage(id, emoji) {
  const container = document.querySelector(
    `[data-msg-id="${id}"] .reaction-display`
  );
  if (!container) return;

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

// ===== UI open/close =====
msgOpenBtn?.addEventListener("click", async () => {
  messageBox?.classList.add("active");
  if (receiver_id) {
    try {
      const messages = await loadMessages();
      if (Array.isArray(messages) && messages.length) {
        lastSeenMessageId = messages[messages.length - 1].id ?? 0;
      }
      if (badge) badge.style.display = "none";

      // Mark all received messages as read on open
      messages
        .filter((m) => !m.is_me && typeof m.id !== "undefined")
        .forEach((m) => {
          socket.emit("message:read", {
            from: m.sender_id,
            to: myUserId,
            messageId: m.id,
          });
        });

      observeMessagesForRead();
    } catch {
      showError("Failed to load messages on open");
    }
  } else {
    console.warn("[messaging] msgOpenBtn clicked with no receiver set");
  }
});

closeMsgBtn?.addEventListener("click", () =>
  messageBox?.classList.remove("active")
);

export function showMessageWindow() {
  messageBox?.classList.add("active");
}

// ===== File rendering helpers =====
function appendFileContentToParagraph(p, options) {
  const { name, url, comment = "" } = options;

  const src = url;
  if (!src) {
    console.warn("Missing file URL/data for:", name);
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

    // Full-screen viewer hook (assumes #img-viewer & #img-viewer-img exist in HTML)
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

// ===== Core render =====
function renderMessage(msg) {
  if (!messageWin) return;

  const isFileMessage =
    msg.type === "file" ||
    msg.file ||
    /^File:/i.test(msg.message || "");

  const div = document.createElement("div");
  div.className = msg.is_me ? "sender_msg" : "receiver_msg";

  // For dedupe and receipts
  if (msg.id !== undefined && msg.id !== null) {
    div.dataset.msgId = String(msg.id);
  }
  if (!msg.is_me && msg.sender_id) {
    div.dataset.senderId = String(msg.sender_id);
  }

  const strong = document.createElement("strong");
  strong.textContent = msg.is_me ? "You" : msg.sender_name ?? "Them";

  const p = document.createElement("p");
  p.appendChild(strong);
  p.appendChild(document.createTextNode(": "));

  // FILE MESSAGES
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
    // TEXT MESSAGES
    p.appendChild(document.createTextNode(msg.message ?? ""));

    // Editing only for text messages YOU sent
    if (msg.is_me && msg.id) {
      p.ondblclick = () => {
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
            p.textContent = `You: ${original}`;
          }
          if (e.key === "Enter") {
            const newText = input.value.trim();
            if (!newText || newText === original) {
              p.textContent = `You: ${original}`;
              return;
            }

            // Optimistic update
            p.textContent = `You: ${newText}`;

            // Persist
            try {
              await postForm("messages_edit.php", {
                id: msg.id,
                message: newText,
              });
            } catch (err) {
              console.warn("Failed to edit message", err);
            }
          }
        };
      };
    }
  }


// ✅ REACTIONS (applies to ALL messages)
const reactionBar = document.createElement("div");

reactionBar.className = "reaction-bar";
reactionBar.innerHTML = `
  <span class="react-emoji">👍</span>
  <span class="react-emoji">❤️</span>
  <span class="react-emoji">😂</span>
  <span class="react-emoji">😮</span>
  <span class="react-emoji">😢</span>
`;



reactionBar.addEventListener("click", async (e) => {
  const emoji = e.target.closest(".react-emoji")?.textContent;
  if (!emoji || !msg.id) return;

  try {
    const res = await postForm("messages_react.php", {
      id: msg.id,
      emoji,
    });

    if (res.removed) {
      removeReactionFromMessage(msg.id, emoji);
    } else {
      addReactionToMessage(msg.id, emoji);
    }
  } catch (err) {
    console.warn("Failed to add reaction", err);
  }
});


div.appendChild(reactionBar);

// ✅ Reaction display container
const reactionDisplay = document.createElement("div");
reactionDisplay.className = "reaction-display";
div.appendChild(reactionDisplay);


  // META (timestamp + delete)
  const ts =
    msg.created_at instanceof Date
      ? msg.created_at
      : new Date(msg.created_at || Date.now());

  const small = document.createElement("small");
  small.textContent = ts.toLocaleString();

  const statusSpan = document.createElement("span");
  statusSpan.className = "status-flags";

  // Delete button
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

  div.appendChild(p);
  div.appendChild(meta);
  messageWin.appendChild(div);

  smartScroll();
  observeMessagesForRead();
}

// ===== Preview handling =====
function renderPreviews(files) {
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
  attachmentInput?.click();
});

attachmentInput?.addEventListener("change", () => {
  const files = Array.from(attachmentInput.files || []);
  renderPreviews(files);
});

// ===== Drag & drop upload on message window =====
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

// ===== Sending messages (text + files) =====
if (msgForm) {
  msgForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = (msgInput?.value ?? "").trim();
    const files = Array.from(attachmentInput?.files || []);

    const dc = getDataChannel();
    const peerId = getPeerId();
    const targetId = peerId || receiver_id;

    if (!targetId && (!message && !files.length)) {
      showError("No receiver selected");
      return;
    }

    // 1. Send files
    if (files.length > 0) {
      for (const file of files) {
        if (isChannelOpen(dc)) {
          // WebRTC path: send base64, persist separately
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

            // Persist to DB (best-effort)
            try {
              await postForm("messages.php", {
                receiver_id: targetId,
                message: `File: ${file.name}`,
                transport: "webrtc",
                file: 1,
                filename: file.name,
                file_url: null,
              });
            } catch (err) {
              console.warn("Persist outgoing P2P file failed:", err);
            }

            // Optimistic render for sender (fast display)
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
          // HTTP upload path
          const fd = new FormData();
          fd.append("attachment", file);
          fd.append("receiver_id", targetId || "");
          fd.append("sender_id", myUserId);

          try {
            const res = await fetch("upload.php", {
              method: "POST",
              body: fd,
              credentials: "same-origin",
            });
            const data = await res.json();
            if (data?.success && data.url) {
              // Insert message row via messages.php
              const msgRes = await postForm("messages.php", {
                receiver_id: targetId || "",
                message: `File: ${file.name}`,
                transport: "http",
                file: 1,
                filename: file.name,
                file_url: data.url,
              });

              // Render using server response when available
              if (msgRes?.success) {
                renderMessage({
                  id: msgRes.id,
                  is_me: true,
                  type: "file",
                  filename: msgRes.filename || file.name,
                  url: msgRes.url || data.url,
                  comment: msgRes.comment || "",
                  created_at: msgRes.created_at,
                  sender_id: myUserId,
                  sender_name: "You",
                  file: 1,
                });
              } else {
                // Fallback optimistic render
                renderMessage({
                  is_me: true,
                  type: "file",
                  filename: file.name,
                  url: data.url,
                  created_at: new Date(),
                  sender_id: myUserId,
                  sender_name: "You",
                  file: 1,
                });
              }
            } else {
              showError("Upload failed");
            }
          } catch (err) {
            console.error("Upload HTTP file failed", err);
            showError("Upload failed");
          }
        }
      }

      attachmentInput.value = "";
      if (previewEl) previewEl.innerHTML = "";
    }

    // 2. Send text
    if (message && targetId) {
      if (isChannelOpen(dc)) {
        dc.send(message);
        // Optimistic render
        renderMessage({
          is_me: true,
          message,
          created_at: new Date(),
          sender_id: myUserId,
          sender_name: "You",
        });

        fetch("messages.php", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            receiver_id: targetId || "",
            message,
            transport: "webrtc",
          }),
          credentials: "same-origin",
        }).catch((err) =>
          console.warn("Persist outgoing P2P text failed:", err)
        );
      } else {
        const data = await postForm("messages.php", {
          receiver_id: targetId,
          message,
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
          showError(data?.error || "Failed to send message");
        }
      }
    }

    msgInput.value = "";
  });
} else {
  console.warn("msgForm not found — submit handler not attached");
}

// ===== Receiving messages via DataChannel (text + files) =====
export function setupDataChannel(channel) {
  if (!channel) return;
  if (typeof window !== "undefined") window.dataChannel = channel;

  channel.onmessage = async (e) => {
    let payload = e.data;

    if (typeof e.data === "string") {
      try {
        payload = JSON.parse(e.data);
      } catch {
        payload = e.data;
      }
    }

    playNotification();

    // File payload
    if (payload && payload.type === "file") {
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
        await postForm("messages.php", {
          sender_id: getPeerId() || "",
          receiver_id: myUserId || "",
          message: `File: ${payload.name}`,
          transport: "webrtc",
          file: 1,
          filename: payload.name,
          file_url: null,
          comment: payload.comment || "",
        });
      } catch (err) {
        console.warn("Persist incoming P2P file failed:", err);
      }

      return;
    }

    // Text payload
    const text =
      typeof payload === "string" ? payload : safeJSON(payload);

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

// ===== Loading messages =====
export async function loadMessages() {
  if (!receiver_id) {
    console.warn("[messaging] loadMessages called with no receiver_id");
    return [];
  }

  try {
    const messages = await getJson(
      `messages.php?contact_id=${encodeURIComponent(receiver_id)}`
    );
    if (!Array.isArray(messages)) return [];

    lastLoadedMessages = messages;

    if (messageWin) {
      messages.forEach((msg) => {
        const msgId =
          msg.id !== undefined && msg.id !== null ? String(msg.id) : null;

        const exists = msgId
          ? document.querySelector(`[data-msg-id="${msgId}"]`)
          : null;

        // ✅ Render message if not already in DOM
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

        // ✅ ALWAYS hydrate reactions (new OR existing messages)
        const display = document.querySelector(
          `[data-msg-id="${msg.id}"] .reaction-display`
        );
        if (display) display.innerHTML = ""; // clear old reactions

        if (msg.reactions) {
         const arr = [...msg.reactions];

          const counts = {};

          // Count occurrences
          arr.forEach((emoji) => {
            counts[emoji] = (counts[emoji] || 0) + 1;
          });

          // Rebuild bubbles
          Object.entries(counts).forEach(([emoji, count]) => {
            for (let i = 0; i < count; i++) {
              addReactionToMessage(msg.id, emoji);
            }
          });
        }
      });
    }

    // ✅ Notification logic
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
    console.error("Failed to load messages", err);
    return [];
  }
}

function updateReactionSummary(id) {
  const container = document.querySelector(
    `[data-msg-id="${id}"] .reaction-display`
  );
  const summary = document.querySelector(
    `[data-msg-id="${id}"] .reaction-summary`
  );

  if (!container || !summary) return;

  const bubbles = [...container.querySelectorAll(".reaction-bubble")];
  const total = bubbles.reduce((sum, b) => {
    return sum + parseInt(b.querySelector(".react-count").textContent, 10);
  }, 0);

  const emojis = bubbles.map(b => b.dataset.emoji).join(" ");

  summary.textContent = total > 0 ? `${emojis}  •  ${total} reacted` : "";
}

// ===== Names cache =====
socket.on("user:name", ({ userId, fullname }) => {
  userNames[String(userId)] = fullname;
  console.log("[messaging] cached name:", userId, "→", fullname);
});

// ===== Typing indicators =====
const typingIndicator = $(".typing-indicator");
let typingStopTimer = null;

msgInput?.addEventListener("input", () => {
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

// ===== Receipt listeners =====
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

// ===== Presence / Status updates =====
socket.on("statusUpdate", ({ contact_id, online, away }) => {
  const statusText = away ? "Away" : online ? "Online" : "Offline";
  console.log(`Contact ${contact_id} is ${statusText}`);
  const el = document.querySelector(
    `[data-contact-id="${contact_id}"] .status`
  );
  if (el) {
    el.textContent = statusText;
    el.className = `status ${statusText.toLowerCase()}`;
  }
});

// ===== Read receipts on visibility =====
function createReadObserver() {
  if (!messageWin) return null;

  return new IntersectionObserver(
    (entries, observer) => {
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
    loadMessages().catch(() => showError("Poll failed"));
  }
}, 8000);

































