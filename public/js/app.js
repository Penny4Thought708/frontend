// public/js/app.js
// -------------------------------------------------------
// Unified dashboard wiring: session + socket + messaging
// + contacts + call logs + voicemail + UI
// -------------------------------------------------------
if (window.__APP_ALREADY_LOADED__) {
  console.warn("[app] Duplicate app.js ignored");
} else {
  window.__APP_ALREADY_LOADED__ = true;
}

/*-------------------------------------------------------*/
// Imports
// -------------------------------------------------------
import {
  getMyUserId,
  getJson,
  postForm,
  getVoiceBtn,
  getVideoBtn,
} from "./session.js";
import { socket } from "./socket.js";
import { DEBUG } from "./debug.js";

// Messaging (new engine: pure logic in messaging.js)
import { setReceiver, loadMessages } from "./messaging.js";

// Contacts
import { loadContacts, openMessagesFor } from "./dashboard/contacts.js";

// Call logs
import { initCallLogs } from "./call-log.js";

// WebRTC (CallUI internally creates WebRTCController)
import { CallUI } from "./webrtc/CallUI.js";
import { WebRTCController } from "./webrtc/WebRTCController.js";

// Components
import "../components/ContactsMenu.js";

// Backend base
const API_BASE = "https://letsee-backend.onrender.com/api";

// -------------------------------------------------------
// Identity waiter
// -------------------------------------------------------
async function waitForIdentity() {
  while (!getMyUserId()) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

// -------------------------------------------------------
// Global GET helper
// -------------------------------------------------------
window.apiGet = async function (path) {
  const cleanPath = path.replace(".php", "");
  const url = cleanPath.startsWith("http")
    ? cleanPath
    : `${API_BASE}${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}`;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("Non-JSON response from", url, ":", text);
    throw new Error("Invalid JSON response");
  }
};

// -------------------------------------------------------
// Speaking detection
// -------------------------------------------------------
let speakingDetector = null;

function startSpeakingDetection(stream, wrapperEl) {
  stopSpeakingDetection();
  if (!stream || !wrapperEl) return;

  const avatarEl =
    wrapperEl.querySelector(".avatar") ||
    wrapperEl.querySelector("#localAvatar");
  if (!avatarEl) return;

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;

  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  const SPEAKING_THRESHOLD = 0.07;
  const SMOOTHING = 0.8;

  let smoothedLevel = 0;
  let rafId = null;

  const loop = () => {
    analyser.getByteFrequencyData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length / 255;

    smoothedLevel = SMOOTHING * smoothedLevel + (1 - SMOOTHING) * avg;

    if (smoothedLevel > SPEAKING_THRESHOLD) {
      avatarEl.classList.add("speaking");
    } else {
      avatarEl.classList.remove("speaking");
    }

    rafId = requestAnimationFrame(loop);
  };

  loop();

  speakingDetector = { audioCtx, avatarEl, rafId };
}

function stopSpeakingDetection() {
  if (!speakingDetector) return;
  const { audioCtx, rafId, avatarEl } = speakingDetector;

  if (rafId) cancelAnimationFrame(rafId);
  if (avatarEl) avatarEl.classList.remove("speaking");
  if (audioCtx && audioCtx.state !== "closed") {
    audioCtx.close().catch(() => {});
  }

  speakingDetector = null;
}

window.startSpeakingDetection = startSpeakingDetection;
window.stopSpeakingDetection = stopSpeakingDetection;

// -------------------------------------------------------
// Message list loader (Contacts panel → Messages section)
// -------------------------------------------------------
async function loadMessageList() {
  await waitForIdentity();

  const userId = getMyUserId();
  if (!userId) return;

  const list = document.getElementById("messaging_list");
  const header = document.getElementById("unread_header");

  if (!list || !header) return;

  list.innerHTML = "";
  header.textContent = "Messages";

  try {
    const res = await getJson(`${API_BASE}/messages/list`);
    const conversations = res.threads || [];

    conversations.forEach((conv) => {
      list.appendChild(buildMessageCard(conv));
    });
  } catch (err) {
    console.error("[loadMessageList] error:", err);
    header.textContent = "Failed to load messages";
  }
}

