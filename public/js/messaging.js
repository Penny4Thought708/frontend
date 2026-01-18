// public/js/messaging.js
// -------------------------------------------------------
// Messaging System (NO WebRTC)

import { socket } from "./socket.js";

import {
  getMyUserId,
  getMyFullname,
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
  playNotification,
  getJson,
  postJson,   // ⭐ ADD THIS
} from "./session.js";


/* -------------------------------------------------------
   Messaging State
------------------------------------------------------- */

let receiver_id = null;
let lastSeenMessageId = 0;
let lastLoadedMessages = [];
let readObserver = null;

const userNames = {};
const previewEl = previewDiv;

/* -------------------------------------------------------
   UI Helpers
------------------------------------------------------- */

function showError(msg) {
  console.error(msg);
  if (badge) {
    badge.textContent = "!";
    badge.style.display = "inline-block";
  }
}

function smartScroll(force = false) {
  if (!messageWin) return;

  const nearBottom =
    messageWin.scrollHeight - messageWin.scrollTop - messageWin.clientHeight < 80;

  if (force || nearBottom) {
    messageWin.scrollTop = messageWin.scrollHeight;
  }
}


export function showMessageWindow() {
  messageBox?.classList.add("active");
}

/* -------------------------------------------------------
   Socket registration
------------------------------------------------------- */

socket.on("connect", () => {
  console.log("Socket connected:", socket.id);

socket.emit("register", {
  userId: getMyUserId(),
  fullname: getMyFullname(),
});

});

/* -------------------------------------------------------
   Receiver Setter
------------------------------------------------------- */

export function setReceiver(id) {
  receiver_id = id;
  window.receiver_id = id; // ⭐ FIX: make it global
  console.log("[messaging] Receiver set:", receiver_id);
  console.log("[GLOBAL] window.receiver_id =", window.receiver_id);
}

export function getReceiver() {
  return receiver_id;
}

/* -------------------------------------------------------
   Open / Close Message Window
------------------------------------------------------- */

msgOpenBtn?.addEventListener("click", async () => {
  messageBox?.classList.add("active");

  if (!receiver_id) return;

  try {
    const messages = await loadMessages();
    if (Array.isArray(messages) && messages.length) {
      lastSeenMessageId = messages[messages.length - 1].id ?? 0;
    }
    if (badge) badge.style.display = "none";


    }

    observeMessagesForRead();
  } catch {
    showError("Failed to load messages on open");
  }
});

closeMsgBtn?.addEventListener("click", () =>
  messageBox?.classList.remove("active")
);


/* -------------------------------------------------------
   Load Messages (modernized for new reaction format)
------------------------------------------------------- */
export async function loadMessages(contactId = window.receiver_id) {
  if (!contactId) return [];

  try {
    // ⭐ Correct endpoint + correct variable
    const res = await getJson(`/messages/thread/${contactId}`);
    const messages = Array.isArray(res.messages) ? res.messages : [];

    if (!messages.length) return [];

    const newest = messages[messages.length - 1];

    // ⭐ If no new messages, do nothing
    if (newest.id <= lastSeenMessageId) {
      return messages;
    }

    // ⭐ Append ONLY the new messages
    const newMessages = messages.filter(m => m.id > lastSeenMessageId);

    newMessages.forEach(msg => {
      renderMessage(msg);

      if (msg.id && Array.isArray(msg.reactions)) {
        renderReactionsForMessage(msg.id, msg.reactions);
      }
    });

    // ⭐ Scroll only when new messages arrive
    smartScroll(true);

    // Update last seen ID
    lastSeenMessageId = newest.id;

    return messages;

  } catch (err) {
    console.error("Failed to load messages", err);
    return [];
  }
}

/* -------------------------------------------------------
   Image Viewer (Lightbox)
------------------------------------------------------- */

const imageOverlay = document.getElementById("image-viewer-overlay");
const imageOverlayImg = document.getElementById("image-viewer-img");

