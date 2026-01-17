// messaging.js – clean, modern, Node-only, production-ready

// ------------------------------------------------------
// Basic state
// ------------------------------------------------------
let currentContactId = null;
let messagesById = new Map();
let pendingFiles = [];
let isTyping = false;
let typingTimeout = null;
let isRecording = false;
let recordingMediaRecorder = null;
let recordingChunks = [];
let recordingStream = null;

// ------------------------------------------------------
// DOM references
// ------------------------------------------------------
const messagesContainer = document.getElementById("messagesContainer");
const msgForm = document.getElementById("msgForm");
const msgInput = document.getElementById("msgInput");
const attachmentInput = document.getElementById("attachmentInput");
const dropZone = document.getElementById("dropZone");
const typingIndicator = document.getElementById("typingIndicator");
const recordingIndicator = document.getElementById("recordingIndicator");
const hiddenMessagesPanel = document.getElementById("hiddenMessagesPanel");
const imageViewer = document.getElementById("imageViewer");
const imageViewerImg = imageViewer ? imageViewer.querySelector("img") : null;
const imageViewerClose = imageViewer ? imageViewer.querySelector(".viewer-close") : null;

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------
function getMyUserId() {
  return window.sessionUserId || null;
}
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function smartScroll() {
  if (!messagesContainer) return;
  const nearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 200;
  if (nearBottom) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
function createEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function isMe(msg) {
  return String(msg.sender_id) === String(getMyUserId());
}
function setTypingIndicator(active, fromId) {
  if (!typingIndicator) return;
  if (!active) {
    typingIndicator.style.display = "none";
    return;
  }
  if (String(fromId) === String(getMyUserId())) return;
  typingIndicator.style.display = "block";
}
function setRecordingIndicator(active, fromId) {
  if (!recordingIndicator) return;
  if (!active) {
    recordingIndicator.style.display = "none";
    return;
  }
  if (String(fromId) === String(getMyUserId())) return;
  recordingIndicator.style.display = "block";
}
function clearPendingFiles() {
  pendingFiles = [];
  if (attachmentInput) attachmentInput.value = "";
}
function showImageViewer(url) {
  if (!imageViewer || !imageViewerImg) return;
  imageViewerImg.src = url;
  imageViewer.classList.add("open");
}
if (imageViewerClose && imageViewer) {
  imageViewerClose.addEventListener("click", () => imageViewer.classList.remove("open"));
  imageViewer.addEventListener("click", e => {
    if (e.target === imageViewer) imageViewer.classList.remove("open");
  });
}

// ------------------------------------------------------
// Render message + reactions
// ------------------------------------------------------
function renderReactionsForMessage(msgId, reactions) {
  const msgEl = messagesContainer.querySelector(`.message[data-msg-id="${msgId}"]`);
  if (!msgEl) return;
  let bar = msgEl.querySelector(".reaction-bar");
  if (!reactions || !reactions.length) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = createEl("div", "reaction-bar");
    msgEl.appendChild(bar);
  }
  bar.innerHTML = "";
  reactions.forEach(r => {
    const btn = createEl("button", "reaction-pill", `${r.emoji} ${r.count}`);
    btn.dataset.emoji = r.emoji;
    btn.addEventListener("click", () => toggleReaction(msgId, r.emoji));
    bar.appendChild(btn);
  });
}
function renderMessage(msg, { prepend = false } = {}) {
  if (!messagesContainer || !msg) return;
  if (!msg.id) msg.id = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  messagesById.set(String(msg.id), msg);

  let msgEl = messagesContainer.querySelector(`.message[data-msg-id="${msg.id}"]`);
  if (!msgEl) {
    msgEl = createEl("div", "message");
    msgEl.dataset.msgId = msg.id;
    msgEl.dataset.senderId = msg.sender_id;
  } else {
    msgEl.innerHTML = "";
  }

  const bubbleCls = isMe(msg) ? "bubble me" : "bubble them";
  const bubble = createEl("div", bubbleCls);
  const content = createEl("div", "content");

  if (msg.deleted) {
    content.textContent = "Message deleted";
    bubble.classList.add("deleted");
  } else if (msg.type === "file" && Array.isArray(msg.files) && msg.files.length) {
    msg.files.forEach(f => {
      const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name || f.url || "");
      if (isImage) {
        const img = createEl("img", "msg-image");
        img.src = f.url;
        img.alt = f.name || "";
        img.addEventListener("click", () => showImageViewer(f.url));
        content.appendChild(img);
      } else {
        const link = createEl("a", "msg-file", f.name || "file");
        link.href = f.url;
        link.target = "_blank";
        content.appendChild(link);
      }
    });
    if (msg.message) {
      const caption = createEl("p", "msg-caption", msg.message);
      content.appendChild(caption);
    }
  } else if (msg.type === "audio" && msg.audio_url) {
    const audio = createEl("audio", "msg-audio");
    audio.controls = true;
    audio.src = msg.audio_url;
    content.appendChild(audio);
    if (msg.message) {
      const caption = createEl("p", "msg-caption", msg.message);
      content.appendChild(caption);
    }
  } else {
    const p = createEl("p", "msg-text", msg.message || "");
    content.appendChild(p);
  }

  bubble.appendChild(content);

  if (!msg.deleted) {
    const actions = createEl("div", "msg-actions");
    const reactBtn = createEl("button", "msg-action react", "😊");
    reactBtn.addEventListener("click", () => toggleReaction(msg.id, "👍"));
    actions.appendChild(reactBtn);

    if (isMe(msg)) {
      const delBtn = createEl("button", "msg-action delete", "🗑");
      delBtn.addEventListener("click", () => deleteMessage(msg.id));
      actions.appendChild(delBtn);
    }

    bubble.appendChild(actions);
  }

  const meta = createEl("div", "msg-meta");
  const time = createEl("span", "msg-time", formatTime(msg.created_at || Date.now()));
  meta.appendChild(time);

  if (isMe(msg)) {
    const status = createEl("span", "msg-status");
    status.textContent = msg.read_at ? "Read" : msg.delivered_at ? "Delivered" : "Sent";
    meta.appendChild(status);
  }

  msgEl.appendChild(bubble);
  msgEl.appendChild(meta);

  if (prepend) messagesContainer.prepend(msgEl);
  else messagesContainer.appendChild(msgEl);

  if (msg.id && Array.isArray(msg.reactions)) {
    renderReactionsForMessage(msg.id, msg.reactions);
  }

  smartScroll();
}

