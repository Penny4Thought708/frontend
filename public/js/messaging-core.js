// public/js/messaging-core.js
// -------------------------------------------------------------
// Messaging Core Module
// -------------------------------------------------------------
// Handles:
// - Text messaging (supports rich input / inline GIFs)
// - Hybrid file transfer (P2P DataChannel + HTTP fallback)
// - Slow-network detection (floating banner)
// - Delivered/read receipts
// - Typing indicators (emit only)
// - Incoming message handling
// - Integration with session.js + webrtc-client.js
// -------------------------------------------------------------

/* -------------------------------------------------------------
   Imports
------------------------------------------------------------- */

import {
  getMyUserId,
  msgInput,                // now expected to be a contenteditable element
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

// Works for both <input> and contenteditable
msgInput?.addEventListener("input", () => {
  sendTypingStart();

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendTypingStop();
  }, 1200);
});

/* -------------------------------------------------------------
   Helpers for rich input parsing
------------------------------------------------------------- */

/**
 * Extracts plain text and first GIF URL (if any) from rich HTML input.
 * - rawInput: string (can be plain text or HTML from contenteditable)
 */
function parseRichInput(rawInput) {
  const html = rawInput || "";

  // Extract first GIF URL from <img> tags (e.g. from Tenor)
  const gifMatch = html.match(/<img[^>]+src="([^"]+\.gif)"[^>]*>/i);
  const gifUrl = gifMatch ? gifMatch[1] : null;

  // Strip all HTML tags to get plain text
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
   Text Messaging (supports rich input + GIFs)
------------------------------------------------------------- */

/**
 * Send a message.
 * rawInput can be:
 * - plain text (from <input>.value)
 * - HTML string (from contenteditable.innerHTML)
 */
export function sendMessage(rawInput) {
  const peerId = getPeerIdFn?.();
  if (!peerId) return;

  // If caller passed nothing, fall back to current msgInput content
  const source = rawInput ?? (msgInput?.innerHTML ?? "");
  const { text, gifUrl } = parseRichInput(source);

  // Nothing to send
  if (!text && !gifUrl) return;

  // For backend compatibility, we still send a single "text" field:
  // - If only GIF: send the GIF URL as text
  // - If text + GIF: send the full text (GIF is just visual for now)
  const payloadText = text || gifUrl || "";
  const isPureGif = !!gifUrl && !text;

  const messageObj = {
    from: getMyUserId(),
    to: peerId,
    type: isPureGif ? "gif" : "text",
    text: payloadText,
    gifUrl: isPureGif ? gifUrl : null,
    timestamp: Date.now(),
    status: "sending"
  };

  // Render immediately (optimistic UI)
  renderMessage(messageObj);
  scrollMessagesToBottom();

  // Clear input if we own it
  if (!rawInput && msgInput) {
    msgInput.innerHTML = "";
  }

  // Send to server
  fetch("messages.php", {
    method: "POST",
    body: new URLSearchParams({
      from: getMyUserId(),
      to: peerId,
      text: payloadText
      // If you later extend backend, you can also send gifUrl/type here
      // gif: gifUrl || "",
      // type: isPureGif ? "gif" : "text"
    })
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) throw new Error("Message save failed");

      messageObj.status = "sent";
      messageObj.messageId = data.messageId;
      renderMessage(messageObj, true);

      socketRef?.emit("message:delivered", {
        messageId: data.messageId,
        from: getMyUserId(),
        to: peerId
      });
    })
    .catch(() => {
      messageObj.status = "error";
      renderMessage(messageObj, true);
      showError("Failed to send message");
    });
}

/* -------------------------------------------------------------
   File Messaging (Hybrid)
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
  const dataChannel = getDataChannelFn?.();

  if (!peerId || !dataChannel || dataChannel.readyState !== "open") {
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
      dataChannel.send(chunk);

      offset += CHUNK_SIZE;
      bytesSent += chunk.byteLength;

      setTimeout(sendChunk, 0);
    }

    sendChunk();
  };

  reader.readAsArrayBuffer(file);
}

function finalizeP2PFile(file, peerId) {
  fetch("messages.php", {
    method: "POST",
    body: new URLSearchParams({
      from: getMyUserId(),
      to: peerId,
      fileName: file.name,
      fileSize: file.size,
      p2p: "1"
    })
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) throw new Error("P2P file save failed");

      const messageObj = {
        from: getMyUserId(),
        to: peerId,
        type: "file",
        fileName: file.name,
        fileSize: file.size,
        url: data.url,
        timestamp: Date.now(),
        status: "sent",
        messageId: data.messageId
      };

      renderMessage(messageObj);
      scrollMessagesToBottom();
    })
    .catch(() => {
      showNetworkBanner("⚠️ P2P failed — uploading via server");
      sendFileViaHTTP(file);
    });
}

/* -------------------------------------------------------------
   HTTP File Upload
------------------------------------------------------------- */

function sendFileViaHTTP(file) {
  const peerId = getPeerIdFn?.();
  if (!peerId) return;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("from", getMyUserId());
  formData.append("to", peerId);

  fetch("upload.php", {
    method: "POST",
    body: formData
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) throw new Error("Upload failed");

      const messageObj = {
        from: getMyUserId(),
        to: peerId,
        type: "file",
        fileName: file.name,
        fileSize: file.size,
        url: data.url,
        timestamp: Date.now(),
        status: "sent",
        messageId: data.messageId
      };

      renderMessage(messageObj);
      scrollMessagesToBottom();

      socketRef?.emit("message:delivered", {
        messageId: data.messageId,
        from: getMyUserId(),
        to: peerId
      });
    })
    .catch(() => {
      showError("File upload failed");
    });
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