let imageGallery = [];
let currentImageIndex = 0;

function buildGalleryFromMessages() {
  return lastLoadedMessages
    .filter((m) => m.file === 1 && (m.url || m.file_url)) // only image messages
    .map((m) => m.url || m.file_url);
}

function openImageViewer(src) {
  imageGallery = buildGalleryFromMessages();
  currentImageIndex = imageGallery.indexOf(src);

  imageOverlayImg.classList.remove("loaded");
  imageOverlayImg.src = src;

  imageOverlay.style.display = "flex";
  requestAnimationFrame(() => {
    imageOverlay.classList.add("visible");
  });

  imageOverlayImg.onload = () => {
    imageOverlayImg.classList.add("loaded");
  };

  preloadNeighbors();
}

function showImageAt(index) {
  if (index < 0 || index >= imageGallery.length) return;

  currentImageIndex = index;

  imageOverlayImg.classList.remove("loaded");
  imageOverlayImg.src = imageGallery[currentImageIndex];

  imageOverlayImg.onload = () => {
    imageOverlayImg.classList.add("loaded");
  };

  preloadNeighbors();
}

function preloadNeighbors() {
  const prev = imageGallery[currentImageIndex - 1];
  const next = imageGallery[currentImageIndex + 1];

  [prev, next].forEach((src) => {
    if (!src) return;
    const img = new Image();
    img.src = src;
  });
}

function closeImageViewer() {
  imageOverlay.classList.remove("visible");

  setTimeout(() => {
    imageOverlay.style.display = "none";
    imageOverlayImg.src = "";
  }, 250);
}

imageOverlay?.addEventListener("click", (e) => {
  if (e.target === imageOverlay) closeImageViewer();
});

document.getElementById("image-prev")?.addEventListener("click", (e) => {
  e.stopPropagation();
  showImageAt(currentImageIndex - 1);
});

document.getElementById("image-next")?.addEventListener("click", (e) => {
  e.stopPropagation();
  showImageAt(currentImageIndex + 1);
});

document.addEventListener("keydown", (e) => {
  if (!imageOverlay.classList.contains("visible")) return;

  if (e.key === "ArrowLeft") showImageAt(currentImageIndex - 1);
  else if (e.key === "ArrowRight") showImageAt(currentImageIndex + 1);
  else if (e.key === "Escape") closeImageViewer();
});

let touchStartX = 0;

imageOverlay?.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
});

imageOverlay?.addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;

  if (Math.abs(dx) > 50) {
    if (dx > 0) showImageAt(currentImageIndex - 1);
    else showImageAt(currentImageIndex + 1);
  }
});

/* -------------------------------------------------------
   File Message Helper
------------------------------------------------------- */

function appendFileContentToParagraph(p, file) {
  const name = file.name || "file";
  const url = file.url || null;
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(name);

  if (isImage && url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = name;
    img.className = "chat-inline-image";
    img.style.maxWidth = "200px";
    img.style.borderRadius = "8px";
    img.style.display = "block";
    img.style.marginTop = "6px";
    img.style.cursor = "zoom-in";

    img.onclick = () => openImageViewer(url);

    const label = document.createElement("span");
    label.textContent = name + " ";
    label.style.fontWeight = "bold";

    p.appendChild(label);
    p.appendChild(img);
  } else if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.textContent = name;
    link.style.marginLeft = "6px";
    p.appendChild(link);
  } else {
    p.appendChild(document.createTextNode(` [${name}]`));
  }

  if (file.comment) {
    const comment = document.createElement("em");
    comment.textContent = ` — ${file.comment}`;
    comment.style.marginLeft = "4px";
    p.appendChild(comment);
  }
}
/* -------------------------------------------------------
   Reactions rendering
------------------------------------------------------- */