// ------------------------------------------------------
// Read receipts (IntersectionObserver)
// ------------------------------------------------------
let readObserver = null;
function observeMessagesForRead() {
  if (!messagesContainer) return;
  if (readObserver) readObserver.disconnect();
  readObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const msgId = el.dataset.msgId;
      const msg = messagesById.get(String(msgId));
      if (!msg || isMe(msg) || msg.read_at) return;
      markMessageRead(msgId);
    });
  }, { root: messagesContainer, threshold: 0.6 });
  messagesContainer.querySelectorAll(".message").forEach(el => readObserver.observe(el));
}
function markMessageRead(msgId) {
  const msg = messagesById.get(String(msgId));
  if (!msg || msg.read_at) return;
  fetch("/messages/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId: msgId })
  }).catch(() => {});
}

// ------------------------------------------------------
// Load thread
// ------------------------------------------------------
export function loadThread(contactId) {
  currentContactId = contactId;
  messagesById.clear();
  if (messagesContainer) messagesContainer.innerHTML = "";
  try {
    const res = await fetch(`/messages/thread?contactId=${encodeURIComponent(contactId)}`);
    const data = await res.json();
    if (Array.isArray(data.messages)) {
      data.messages.forEach(m => renderMessage(m, { prepend: false }));
      observeMessagesForRead();
    }
  } catch (e) {
    console.error(" error", e);
  }
}

