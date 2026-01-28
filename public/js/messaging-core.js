// public/js/messaging-core.js
// -------------------------------------------------------------
// Messaging Core Module (Node backend, Session Auth)
// -------------------------------------------------------------
// Handles:
// - Text messaging (rich input + GIFs)
// - Hybrid file transfer (P2P DataChannel + HTTP fallback)
// - Slow-network detection (floating banner)
// - Delivered/read receipts
// - Typing indicators (emit only)
// - Incoming message handling
// - Integration with session.js + messaging.js + WebRTC
// -------------------------------------------------------------

/* -------------------------------------------------------------
   Imports
------------------------------------------------------------- */

import {
  getMyUserId,
  msgInput,                // contenteditable
  messagesContainer,
  scrollMessagesToBottom,
  topBar
} from "./session.js";

import {
  renderMessage,
  showError
} from "./messaging.js";

/* -------------------------------------------------------------
   Module State
------------------------------------------------------------- */

let socketRef = null;
let getPeerIdFn = null;
let getDataChannelFn = null;

const P2P_MAX_SIZE = 2 * 1024 * 1024;      // 2 MB
const SLOW_NETWORK_THRESHOLD = 50 * 1024;  // 50 KB/s
const STALL_TIMEOUT = 1500;               // 1.5 seconds

/* -------------------------------------------------------------
   Floating Network Banner
------------------------------------------------------------- */

function showNetworkBanner(message) {
  const existing = document.getElementById("networkBanner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "networkBanner";
  banner.className = "network-banner";
  banner.textContent = message;

  if (topBar && topBar.parentNode) {
    topBar.parentNode.insertBefore(banner, topBar.nextSibling);
  } else {
    document.body.prepend(banner);
  }

  setTimeout(() => {
    banner.classList.add("fade-out");
    setTimeout(() => banner.remove(), 300);
  }, 3000);
}

/* -------------------------------------------------------------
   Typing Indicator (emit only)
------------------------------------------------------------- */

let typingTimeout = null;

function sendTypingStart() {
  const peerId = getPeerIdFn?.();
  if (!peerId || !socketRef) return;

  socketRef.emit("typing:start", {
    from: getMyUserId(),
    to: peerId
  });
}

function sendTypingStop() {
  const peerId = getPeerIdFn?.();
  if (!peerId || !socketRef) return;

  socketRef.emit("typing:stop", {
    from: getMyUserId(),
    to: peerId
  });
}

msgInput?.addEventListener("input", () => {
  sendTypingStart();

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendTypingStop();
  }, 1200);
});

/* -------------------------------------------------------------
   Rich Input Parsing (text + GIF)
------------------------------------------------------------- */

function parseRichInput(rawInput) {
  const html = rawInput || "";

  const gifMatch = html.match(/<img[^>]+src="([^"]+\.gif)"[^>]*>/i);
  const gifUrl = gifMatch ? gifMatch[1] : null;

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  const text = tempDiv.textContent || tempDiv.innerText || "";
  const trimmedText = text.trim();

  return {
    text: trimmedText,
    gifUrl
  };
}

/* -------------------------------------------------------------
   TEXT MESSAGING (Node backend)
------------------------------------------------------------- */

export async function sendMessage(rawInput) {
  const peerId = getPeerIdFn?.();
  if (!peerId) return;

  const source = rawInput ?? (msgInput?.innerHTML ?? "");
  const { text, gifUrl } = parseRichInput(source);

  if (!text && !gifUrl) return;

  const payloadText = text || gifUrl || "";
  const isPureGif = !!gifUrl && !text;

  const optimistic = {
    id: null,
    sender_id: getMyUserId(),
    receiver_id: peerId,
    message: payloadText,
    type: isPureGif ? "gif" : "text",
    gifUrl: isPureGif ? gifUrl : null,
    created_at: new Date(),
    is_me: true
  };

  renderMessage(optimistic);
  scrollMessagesToBottom();

  if (!rawInput && msgInput) msgInput.innerHTML = "";

  try {
    const res = await fetch(
      "https://letsee-backend.onrender.com/api/messages/send",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver_id: peerId,
          message: payloadText,
          type: optimistic.type,
          gif_url: optimistic.gifUrl
        })
      }
    );

    const data = await res.json();
    if (!data.success) throw new Error("Message save failed");

    optimistic.id = data.id;
    optimistic.created_at = data.created_at;

    renderMessage(optimistic, true);

    socketRef?.emit("message:delivered", {
      messageId: data.id,
      from: getMyUserId(),
      to: peerId
    });
  } catch (err) {
    optimistic.error = true;
    renderMessage(optimistic, true);
    showError("Failed to send message");
  }
}

/* -------------------------------------------------------------
   FILE MESSAGING (Hybrid)
------------------------------------------------------------- */