function renderReactionsForMessage(messageId, reactions) {
  const container = document.querySelector(
    `[data-msg-id="${messageId}"] .reaction-display`
  );
  if (!container) return;

  container.innerHTML = "";
  if (!Array.isArray(reactions) || reactions.length === 0) return;

  const counts = {};
  reactions.forEach((r) => {
    const emoji = r.emoji;
    if (!emoji) return;
    counts[emoji] = (counts[emoji] || 0) + 1;
  });

  Object.entries(counts).forEach(([emoji, count]) => {
    const span = document.createElement("span");
    span.className = "reaction-pill";
    span.textContent = count > 1 ? `${emoji} ${count}` : emoji;
    container.appendChild(span);
  });
}

/* -------------------------------------------------------
   Render Message
------------------------------------------------------- */

export function renderMessage(msg) {
  if (!messageWin) return;

  const div = document.createElement("div");
  div.className = msg.is_me ? "sender_msg" : "receiver_msg";

  if (msg.id != null) div.dataset.msgId = String(msg.id);
  if (!msg.is_me && msg.sender_id) div.dataset.senderId = String(msg.sender_id);

  const p = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = msg.is_me ? "You" : msg.sender_name ?? "Them";
  p.appendChild(strong);
  p.appendChild(document.createTextNode(": "));

  /* -------------------------------------------------------
     AUDIO MESSAGE
  ------------------------------------------------------- */
  if (msg.type === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = msg.url;

    const durationLabel = document.createElement("span");
    durationLabel.className = "audio-duration";
    durationLabel.textContent = "…";

    audio.addEventListener("loadedmetadata", () => {
      if (!isFinite(audio.duration)) {
        durationLabel.textContent = "0:00";
        return;
      }
      const secs = Math.floor(audio.duration);
      const m = String(Math.floor(secs / 60)).padStart(1, "0");
      const s = String(secs % 60).padStart(2, "0");
      durationLabel.textContent = `${m}:${s}`;
    });

    audio.addEventListener("play", () => {
      div.classList.add("audio-playing");
    });
    audio.addEventListener("pause", () => {
      div.classList.remove("audio-playing");
    });
    audio.addEventListener("ended", () => {
      div.classList.remove("audio-playing");
    });

    p.appendChild(audio);
    p.appendChild(durationLabel);
  } else if (

  /* -------------------------------------------------------
     FILE MESSAGE (images, docs, etc.)
  ------------------------------------------------------- */
    msg.type === "file" ||
    msg.file ||
    /^File:/i.test(msg.message || "")
  ) {
    const name =
      msg.name || msg.filename || (msg.message || "").replace(/^File:\s*/, "");

    const fileUrl = msg.url || msg.file_url || msg.data || null;

    appendFileContentToParagraph(p, {
      name,
      url: fileUrl,
      comment: msg.comment,
    });
  } else {

  /* -------------------------------------------------------
     TEXT MESSAGE
  ------------------------------------------------------- */
    p.appendChild(document.createTextNode(msg.message ?? ""));
  }

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
      const res = await postForm("/api/messages/react.php", {
        id: msg.id,
        emoji,
        user_id: getMyUserId(),
      });

      if (!res || !res.success) {
        console.warn("Failed to add reaction", res?.error);
        return;
      }

      renderReactionsForMessage(msg.id, res.reactions);
    } catch (err) {
      console.warn("Failed to add reaction", err);
    }
  });

  const reactionDisplay = document.createElement("div");
  reactionDisplay.className = "reaction-display";

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
      showDeleteMenu(msg, e.pageX, e.pageY);
    });

    statusSpan.appendChild(del);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.appendChild(small);
  meta.appendChild(statusSpan);

  div.appendChild(reactionBar);
  div.appendChild(reactionDisplay);
  div.appendChild(p);
  div.appendChild(meta);

  messageWin.appendChild(div);

  if (Array.isArray(msg.reactions) && msg.id != null) {
    renderReactionsForMessage(msg.id, msg.reactions);
  }

  smartScroll();
  observeMessagesForRead();
}