function buildMessageCard(conv) {
  const li = document.createElement("li");
  li.className = "message-card";

  const avatar = conv.contact_avatar
    ? `https://letsee-backend.onrender.com/uploads/avatars/${conv.contact_avatar}`
    : "img/defaultUser.png";

  li.innerHTML = `
    <div class="msg-avatar">
      <img src="${avatar}">
    </div>

    <div class="msg-info">
      <div class="msg-top">
        <div class="msg-name">${conv.contact_name || "Unknown"}</div>
        <div class="msg-time">${conv.last_message_at || ""}</div>
      </div>
      <div class="msg-bottom">
        <div class="msg-preview">${(conv.last_message || "")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</div>
      </div>
    </div>
  `;

  li.addEventListener("click", () => {
    openMessagesFor({
      contact_id: conv.contact_id,
      contact_name: conv.contact_name,
      contact_avatar: conv.contact_avatar,
    });
  });

  return li;
}

// -------------------------------------------------------
// Intro tour
// -------------------------------------------------------
function startIntroTour() {
  const steps = [
    {
      element: "#btn_search",
      text: "Use Search to find local help, resources, and contacts instantly.",
      arrow: "right",
    },
    {
      element: "#btn_chat_main",
      text: "Start a chat with anyone in your contacts.",
      arrow: "right",
    },
    {
      element: "#contact_widget",
      text: "View and manage your contacts, call log, and voicemail here.",
      arrow: "right",
    },
    {
      element: "#btn_notifications",
      text: "Check your notifications — messages, calls, alerts.",
      arrow: "right",
    },
    {
      element: "#btn_settings",
      text: "Customize your settings and preferences.",
      arrow: "right",
    },
    {
      element: "#toggleBtn",
      text: "Switch between light and dark themes.",
      arrow: "right",
    },
    {
      element: "#btn_help",
      text: "Need help? Open the help center anytime.",
      arrow: "right",
    },
  ];

  const introBox = document.getElementById("introduction");
  const arrow = document.getElementById("intro_arrow");

  if (!introBox || !arrow) return;

  let index = 0;

  function showStep(i) {
    const step = steps[i];
    const target = document.querySelector(step.element);
    if (!target) return;

    const rect = target.getBoundingClientRect();

    introBox.style.display = "block";
    introBox.innerHTML = step.text;

    introBox.style.top = rect.top + "px";
    introBox.style.left = rect.right + 20 + "px";

    arrow.style.display = "block";
    arrow.className = "intro-arrow " + step.arrow;
    arrow.style.top = rect.top + rect.height / 2 - 10 + "px";
    arrow.style.left = rect.right + "px";
  }

  function nextStep() {
    if (index < steps.length) {
      showStep(index);
      index++;
    } else {
      introBox.style.display = "none";
      arrow.style.display = "none";
      localStorage.setItem("tourCompleted", "true");
    }
  }

  introBox.addEventListener("click", nextStep);
  nextStep();
}

window.addEventListener("DOMContentLoaded", () => {
  if (!localStorage.getItem("tourCompleted")) {
    setTimeout(startIntroTour, 300);
  }
});

// -------------------------------------------------------
// Notification helper
// -------------------------------------------------------
window.showNotification = function (title, message) {
  const container = document.getElementById("notification_container");
  if (!container) return;

  const note = document.createElement("div");
  note.className = "notification";

  note.innerHTML = `
    <div class="title">${title}</div>
    <div class="body">${message}</div>
  `;

  container.appendChild(note);

  setTimeout(() => note.classList.add("show"), 10);

  setTimeout(() => {
    note.classList.remove("show");
    setTimeout(() => note.remove(), 400);
  }, 5000);

  note.addEventListener("click", () => {
    note.classList.remove("show");
    setTimeout(() => note.remove(), 400);
  });
};