// ------------------------------------------------------
// Send message (text + files)
// ------------------------------------------------------
async function uploadFiles(files) {
  if (!files || !files.length) return [];
  const fd = new FormData();
  files.forEach(f => fd.append("files[]", f));
  const res = await fetch("/messages/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (data && data.success && Array.isArray(data.files)) return data.files;
  return [];
}
async function sendMessage(text, files = []) {
  if (!currentContactId) return;
  const trimmed = (text || "").trim();
  if (!trimmed && (!files || !files.length)) return;

  const uploaded = await uploadFiles(files);
  const payload = {
    receiver_id: currentContactId,
    message: trimmed || "",
    files: uploaded,
    type: uploaded.length ? "file" : "text"
  };

  try {
    const res = await fetch("/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data && data.success && data.message) {
      renderMessage(data.message);
      observeMessagesForRead();
    } else {
      const localMsg = {
        id: `local-${Date.now()}`,
        sender_id: getMyUserId(),
        receiver_id: currentContactId,
        message: trimmed,
        files: uploaded,
        type: payload.type,
        created_at: Date.now()
      };
      renderMessage(localMsg);
      observeMessagesForRead();
    }
  } catch (e) {
    console.error("sendMessage error", e);
  }
}

// ------------------------------------------------------
// Form + attachments
// ------------------------------------------------------
if (msgForm && msgInput) {
  msgForm.addEventListener("submit", async e => {
    e.preventDefault();
    const text = msgInput.value;
    const files = [...pendingFiles];
    msgInput.value = "";
    clearPendingFiles();
    await sendMessage(text, files);
    emitTyping(false);
  });
}
if (attachmentInput) {
  attachmentInput.addEventListener("change", e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    pendingFiles.push(...files);
  });
}

// ------------------------------------------------------
// Drag & drop
// ------------------------------------------------------
if (dropZone && messagesContainer) {
  ["dragenter", "dragover"].forEach(ev => {
    messagesContainer.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.add("active");
    });
  });
  ["dragleave", "drop"].forEach(ev => {
    messagesContainer.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.remove("active");
    });
  });
  messagesContainer.addEventListener("drop", e => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    pendingFiles.push(...files);
  });
}

// ------------------------------------------------------
// Typing indicator (outgoing)
// ------------------------------------------------------
function emitTyping(active) {
  if (!socket || !currentContactId) return;
  socket.emit(active ? "typing:start" : "typing:stop", {
    to: currentContactId,
    from: getMyUserId()
  });
}
if (msgInput) {
  msgInput.addEventListener("input", () => {
    if (!currentContactId) return;
    if (!isTyping) {
      isTyping = true;
      emitTyping(true);
    }
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      emitTyping(false);
    }, 1500);
  });
}