/* -------------------------------------------------------
   Delete / Hide / Restore
------------------------------------------------------- */

function deleteMessageLocal(id) {
  const el = document.querySelector(`[data-msg-id="${id}"]`);
  if (el) el.remove();

  postForm("/api/messages/hide.php", { id });
  showUndoDelete(id);
}

async function restoreMessage(id) {
  try {
    const res = await postForm("/api/messages/restore.php", { id });
    if (res.success) {
      loadMessages();
    }
  } catch (err) {
    console.warn("Failed to restore message", err);
  }
}

async function deleteMessageForEveryone(id) {
  if (!id) return;

  try {
    const res = await postForm("/api/messages/delete.php", {
      id,
      everyone: 1,
    });

    if (res.success) {
      const el = document.querySelector(`[data-msg-id="${id}"]`);
      if (el) el.remove();
    } else {
      console.warn("Delete error:", res.error);
    }
  } catch (err) {
    console.warn("Delete for everyone failed", err);
  }
}

socket.on("call:voicemail", () => {
  showVoicemailRecordingUI();
  startVoicemailRecorder();
});

/* -------------------------------------------------------
   Undo Toast
------------------------------------------------------- */

function showUndoDelete(id) {
  const toast = document.createElement("div");
  toast.className = "undo-toast";
  toast.textContent = "Message hidden";

  const undoBtn = document.createElement("button");
  undoBtn.textContent = "Undo";

  let timer = null;

  undoBtn.onclick = () => {
    restoreMessage(id);
    toast.remove();
    if (timer) clearTimeout(timer);
  };

  toast.appendChild(undoBtn);
  document.body.appendChild(toast);

  timer = setTimeout(() => {
    toast.remove();
  }, 5000);
}

/* -------------------------------------------------------
   Hidden Messages Panel
------------------------------------------------------- */

const manageHiddenBtn = document.getElementById("manageHiddenBtn");
if (manageHiddenBtn) {
  manageHiddenBtn.onclick = loadHiddenMessages;
}

async function loadHiddenMessages() {
  const res = await fetch("/api/messages/hidden.php", {
    credentials: "same-origin",
  });
  const list = await res.json();

  const container = document.getElementById("hiddenList");
  if (!container) return;

  container.innerHTML = "";

  list.forEach((msg) => {
    const div = document.createElement("div");
    div.className = "hidden-item";

    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = msg.sender_name;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(`: ${msg.message}`));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Restore";
    btn.addEventListener("click", () => restoreMessage(msg.id));

    div.appendChild(p);
    div.appendChild(btn);
    container.appendChild(div);
  });

  const panel = document.getElementById("hiddenMessagesPanel");
  if (panel) panel.style.display = "block";
}

/* -------------------------------------------------------
   Delete Menu
------------------------------------------------------- */

function showDeleteMenu(msg, x, y) {
  const existing = document.querySelector(".delete-menu");
  if (existing) existing.remove();

  const menu = document.createElement("div");
  menu.className = "delete-menu";

  const delMe = document.createElement("button");
  delMe.textContent = "Delete for Me";
  delMe.onclick = () => {
    deleteMessageLocal(msg.id);
    menu.remove();
  };
  menu.appendChild(delMe);

  if (msg.is_me) {
    const delAll = document.createElement("button");
    delAll.textContent = "Delete for Everyone";
    delAll.onclick = () => {
      deleteMessageForEveryone(msg.id);
      menu.remove();
    };
    menu.appendChild(delAll);
  }

  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.onclick = () => menu.remove();
  menu.appendChild(cancel);

  document.body.appendChild(menu);

  menu.style.left = x + "px";
  menu.style.top = y + "px";

  setTimeout(() => {
    document.addEventListener(
      "click",
      function close(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener("click", close);
        }
      },
      { once: true }
    );
  }, 10);
}

/* -------------------------------------------------------
   Typing Indicator
------------------------------------------------------- */

const typingIndicator = document.querySelector(".typing-indicator");
let typingStopTimer = null;
let lastTypingTarget = null;