// -------------------------------------------------------
// Content menu initialization (ContactsMenu → main sections)
// -------------------------------------------------------
function initContentMenu() {
  const menu = document.querySelector("contacts-menu");
  if (!menu) return;

  let showingContacts = false;

  function forceChildrenDisplay(container) {
    if (!container) return;
    const elements = container.querySelectorAll("*");
    elements.forEach((el) => {
      if (window.getComputedStyle(el).display === "none") {
        el.style.display = "block";
      }
    });
  }

  function hideAll() {
    const sav = document.querySelector("#sav_con");
    const bl = document.querySelector("#bl_con");
    const vm = document.querySelector("#voicemail_list");
    const msg = document.querySelector("#messaging_box");

    if (sav) sav.style.display = "none";
    if (bl) bl.style.display = "none";
    if (vm) vm.style.display = "none";
    if (msg) msg.style.display = "none";
  }

  function updateContactsButton() {
    const btn = menu.querySelector("#toggle_Btn");
    if (!btn) return;

    if (showingContacts) {
      btn.innerHTML = `<img src="calllog.png" alt="call-log"> Call Log`;
    } else {
      btn.innerHTML = `<img src="Contacts.png" alt="contacts"> Contacts`;
    }
  }

  // Initial state: show call log
  hideAll();
  const sav = document.querySelector("#sav_con");
  if (sav) {
    sav.style.display = "block";
    forceChildrenDisplay(sav);
  }
  updateContactsButton();

  // Handle menu actions
  menu.addEventListener("menu-select", (e) => {
    const action = e.detail.action;
    hideAll();

    switch (action) {
      case "contacts":
        showingContacts = !showingContacts;
        updateContactsButton();

        if (showingContacts) {
          const c = document.querySelector("#bl_con");
          if (c) {
            c.style.display = "block";
            forceChildrenDisplay(c);
          }
        } else {
          const c = document.querySelector("#sav_con");
          if (c) {
            c.style.display = "block";
            forceChildrenDisplay(c);
          }
        }
        break;

      case "messages": {
        const msg = document.querySelector("#messaging_box");
        if (msg) {
          msg.style.display = "block";
          forceChildrenDisplay(msg);
        }
        break;
      }

      case "voicemail": {
        const vm = document.querySelector("#voicemail_list");
        if (vm) {
          vm.style.display = "block";
          forceChildrenDisplay(vm);
        }
        break;
      }

      case "hidden":
        window.showNotification(
          "Hidden Messages",
          "Hidden messages view not implemented yet."
        );
        break;

      case "dnd":
        // DND handled separately in initDndFromContactsMenu()
        break;

      default:
        break;
    }
  });
}

