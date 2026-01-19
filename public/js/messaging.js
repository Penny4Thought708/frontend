// public/js/messaging.js
// -------------------------------------------------------
// Messaging System (NO WebRTC, Node backend)

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
  postJson,
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
  window.receiver_id = id;
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

    const unread = messages.filter(
      (m) => !m.is_me && typeof m.id !== "undefined"
    );

    for (const m of unread) {
      await postJson(
        "https://letsee-backend.onrender.com/api/messages/mark-read",
        { messageId: m.id }
      );
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
   Load Messages (Node backend)
------------------------------------------------------- */

export async function loadMessages(contactId = window.receiver_id) {
  if (!contactId) return [];

  try {
    const res = await getJson(
      `https://letsee-backend.onrender.com/api/messages/thread/${contactId}`
    );
    const messages = Array.isArray(res.messages) ? res.messages : [];

    if (!messages.length) {
      lastLoadedMessages = [];
      messageWin.innerHTML = "";
      return [];
    }

    lastLoadedMessages = messages;
    messageWin.innerHTML = "";

    messages.forEach((msg) => {
      renderMessage(msg);
      if (msg.id && Array.isArray(msg.reactions)) {
        renderReactionsForMessage(msg.id, msg.reactions);
      }
    });

    smartScroll(true);
    lastSeenMessageId = messages[messages.length - 1].id;

    return messages;
  } catch (err) {
    console.error("Failed to load messages", err);
    return [];
  }
}

/* -------------------------------------------------------
   Render Message
------------------------------------------------------- */

function renderMessage(msg) {
  if (!messageWin) return;

  const isMe = msg.sender_id === getMyUserId();

  const div = document.createElement("div");
  div.className = `chat-message ${isMe ? "me" : "them"}`;
  div.dataset.id = msg.id;

  const name = document.createElement("div");
  name.className = "chat-name";
  name.textContent = isMe ? "You" : msg.sender_name || "Contact";

  const body = document.createElement("div");
  body.className = "chat-body";

  const p = document.createElement("p");
  p.textContent = msg.message || "";

  if (msg.file === 1 && (msg.url || msg.file_url)) {
    appendFileContentToParagraph(p, {
      name: msg.file_name,
      url: msg.url || msg.file_url,
      comment: msg.file_comment,
    });
  }

  body.appendChild(p);

  const meta = document.createElement("div");
  meta.className = "chat-meta";
  meta.textContent = msg.created_at || "";

  div.appendChild(name);
  div.appendChild(body);
  div.appendChild(meta);

  messageWin.appendChild(div);
}

/* -------------------------------------------------------
   Reactions
------------------------------------------------------- */

function renderReactionsForMessage(messageId, reactions) {
  const msgEl = messageWin?.querySelector(`.chat-message[data-id="${messageId}"]`);
  if (!msgEl) return;

  let bar = msgEl.querySelector(".reaction-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "reaction-bar";
    msgEl.appendChild(bar);
  }

  bar.innerHTML = "";

  reactions.forEach((r) => {
    const span = document.createElement("span");
    span.className = "reaction";
    span.textContent = r.emoji;
    bar.appendChild(span);
  });
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
    .filter((m) => m.file === 1 && (m.url || m.file_url))
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
   Attachments UI
------------------------------------------------------- */

attachmentBtn?.addEventListener("click", () => {
  attachmentInput?.click();
});

attachmentInput?.addEventListener("change", () => {
  if (!attachmentInput.files || !attachmentInput.files.length) {
    if (previewEl) previewEl.innerHTML = "";
    return;
  }

  const file = attachmentInput.files[0];
  if (!previewEl) return;

  previewEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "attachment-preview-item";
  div.textContent = file.name;
  previewEl.appendChild(div);
});

/* -------------------------------------------------------
   Send Message
------------------------------------------------------- */

msgForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!receiver_id) return;

  const text = msgInput?.value?.trim() || "";
  const file = attachmentInput?.files?.[0] || null;

  if (!text && !file) return;

  try {
    const formData = new FormData();
    formData.append("sender_id", getMyUserId());
    formData.append("receiver_id", receiver_id);
    formData.append("message", text);

    if (file) {
      formData.append("file", file);
    }

    const res = await fetch(
      "https://letsee-backend.onrender.com/api/messages/send",
      {
        method: "POST",
        credentials: "include",
        body: formData,
      }
    );

    if (!res.ok) throw new Error("Send failed");

    msgInput.value = "";
    if (attachmentInput) attachmentInput.value = "";
    if (previewEl) previewEl.innerHTML = "";

    await loadMessages(receiver_id);
  } catch (err) {
    console.error("Failed to send message", err);
    showError("Failed to send");
  }
});

/* -------------------------------------------------------
   Read Observer
------------------------------------------------------- */

function observeMessagesForRead() {
  if (!("IntersectionObserver" in window) || !messageWin) return;

  if (readObserver) {
    readObserver.disconnect();
  }

  readObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(async (entry) => {
        if (!entry.isIntersecting) return;

        const el = entry.target;
        const id = Number(el.dataset.id);
        if (!id) return;

        try {
          await postJson(
            "https://letsee-backend.onrender.com/api/messages/mark-read",
            { messageId: id }
          );
        } catch (err) {
          console.warn("Failed to mark read", err);
        }

        readObserver.unobserve(el);
      });
    },
    { threshold: 0.6 }
  );

  messageWin
    .querySelectorAll(".chat-message")
    .forEach((el) => readObserver.observe(el));
}

