function getTargetId() {
  return receiver_id;
}

msgInput?.addEventListener("input", () => {
  const targetId = getTargetId();
  if (!targetId) return;

  if (lastTypingTarget !== targetId) {
    socket.emit("typing:stop", { from: getMyUserId(), to: targetId });
    lastTypingTarget = targetId;
  }

  socket.emit("typing:start", { from: getMyUserId(), to: targetId });

  if (typingStopTimer) clearTimeout(typingStopTimer);

  typingStopTimer = setTimeout(() => {
    socket.emit("typing:stop", { from: getMyUserId(), to: targetId });
  }, 900);
});

socket.on("typing:start", ({ from, getMyFullname, avatar }) => {
  const partner = getTargetId();
  if (!partner) return;

  if (String(from) === String(partner)) {
    const name = getMyFullname || userNames[from] || `User ${from}`;

    const avatarEl = typingIndicator.querySelector(".typing-avatar");
    const bubble = typingIndicator.querySelector(".typing-bubble");

    bubble.dataset.name = name;

    if (avatar) {
      avatarEl.src = avatar;
      avatarEl.style.display = "block";
    } else {
      avatarEl.style.display = "none";
    }

    typingIndicator.classList.add("active");
  }
});

socket.on("typing:stop", ({ from }) => {
  const partner = getTargetId();
  if (!partner) return;

  if (String(from) === String(partner)) {
    typingIndicator.classList.remove("active");
  }
});

/* -------------------------------------------------------
   Recording Indicator + Audio Recording + Waveform + Timer
------------------------------------------------------- */

const recordingIndicator = document.querySelector(".recording-indicator");
const micBtn = document.getElementById("micBtn");

let isRecording = false;
let mediaRecorder;
let audioChunks = [];
let audioStream;
let analyser;
let dataArray;
let animationId;

let cancelRecording = false;
let startX = 0;

const waveformCanvas = document.getElementById("waveformCanvas");
const ctx = waveformCanvas?.getContext("2d");

const recordTimer = document.getElementById("recordTimer");
let timerInterval;
let secondsElapsed = 0;

const slideCancel = document.getElementById("slideCancel");

/* -------------------------------------------------------
   Delivered / Read / Deleted
------------------------------------------------------- */

function updateStatus(messageId, text) {
  const el = document.querySelector(`[data-msg-id="${messageId}"] small`);
  if (!el) return;

  if (!el.textContent.includes(text)) {
    el.textContent += ` ${text}`;
  }
}

socket.on("message:delivered", ({ messageId }) => {
  if (messageId) updateStatus(messageId, "✓ delivered");
});

socket.on("message:read", ({ messageId }) => {
  if (messageId) updateStatus(messageId, "✓ read");
});

socket.on("message:deleted", ({ messageId }) => {
  const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) return;

  const p = msgEl.querySelector("p");
  if (p) p.textContent = "⚠️ Message deleted";

  msgEl.classList.add("deleted-message");
});

/* -------------------------------------------------------
   Presence
------------------------------------------------------- */

socket.on("statusUpdate", ({ contact_id, online, away }) => {
  const el = document.querySelector(
    `[data-contact-id="${contact_id}"] .status`
  );
  if (!el) return;

  const status = away ? "Away" : online ? "Online" : "Offline";
  el.textContent = status;
  el.className = `status ${status.toLowerCase()}`;
});

/* -------------------------------------------------------
   Read Observer (Node backend version)
------------------------------------------------------- */

function createReadObserver() {
  if (!messageWin) return null;

  return new IntersectionObserver(
    async (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const msgEl = entry.target;
        const senderId = msgEl.dataset.senderId;

        // Only mark messages from the OTHER user
        if (senderId && senderId !== String(getMyUserId())) {
          try {
            await postJson("/messages/mark-read", {
              contactId: receiver_id,
            });
          } catch (err) {
            console.warn("[readObserver] mark-read failed:", err);
          }

          observer.unobserve(msgEl);
          msgEl.dataset.observing = "0";
        }
      }
    },
    { root: messageWin, threshold: 0.75 }
  );
}