/* -------------------------------------------------------
   Bottom sheet + emoji + GIF (UI only, no sending)
------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const plusBtn = document.getElementById("plusBtn");
  const bottomSheet = document.getElementById("bottomSheet");

  const sheetCamera = document.getElementById("sheetCamera");
  const sheetGallery = document.getElementById("sheetGallery");
  const sheetFile = document.getElementById("sheetFile");
  const sheetAudio = document.getElementById("sheetAudio");
  const sheetEmoji = document.getElementById("sheetEmoji");
  const sheetGif = document.getElementById("sheetGif");

  const emojiPicker = document.getElementById("emojiPicker");
  const gifPicker = document.getElementById("gifPicker");
  const gifSearch = document.getElementById("gifSearch");
  const gifResults = document.getElementById("gifResults");

  const messageInput = document.getElementById("message_input");
  const attachmentInput = document.getElementById("attachment_input");
  const micBtn = document.getElementById("micBtn");

  const backdrop = document.getElementById("pickerBackdrop");

  window.micBtn = micBtn;

  if (!messageInput) return;

  /* -------------------------------------------------------
     BACKDROP CONTROL
  ------------------------------------------------------- */
  function showBackdrop() {
    backdrop.classList.remove("hidden");
    requestAnimationFrame(() => backdrop.classList.add("show"));
  }

  function hideBackdrop() {
    backdrop.classList.remove("show");
    setTimeout(() => backdrop.classList.add("hidden"), 200);
  }

  /* -------------------------------------------------------
     CLOSE EVERYTHING
  ------------------------------------------------------- */
  const closeAll = () => {
    bottomSheet?.classList.remove("visible");
    emojiPicker?.classList.add("hidden");
    gifPicker?.classList.add("hidden");
    hideBackdrop();
  };

  /* -------------------------------------------------------
     CARET POSITIONING
  ------------------------------------------------------- */
  const moveCaretToEnd = (el) => {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  /* -------------------------------------------------------
     PLUS BUTTON
  ------------------------------------------------------- */
  plusBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPicker?.classList.add("hidden");
    gifPicker?.classList.add("hidden");

    const isOpening = !bottomSheet.classList.contains("visible");
    bottomSheet?.classList.toggle("visible");

    if (isOpening) showBackdrop();
    else hideBackdrop();
  });

  /* -------------------------------------------------------
     CLICK OUTSIDE TO CLOSE
  ------------------------------------------------------- */
  document.addEventListener("click", (e) => {
    const target = e.target;

    const clickedInsideSheet = bottomSheet?.contains(target);
    const clickedPlus = target === plusBtn;
    const clickedEmojiShadow =
      target.closest && target.closest("emoji-picker") !== null;
    const clickedGifPicker = gifPicker?.contains(target);

    if (
      !clickedInsideSheet &&
      !clickedPlus &&
      !clickedEmojiShadow &&
      !clickedGifPicker
    ) {
      closeAll();
    }
  });

  /* -------------------------------------------------------
     SHEET ACTIONS
  ------------------------------------------------------- */
  sheetCamera?.addEventListener("click", () => {
    closeAll();
  });

  sheetGallery?.addEventListener("click", () => {
    closeAll();
    attachmentInput?.click();
  });

  sheetFile?.addEventListener("click", () => {
    closeAll();
    attachmentInput?.click();
  });

  sheetAudio?.addEventListener("click", () => {
    closeAll();
    micBtn?.click();
  });

  /* -------------------------------------------------------
     EMOJI PICKER
  ------------------------------------------------------- */
  sheetEmoji?.addEventListener("click", (e) => {
    e.stopPropagation();
    bottomSheet?.classList.remove("visible");
    gifPicker?.classList.add("hidden");

    const isOpening = emojiPicker.classList.contains("hidden") === true;
    emojiPicker?.classList.toggle("hidden");

    if (isOpening) showBackdrop();
    else hideBackdrop();
  });

  emojiPicker?.addEventListener("emoji-click", (event) => {
    const emoji = event.detail.unicode;
    messageInput.innerHTML += emoji;
    moveCaretToEnd(messageInput);
    messageInput.focus();
  });

  /* -------------------------------------------------------
     GIF PICKER
  ------------------------------------------------------- */
  sheetGif?.addEventListener("click", (e) => {
    e.stopPropagation();
    bottomSheet?.classList.remove("visible");
    emojiPicker?.classList.add("hidden");

    const isOpening = gifPicker.classList.contains("hidden") === true;
    gifPicker?.classList.toggle("hidden");

    if (isOpening) showBackdrop();
    else hideBackdrop();

    loadTrendingGIFs();
  });

  const TENOR_KEY = "AIzaSyDbjrFx19WFXQCu-IoFxjbju8WaG5E8phA";
  const TENOR_TRENDING = `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&limit=30`;
  const TENOR_SEARCH = (q) =>
    `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(
      q
    )}&key=${TENOR_KEY}&limit=30`;

  async function loadTrendingGIFs() {
    if (!gifResults) return;
    try {
      const res = await fetch(TENOR_TRENDING);
      if (!res.ok) return;
      const data = await res.json();
      renderGIFs(data.results || []);
    } catch (err) {
      console.error("[GIF] trending error:", err);
    }
  }

  async function searchGIFs(query) {
    if (!gifResults) return;
    try {
      const url = TENOR_SEARCH(query);
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      renderGIFs(data.results || []);
    } catch (err) {
      console.error("[GIF] search error:", err);
    }
  }
