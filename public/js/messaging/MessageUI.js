// public/js/messaging/MessageUI.js

import {
  messageWin,
  notificationSound,
  getMyUserId
} from "../session.js";

import { store } from "./StateStore.js";

/* -------------------------------------------------------
   DOM References
------------------------------------------------------- */
export const receiverContainer = document.querySelector(".receiver_msg");
export const senderContainer   = document.querySelector(".sender_msg");
export const typingIndicator   = document.querySelector(".typing-indicator");

const imgViewer    = document.getElementById("img-viewer");
const imgViewerImg = document.getElementById("img-viewer-img");

/* -------------------------------------------------------
   Create Message Bubble (Unified Renderer)
------------------------------------------------------- */
function createMessageBubble(msg) {
  const isMe = msg.sender_id === getMyUserId() || msg.is_me;

  const bubble = document.createElement("div");
  bubble.className = isMe ? "msg-bubble me" : "msg-bubble them";
  bubble.dataset.msgId = msg.id;

  /* -------------------------------
     TEXT MESSAGE
  --------------------------------*/
  if (msg.type === "text" && msg.message) {
    const p = document.createElement("p");
    p.textContent = msg.message;
    bubble.appendChild(p);
  }

  /* -------------------------------
     GIF MESSAGE
  --------------------------------*/
  if (msg.type === "gif" && msg.file_url) {
    const img = document.createElement("img");
    img.src = msg.file_url;
    img.className = "msg-gif";
    img.alt = "GIF";
    img.addEventListener("click", () => openImageViewer(img.src));
    bubble.appendChild(img);
  }

  /* -------------------------------
     IMAGE / FILE MESSAGE
  --------------------------------*/
  if (msg.type === "file" && msg.file_url) {
    const img = document.createElement("img");
    img.src = msg.file_url;
    img.className = "msg-image";
    img.alt = msg.filename || "attachment";
    img.addEventListener("click", () => openImageViewer(img.src));
    bubble.appendChild(img);
  }

  /* -------------------------------
     AUDIO MESSAGE
  --------------------------------*/
  if (msg.type === "audio" && msg.file_url) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = msg.file_url;
    audio.className = "msg-audio";
    bubble.appendChild(audio);
  }

  /* -------------------------------
     COMMENT UNDER ATTACHMENT
  --------------------------------*/
  if (msg.comment) {
    const c = document.createElement("div");
    c.className = "msg-comment";
    c.textContent = msg.comment;
    bubble.appendChild(c);
  }

  /* -------------------------------
     REACTIONS ROW
  --------------------------------*/
  const reactionRow = document.createElement("div");
  reactionRow.className = "msg-reactions";
  reactionRow.dataset.msgId = msg.id;
  bubble.appendChild(reactionRow);

  return { bubble, isMe };
}

/* -------------------------------------------------------
   Image Viewer
------------------------------------------------------- */
function openImageViewer(src) {
  if (!imgViewer || !imgViewerImg) return;
  imgViewerImg.src = src;
  imgViewer.classList.add("open");
}

if (imgViewer) {
  imgViewer.addEventListener("click", () => {
    imgViewer.classList.remove("open");
  });
}

/* -------------------------------------------------------
   Render Full Conversation (Unified)
------------------------------------------------------- */
export function renderMessages(msg) {
  const { bubble, isMe } = createMessageBubble(msg);

  if (isMe) {
    senderContainer?.appendChild(bubble);
  } else {
    receiverContainer?.appendChild(bubble);
  }
}

/* -------------------------------------------------------
   Render Single Incoming Message
------------------------------------------------------- */
export function renderIncomingMessage(msg) {
  const { bubble, isMe } = createMessageBubble(msg);

  if (isMe) {
    senderContainer?.appendChild(bubble);
  } else {
    receiverContainer?.appendChild(bubble);
    try {
      notificationSound?.play();
    } catch {}
  }

  scrollToBottom();
}

/* -------------------------------------------------------
   Scroll Helper
------------------------------------------------------- */
function scrollToBottom() {
  if (!messageWin) return;
  messageWin.scrollTop = messageWin.scrollHeight;
}