function observeMessagesForRead() {
  if (!messageWin) return;

  if (!readObserver) readObserver = createReadObserver();
  if (!readObserver) return;

  messageWin.querySelectorAll(".receiver_msg").forEach((el) => {
    if (!el.dataset.observing) {
      readObserver.observe(el);
      el.dataset.observing = "1";
    }
  });
}

/* -------------------------------------------------------
   Activity Tracking
------------------------------------------------------- */

let activityTimeout = null;

["keydown", "mousemove", "click", "scroll"].forEach((evt) => {
  document.addEventListener(evt, () => {
    clearTimeout(activityTimeout);

    activityTimeout = setTimeout(() => {
      socket.emit("activity");
    }, 600);

    observeMessagesForRead();
  });
});

/* -------------------------------------------------------
   Polling
------------------------------------------------------- */

let polling = false;

setInterval(async () => {
  if (!receiver_id || polling) return;

  polling = true;
  try {
    await loadMessages();
  } catch (err) {
    showError("Poll failed");
  }
  polling = false;
}, 8000);

/* -------------------------------------------------------
   Drag & Drop Upload
------------------------------------------------------- */

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

/* -------------------------------------------------------
   File Previews
------------------------------------------------------- */

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

/* -------------------------------------------------------
   File Upload (HTTP)
------------------------------------------------------- */

async function sendFileViaHttp(file, targetId) {
  const fd = new FormData();
  fd.append("attachment", file);
  fd.append("receiver_id", targetId || "");
  fd.append("sender_id", getMyUserId());

  try {
    const res = await fetch("/api/messages/upload.php", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    });

    const data = await res.json();
    if (data?.success && data.url) {
      const msgRes = await postForm("/api/messages/send.php", {
        sender_id: getMyUserId(),
        receiver_id: targetId,
        message: `File: ${file.name}`,
        transport: "http",
        file: 1,
        filename: file.name,
        file_url: data.url,
      });

      const msgId = msgRes?.id || null;

      renderMessage({
        id: msgId,
        is_me: true,
        type: "file",
        filename: msgRes?.filename || file.name,
        url: msgRes?.file_url || data.url,
        comment: msgRes?.comment || "",
        created_at: msgRes?.created_at || new Date(),
        sender_id: getMyUserId(),
        sender_name: "You",
        file: 1,
      });
    } else {
      showError("Upload failed");
    }
  } catch (err) {
    console.error("Upload HTTP file failed", err);
    showError("Upload failed");
  }
}

/* -------------------------------------------------------
   Sending Messages (text + files)
------------------------------------------------------- */

if (msgForm) {
  msgForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = (msgInput?.value ?? "").trim();
    const files = Array.from(attachmentInput?.files || []);

    const targetId = receiver_id;

    if (!targetId && !message && !files.length) {
      showError("No receiver selected");
      return;
    }

    if (files.length > 0) {
      for (const file of files) {
        await sendFileViaHttp(file, targetId);
      }

      attachmentInput.value = "";
      if (previewEl) previewEl.innerHTML = "";
    }

    if (message && targetId) {
      try {
        const data = await postForm("/api/messages/send.php", {
          sender_id: getMyUserId(),
          receiver_id: targetId,
          message,
        });

        const success =
          data && (data.success === true || typeof data.id !== "undefined");

        if (success) {
          renderMessage({
            id: data.id,
            is_me: true,
            message: data.message,
            created_at: data.created_at,
            sender_id: getMyUserId(),
            sender_name: "You",
          });
        } else {
          showError(data?.error || "Failed to send message");
        }
      } catch (err) {
        console.error("Send message failed", err);
        showError("Failed to send message");
      }
    }

    if (msgInput) msgInput.value = "";
  });
} else {
  console.warn("msgForm not found — submit handler not attached");
}
/* -------------------------------------------------------
   Voice Messages: Recording + Upload + Playback
------------------------------------------------------- */