function renderGIFs(gifs) {
  if (!gifResults) return;
  gifResults.innerHTML = "";

  gifs.forEach((gif) => {
    const url =
      gif?.media_formats?.tinygif?.url || gif?.media_formats?.gif?.url;
    if (!url) return;

    const img = document.createElement("img");
    img.src = url;
    img.alt = "GIF";

    img.onload = () => img.classList.add("loaded");

    img.addEventListener("click", () => {
      messageInput.innerHTML += `<img src="${url}" class="gif-inline">`;
      moveCaretToEnd(messageInput);
      messageInput.focus();
      gifPicker?.classList.add("hidden");
      hideBackdrop();
    });

    gifResults.appendChild(img);
  });
}

gifSearch?.addEventListener("input", (e) => {
  const q = e.target.value.trim();
  if (!q) loadTrendingGIFs();
  else searchGIFs(q);
});
});

/* -------------------------------------------------------
   Bootstrap
------------------------------------------------------- */
socket.on("connect", async () => {
  console.log("[bootstrap] Socket connected:", socket.id);

  await waitForIdentity();
  await loadContacts();

  // -------------------------------------------------------
  // Create WebRTCController FIRST
  // Then pass it into CallUI (correct constructor)
  // -------------------------------------------------------
  const controller = new WebRTCController(socket);
  const callUI = new CallUI(controller);

  // 🔔 Inbound call from backend → open call window
  socket.on("call:start", ({ from, type }) => {
    const isVideo = type === "video";
    callUI.receiveInboundCall(from, isVideo);
  });

  initCallLogs({ socket });
  loadMessageList();

  // NEW voicemail system handles loading itself (VoicemailUI.js)
  // ❌ old loadVoicemails() removed

  // -------------------------------------------------------
  // Open chat for a given contactId using new messaging.js
  // -------------------------------------------------------
  window.openChat = async function (contactId) {
    window.currentChatUserId = contactId;
    setReceiver(contactId);

    const panel = document.getElementById("messaging_box");
    if (panel) {
      panel.style.display = "block";
      panel.classList.remove("hidden");
    }

    const miniBubble = document.getElementById("miniChatBubble");
    if (miniBubble) miniBubble.style.display = "none";

    await loadMessages();
  };

  // -------------------------------------------------------
  // Wire voice/video buttons in the messaging header
  // -------------------------------------------------------
  const voiceBtn = getVoiceBtn();
  const videoBtn = getVideoBtn();

  if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
      const peerId = window.currentChatUserId;
      if (!peerId) return;

      // Mobile → iOS voice UI
      // Desktop → Meet audio-only
      const mode = callUI._isMobile() ? "ios-voice" : "meet";

      callUI.openForOutgoing(peerId, {
        audio: true,
        video: false,
        mode
      });
    });
  }

  if (videoBtn) {
    videoBtn.addEventListener("click", () => {
      const peerId = window.currentChatUserId;
      if (!peerId) return;

      // Video calls always use Meet UI
      callUI.openForOutgoing(peerId, {
        audio: true,
        video: true,
        mode: "meet"
      });
    });
  }

  // -------------------------------------------------------
  // Contacts menu + DND
  // -------------------------------------------------------
  initContentMenu();
  initDndFromContactsMenu?.();

  // -------------------------------------------------------
  // Expose globally for debugging + voicemail callbacks
  // -------------------------------------------------------
  window.callUI = callUI;
  window.rtc = controller;
});



































