export function sendFile(file) {
  if (!file) return;

  if (file.size <= P2P_MAX_SIZE) {
    sendFileViaP2P(file);
  } else {
    sendFileViaHTTP(file);
  }
}

/* -------------------------------------------------------------
   P2P File Transfer
------------------------------------------------------------- */

function sendFileViaP2P(file) {
  const peerId = getPeerIdFn?.();
  const dc = getDataChannelFn?.();

  if (!peerId || !dc || dc.readyState !== "open") {
    return sendFileViaHTTP(file);
  }

  const reader = new FileReader();
  reader.onload = () => {
    const arrayBuffer = reader.result;

    let bytesSent = 0;
    let lastTime = Date.now();
    let stalled = false;

    const CHUNK_SIZE = 16 * 1024;
    let offset = 0;

    function sendChunk() {
      if (offset >= arrayBuffer.byteLength) {
        finalizeP2PFile(file, peerId);
        return;
      }

      const now = Date.now();
      const elapsed = now - lastTime;

      if (elapsed > STALL_TIMEOUT) stalled = true;

      if (elapsed >= 1000) {
        const throughput = bytesSent / (elapsed / 1000);
        bytesSent = 0;
        lastTime = now;

        if (throughput < SLOW_NETWORK_THRESHOLD || stalled) {
          showNetworkBanner("⚠️ Network slow — switching to server upload");
          return sendFileViaHTTP(file);
        }
      }

      const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
      dc.send(chunk);

      offset += CHUNK_SIZE;
      bytesSent += chunk.byteLength;

      setTimeout(sendChunk, 0);
    }

    sendChunk();
  };

  reader.readAsArrayBuffer(file);
}

async function finalizeP2PFile(file, peerId) {
  try {
    const res = await fetch(
      "https://letsee-backend.onrender.com/api/messages/send",
      {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          receiver_id: peerId,
          message: `File: ${file.name}`,
          file: 1,
          filename: file.name,
          transport: "webrtc"
        }),
        headers: { "Content-Type": "application/json" }
      }
    );

    const data = await res.json();
    if (!data.success) throw new Error("P2P file save failed");

    renderMessage({
      id: data.id,
      is_me: true,
      type: "file",
      filename: file.name,
      url: data.url,
      created_at: data.created_at,
      sender_id: getMyUserId()
    });

    scrollMessagesToBottom();
  } catch (err) {
    showNetworkBanner("⚠️ P2P failed — uploading via server");
    sendFileViaHTTP(file);
  }
}

/* -------------------------------------------------------------
   HTTP File Upload
------------------------------------------------------------- */

async function sendFileViaHTTP(file) {
  const peerId = getPeerIdFn?.();
  if (!peerId) return;

  const fd = new FormData();
  fd.append("file", file);

  try {
    const uploadRes = await fetch(
      "https://letsee-backend.onrender.com/api/messages/upload",
      {
        method: "POST",
        credentials: "include",
        body: fd
      }
    );

    const uploadData = await uploadRes.json();
    if (!uploadData.success) throw new Error("Upload failed");

    const msgRes = await fetch(
      "https://letsee-backend.onrender.com/api/messages/send",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver_id: peerId,
          message: `File: ${file.name}`,
          file: 1,
          filename: file.name,
          file_url: uploadData.url,
          transport: "http"
        })
      }
    );

    const data = await msgRes.json();
    if (!data.success) throw new Error("Send failed");

    renderMessage({
      id: data.id,
      is_me: true,
      type: "file",
      filename: file.name,
      url: uploadData.url,
      created_at: data.created_at,
      sender_id: getMyUserId()
    });

    scrollMessagesToBottom();

    socketRef?.emit("message:delivered", {
      messageId: data.id,
      from: getMyUserId(),
      to: peerId
    });
  } catch (err) {
    showError("File upload failed");
  }
}

/* -------------------------------------------------------------
   Incoming Messages
------------------------------------------------------------- */

function handleIncomingMessage(data) {
  renderMessage(data);
  scrollMessagesToBottom();

  socketRef?.emit("message:read", {
    messageId: data.messageId,
    from: getMyUserId(),
    to: data.from
  });
}

/* -------------------------------------------------------------
   Init Messaging
------------------------------------------------------------- */

export function initMessaging(socket, getPeerId, getDataChannel) {
  socketRef = socket;
  getPeerIdFn = getPeerId;
  getDataChannelFn = getDataChannel;

  socket.on("message:incoming", handleIncomingMessage);

  socket.on("message:delivered", (data) => {
    renderMessage({ messageId: data.messageId, status: "delivered" }, true);
  });

  socket.on("message:read", (data) => {
    renderMessage({ messageId: data.messageId, status: "read" }, true);
  });

  // Typing UI is rendered in messaging.js; we only emit events here.
}