// Assumes globals:
// - socket
// - getMyUserId()
// - receiver_id (current chat partner)
// - getTargetId() → current chat partner ID
// - showError(msg) → toast/error UI

/* -------------------------------------------------------
   RECORDING TIMER (CLEAN VERSION)
------------------------------------------------------- */

function startTimer() {
  if (!recordTimer) return;

  secondsElapsed = 0;
  recordTimer.style.display = "inline-block";
  recordTimer.textContent = "00:00";

  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    const s = String(secondsElapsed % 60).padStart(2, "0");
    recordTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  if (recordTimer) recordTimer.style.display = "none";
}
/* -------------------------------------------------------
   WAVEFORM VISUALIZATION (CLEAN VERSION)
------------------------------------------------------- */

function startWaveform(stream) {
  if (!waveformCanvas || !ctx) return;

  waveformCanvas.style.display = "inline-block";

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;

  dataArray = new Uint8Array(analyser.frequencyBinCount);
  source.connect(analyser);

  function draw() {
    animationId = requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);

    const barWidth = 3;
    let x = 0;

    for (let i = 0; i < dataArray.length; i += 4) {
      const barHeight = dataArray[i] / 3;
      const volume = dataArray[i] / 255;

      ctx.fillStyle =
        volume < 0.3 ? "#ffb3b3" : volume < 0.6 ? "#ff4d4d" : "#ff9900";

      ctx.fillRect(x, waveformCanvas.height - barHeight, barWidth, barHeight);

      x += barWidth + 2;
    }
  }

  draw();
}

function stopWaveform() {
  if (!waveformCanvas) return;
  waveformCanvas.style.display = "none";
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
}

/* -------------------------------------------------------
   AUDIO RECORDING CORE
------------------------------------------------------- */

async function startRecording() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error("Microphone error:", err);
    showError?.("Microphone access denied");
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(audioStream);
  } catch (err) {
    console.error("MediaRecorder init failed:", err);
    showError?.("Audio recording not supported");
    return;
  }

  audioChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data?.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    stopWaveform();
    stopTimer();

    // Cancelled by sliding left
    if (cancelRecording) {
      cleanupStream();
      return;
    }

    // No audio captured
    if (!audioChunks.length) {
      cleanupStream();
      return;
    }

    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    cleanupStream();
    sendAudioMessage(audioBlob);
  };

  mediaRecorder.start();
  startWaveform(audioStream);
  startTimer();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  } else {
    stopWaveform();
    stopTimer();
  }
}

function cleanupStream() {
  audioStream?.getTracks()?.forEach((t) => t.stop());
  audioStream = null;
  mediaRecorder = null;
}

/* -------------------------------------------------------
   PRESS + HOLD + SLIDE CANCEL
------------------------------------------------------- */

function handleRecordStart(e) {
  const targetId = getTargetId?.() ?? receiver_id;
  if (!targetId || !getMyUserId()) return;

  cancelRecording = false;
  isRecording = true;

  startX = e.touches ? e.touches[0].clientX : e.clientX;

  if (slideCancel) {
    slideCancel.style.display = "inline-block";
    slideCancel.style.opacity = "1";
  }

  startRecording();

  socket.emit("recording:start", {
    from: getMyUserId(),
    to: targetId,
  });
}

function handleRecordStop() {
  const targetId = getTargetId?.() ?? receiver_id;
  if (!targetId || !getMyUserId()) return;
  if (!isRecording) return;

  isRecording = false;

  if (slideCancel) {
    slideCancel.style.display = "none";
    slideCancel.style.opacity = "1";
  }

  stopRecording();

  socket.emit("recording:stop", {
    from: getMyUserId(),
    to: targetId,
  });
}