// ------------------------------------------------------
// Recording (outgoing)
// ------------------------------------------------------
function emitRecording(active) {
  if (!socket || !currentContactId) return;
  socket.emit(active ? "recording:start" : "recording:stop", {
    to: currentContactId,
    from: getMyUserId()
  });
}
async function startRecording() {
  if (isRecording) return;
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingMediaRecorder = new MediaRecorder(recordingStream);
    recordingChunks = [];
    recordingMediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    };
    recordingMediaRecorder.onstop = () => {
      const blob = new Blob(recordingChunks, { type: "audio/webm" });
      sendAudioMessage(blob);
      if (recordingStream) {
        recordingStream.getTracks().forEach(t => t.stop());
        recordingStream = null;
      }
    };
    recordingMediaRecorder.start();
    isRecording = true;
    emitRecording(true);
  } catch (e) {
    console.error("startRecording error", e);
  }
}
function stopRecording() {
  if (!isRecording || !recordingMediaRecorder) return;
  recordingMediaRecorder.stop();
  isRecording = false;
  emitRecording(false);
}
async function sendAudioMessage(blob) {
  if (!currentContactId || !blob) return;
  const fd = new FormData();
  fd.append("audio", blob, `audio-${Date.now()}.webm`);
  try {
    const res = await fetch("/messages/audio", { method: "POST", body: fd });
    const data = await res.json();
    if (data && data.success && data.url) {
      const payload = {
        receiver_id: currentContactId,
        type: "audio",
        audio_url: data.url,
        message: ""
      };
      const res2 = await fetch("/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data2 = await res2.json();
      if (data2 && data2.success && data2.message) {
        renderMessage(data2.message);
        observeMessagesForRead();
      }
    }
  } catch (e) {
    console.error("sendAudioMessage error", e);
  }
}

// ------------------------------------------------------
// Reactions
// ------------------------------------------------------
function toggleReaction(msgId, emoji) {
  if (!socket) return;
  socket.emit("message:reaction", {
    messageId: msgId,
    emoji,
    userId: getMyUserId()
  });
}

// ------------------------------------------------------
// Delete / undo / restore
// ------------------------------------------------------
function deleteMessage(msgId) {
  if (!socket) return;
  socket.emit("message:delete", { messageId: msgId, userId: getMyUserId() });
}
function applyDelete(msgId) {
  const msg = messagesById.get(String(msgId));
  if (!msg) return;
  msg.deleted = true;
  renderMessage(msg);
}

// ------------------------------------------------------
// Presence / status
// ------------------------------------------------------
function updateStatusUI(payload) {
  // payload: { userId, status, lastSeen }
  // hook into your existing presence UI here
}

// ------------------------------------------------------
// Hidden messages panel (simple toggle)
// ------------------------------------------------------
if (hiddenMessagesPanel) {
  const toggleHiddenBtn = document.getElementById("toggleHiddenMessages");
  if (toggleHiddenBtn) {
    toggleHiddenBtn.addEventListener("click", () => {
      hiddenMessagesPanel.classList.toggle("open");
    });
  }
}

// ------------------------------------------------------
// Socket handlers
// ------------------------------------------------------
if (typeof socket !== "undefined" && socket) {
  socket.on("message:new", msg => {
    if (!currentContactId) return;
    if (String(msg.sender_id) !== String(currentContactId) && String(msg.receiver_id) !== String(currentContactId)) return;
    renderMessage(msg);
    observeMessagesForRead();
  });

  socket.on("message:reaction", payload => {
    const { messageId, reactions } = payload;
    const msg = messagesById.get(String(messageId));
    if (!msg) return;
    msg.reactions = reactions || [];
    renderReactionsForMessage(messageId, msg.reactions);
  });

  socket.on("message:audio", msg => {
    if (!currentContactId) return;
    if (String(msg.sender_id) !== String(currentContactId) && String(msg.receiver_id) !== String(currentContactId)) return;
    renderMessage(msg);
    observeMessagesForRead();
  });

  socket.on("typing:start", payload => {
    if (!currentContactId) return;
    if (String(payload.from) !== String(currentContactId)) return;
    setTypingIndicator(true, payload.from);
  });
  socket.on("typing:stop", payload => {
    if (!currentContactId) return;
    if (String(payload.from) !== String(currentContactId)) return;
    setTypingIndicator(false, payload.from);
  });

  socket.on("recording:start", payload => {
    if (!currentContactId) return;
    if (String(payload.from) !== String(currentContactId)) return;
    setRecordingIndicator(true, payload.from);
  });
  socket.on("recording:stop", payload => {
    if (!currentContactId) return;
    if (String(payload.from) !== String(currentContactId)) return;
    setRecordingIndicator(false, payload.from);
  });

  socket.on("statusUpdate", payload => {
    updateStatusUI(payload);
  });

  socket.on("message:delete", payload => {
    applyDelete(payload.messageId);
  });
}

// ------------------------------------------------------
// Public API (if you want to call from outside)
// ------------------------------------------------------
window.Messaging = {
  loadThread,
  sendMessage,
  startRecording,
  stopRecording,
  sendAudioMessage
};