function handleSlideCancel(e) {
  if (!isRecording || !slideCancel) return;

  const currentX = e.touches ? e.touches[0].clientX : e.clientX;
  const slidFarEnough = startX - currentX > 80;

  cancelRecording = slidFarEnough;
  slideCancel.style.opacity = slidFarEnough ? "0.3" : "1";
}

// Mouse
micBtn?.addEventListener("mousedown", handleRecordStart);
micBtn?.addEventListener("mousemove", handleSlideCancel);
micBtn?.addEventListener("mouseup", handleRecordStop);
micBtn?.addEventListener("mouseleave", handleRecordStop);

// Touch
micBtn?.addEventListener("touchstart", handleRecordStart);
micBtn?.addEventListener("touchmove", handleSlideCancel);
micBtn?.addEventListener("touchend", handleRecordStop);
micBtn?.addEventListener("touchcancel", handleRecordStop);

/* -------------------------------------------------------
   RECORDING INDICATOR (RECEIVER)
------------------------------------------------------- */

socket.on("recording:start", ({ from }) => {
  const partner = getTargetId?.() ?? receiver_id;
  if (String(from) === String(partner)) {
    recordingIndicator?.classList.add("active");
  }
});

socket.on("recording:stop", ({ from }) => {
  const partner = getTargetId?.() ?? receiver_id;
  if (String(from) === String(partner)) {
    recordingIndicator?.classList.remove("active");
  }
});

/* -------------------------------------------------------
   UPLOAD + SEND AUDIO MESSAGE (CLEAN VERSION)
------------------------------------------------------- */

async function sendAudioMessage(blob) {
  const targetId = getTargetId?.() ?? receiver_id;

  if (!targetId || !getMyUserId()) {
    showError?.("No recipient selected");
    return;
  }

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    // Attach audio + metadata
    formData.append("audio", blob, "audio.webm");
    formData.append("from", getMyUserId());
    formData.append("to", targetId);

    // Upload progress UI
    const progressBar = document.createElement("div");
    progressBar.className = "upload-progress";
    progressBar.textContent = "Uploading… 0%";
    messageWin?.appendChild(progressBar);

    // Progress updates
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.textContent = `Uploading… ${percent}%`;
      }
    };

    // Upload complete
    xhr.onload = () => {
      progressBar.remove();

      let result = {};
      try {
        result = JSON.parse(xhr.responseText || "{}");
      } catch (err) {
        console.error("audio.php JSON parse error:", err, xhr.responseText);
      }

      resolve(result);
    };

    // Upload error
    xhr.onerror = () => {
      progressBar.remove();
      resolve({ success: false, error: "Network error" });
    };

    // Correct path for your /NewApp structure
    xhr.open("POST", "api/messages/audio.php");
    xhr.send(formData);
  }).then((result) => {
    if (result?.success && result.url) {
      // Notify via socket
      socket.emit("message:audio", {
        from: getMyUserId(),
        to: targetId,
        url: result.url,
      });
    } else {
      console.error("Audio upload failed:", result);
      showError?.("Audio upload failed");
    }
  });
}
/* -------------------------------------------------------
   RENDER AUDIO MESSAGE (Unified with renderMessage)
------------------------------------------------------- */

socket.on("message:audio", ({ id, from, url }) => {
  if (!url) return;

  const isMine = String(from) === String(getMyUserId());

  // Build a message object identical to loader.php output
  const msg = {
    id: id ?? null,
    sender_id: from,
    receiver_id: getTargetId?.() ?? receiver_id,
    sender_name: isMine ? "You" : null,
    receiver_name: null,
    message: "",
    transport: "socket",
    file: 1,
    filename: url.split("/").pop(),
    url: url,
    comment: "",
    created_at: new Date().toISOString(),
    is_read: isMine ? 1 : 0,
    is_me: isMine,
    type: "audio",
    reactions: [],
  };

  // Use your main renderer so audio behaves like all other messages
  renderMessage(msg);
});




















