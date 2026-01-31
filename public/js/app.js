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

// -------------------------------------------------------
// Imports
// -------------------------------------------------------
import { getMyUserId, getJson } from "./session.js";
import { socket } from "./socket.js";
import { DEBUG } from "./debug.js";

// Messaging engine + UI
import { MessagingEngine } from "./messaging/MessagingEngine.js";
import { renderMessages, renderIncomingMessage } from "./messaging/MessageUI.js";
import "./messaging/TypingUI.js";

// Contacts
import { loadContacts, openMessagesFor } from "./dashboard/contacts.js";

// Call logs
import { initCallLogs } from "./call-log.js";

// WebRTC
import { WebRTCController } from "./webrtc/WebRTCController.js";
import { initCallUI } from "./webrtc/CallUI.js";

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
// Message list loader
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
// Voicemail loader + UI
// -------------------------------------------------------
async function loadVoicemails() {
  await waitForIdentity();

  const userId = getMyUserId();
  if (!userId) return;

  try {
    const res = await getJson(`${API_BASE}/voicemail/list`);
    const data = res || {};

    const listEl = document.getElementById("voiceMList");
    if (!listEl) return;

    listEl.innerHTML = "";

    if (!data.success || !Array.isArray(data.voicemails)) {
      updateVoicemailBadge(0);
      return;
    }

    let unreadCount = 0;

    data.voicemails.forEach((vm) => {
      if (vm.listened === 0) unreadCount++;
      renderVoicemail(vm);
    });

    updateVoicemailBadge(unreadCount);
  } catch (err) {
    console.error("loadVoicemails error:", err);
  }
}

socket.on("voicemail:new", (vm) => {
  renderVoicemail(vm);
  incrementVoicemailBadge();
  showVoicemailToast(vm);
});

// -------------------------------------------------------
// Voicemail item renderer
// -------------------------------------------------------
function isDarkMode() {
  return document.documentElement.classList.contains("dark");
}

function renderVoicemail(vm) {
  const listEl = document.getElementById("voiceMList");
  if (!listEl) return;

  const li = document.createElement("li");
  li.classList.add("voicemail-item");
  if (vm.listened === 0) li.classList.add("unheard");

  const isMissedCall = vm.audio_url === null;

  li.innerHTML = `
    <div class="vm-header">
      <strong>From: ${vm.from_id}</strong>
      <span>${vm.timestamp ? new Date(vm.timestamp).toLocaleString() : ""}</span>
    </div>

    ${
      isMissedCall
        ? `<p class="missed-call">Missed call while in DND</p>`
        : `
        <div class="waveform-container">
          <button class="wave-play">▶</button>
          <div class="waveform" id="waveform-${vm.id}"></div>
          <select class="wave-speed">
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <button class="wave-download">Download</button>
        </div>
      `
    }

    ${vm.transcript ? `<p class="vm-transcript">${vm.transcript}</p>` : ""}

    <div class="vm-actions">
      <button class="mark-listened">Mark as listened</button>
      <button class="call-back">Call back</button>
      <button class="delete-voicemail">Delete</button>
    </div>
  `;

  if (!isMissedCall && typeof WaveSurfer !== "undefined") {
    const dark = isDarkMode();

    const waveform = WaveSurfer.create({
      container: `#waveform-${vm.id}`,
      waveColor: dark ? "#777777" : "#999",
      progressColor: dark ? "#4da3ff" : "#007aff",
      cursorColor: dark ? "#ffffff" : "#000000",
      cursorWidth: 2,
      height: 48,
      barWidth: 2,
      barGap: 2,
      responsive: true,
      normalize: true,
    });

    if (vm.peaks && Array.isArray(vm.peaks)) {
      waveform.load(vm.audio_url, vm.peaks);
    } else {
      waveform.load(vm.audio_url);
    }

    const playBtn = li.querySelector(".wave-play");
    const speedSelect = li.querySelector(".wave-speed");
    const downloadBtn = li.querySelector(".wave-download");

    playBtn.onclick = () => {
      if (waveform.isPlaying()) {
        waveform.pause();
        playBtn.textContent = "▶";
      } else {
        waveform.play();
        playBtn.textContent = "⏸";
      }
    };

    speedSelect.onchange = () => {
      waveform.setPlaybackRate(parseFloat(speedSelect.value));
    };

    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = vm.audio_url;
      a.download = `voicemail-${vm.id}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
  }

  li.querySelector(".mark-listened").onclick = async () => {
    try {
      await fetch(`${API_BASE}/voicemail/listened`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: vm.id }),
      });

      li.classList.remove("unheard");
      decrementVoicemailBadge();
    } catch (err) {
      console.error("mark-listened error:", err);
    }
  };

  li.querySelector(".call-back").onclick = () => {
    socket.emit("call:start", { to: vm.from_id });
  };

  li.querySelector(".delete-voicemail").onclick = async () => {
    try {
      await fetch(`${API_BASE}/voicemail/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: vm.id }),
      });

      li.remove();
      decrementVoicemailBadge();
    } catch (err) {
      console.error("voicemail delete error:", err);
    }
  };

  let startX = 0;

  li.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
  });

  li.addEventListener("touchmove", (e) => {
    const diff = e.touches[0].clientX - startX;
    if (diff < -50) {
      li.classList.add("swipe-delete");
      setTimeout(() => li.querySelector(".delete-voicemail").click(), 200);
    }
  });

  listEl.appendChild(li);
}

// -------------------------------------------------------
// Voicemail badge + toast
// -------------------------------------------------------
function updateVoicemailBadge(count) {
  const badge = document.getElementById("voicemailBadge");
  if (!badge) return;

  badge.textContent = count;
  badge.style.display = count > 0 ? "inline-block" : "none";
}

function incrementVoicemailBadge() {
  const badge = document.getElementById("voicemailBadge");
  if (!badge) return;

  const count = parseInt(badge.textContent || "0") + 1;
  updateVoicemailBadge(count);
}

function decrementVoicemailBadge() {
  const badge = document.getElementById("voicemailBadge");
  if (!badge) return;

  const count = Math.max(0, parseInt(badge.textContent || "0") - 1);
  updateVoicemailBadge(count);
}

function showVoicemailToast(vm) {
  const toast = document.createElement("div");
  toast.className = "voicemail-toast";
  toast.textContent = `New voicemail from ${vm.from_id}`;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// -------------------------------------------------------
// Contact window toggle
// -------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const contactWindow = document.getElementById("contact_window");
  const contactWidget = document.getElementById("contact_widget");

  if (contactWindow && contactWidget) {
    contactWidget.addEventListener("click", (e) => {
      e.stopPropagation();
      contactWindow.classList.toggle("active");
    });

    document.addEventListener("click", (e) => {
      if (
        !contactWindow.contains(e.target) &&
        !contactWidget.contains(e.target)
      ) {
        contactWindow.classList.remove("active");
      }
    });
  }
});

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
      element: "#contacts_btn",
      text: "View and manage your contacts here.",
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

    const nav = document.getElementById("side_nav_buttons");
    if (nav) nav.classList.add("open");

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

      const nav = document.getElementById("side_nav_buttons");
      if (nav) nav.classList.remove("open");

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
// Content menu initialization (ContactsMenu → main panels)
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
    const msg = document.querySelector("#messaging_box_container");

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

  // Initial state
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
        const msg = document.querySelector("#messaging_box_container");
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
        window.showNotification("Hidden Messages", "Hidden messages view not implemented yet.");
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
   DND toggle via ContactsMenu (full call blocking)
------------------------------------------------------- */
window.dndActive = false;

function initDndFromContactsMenu() {
  const menu = document.querySelector("contacts-menu");
  if (!menu) return;

  menu.addEventListener("menu-select", (e) => {
    if (e.detail.action !== "dnd") return;

    window.dndActive = !window.dndActive;

    const dndImg = menu.querySelector("#donot_Btn img");
    if (dndImg) {
      dndImg.classList.toggle("active", window.dndActive);
    }

    socket.emit("dnd:update", {
      userId: getMyUserId(),
      active: window.dndActive,
    });

    window.showNotification(
      "Do Not Disturb",
      window.dndActive
        ? "DND enabled — calls will go to voicemail."
        : "DND disabled — calls will ring normally."
    );
  });
}

/* -------------------------------------------------------
   Incoming call handler with DND + voicemail routing
------------------------------------------------------- */
socket.on("call:incoming", (data) => {
  if (window.dndActive) {
    socket.emit("call:voicemail", {
      from: data.from,
      to: data.to,
    });

    window.showNotification(
      "Call Sent to Voicemail",
      "Incoming call was sent to voicemail (DND active)."
    );

    return;
  }

  if (typeof window.showIncomingCallUI === "function") {
    window.showIncomingCallUI(data);
  }
});

/* -------------------------------------------------------
   Bootstrap
------------------------------------------------------- */
socket.on("connect", async () => {
  console.log("[bootstrap] Socket connected:", socket.id);

  await waitForIdentity();
  await loadContacts();

  const messaging = new MessagingEngine(
    socket,
    renderMessages,
    renderIncomingMessage,
    "/api/messages"
  );

  const rtc = new WebRTCController(socket);
  initCallUI(rtc);

  initCallLogs({ socket });
  loadMessageList();
  loadVoicemails();

  window.openChat = async function (contactId) {
    window.currentChatUserId = contactId;
    await messaging.loadMessages(contactId);
  };

  initContentMenu();
  initDndFromContactsMenu();
});

/* -------------------------------------------------------
   PANEL REGISTRY (REQUIRED)
------------------------------------------------------- */
const Panels = {
  contacts: document.getElementById("contacts"),
  blocked: document.getElementById("bloc_box"),
  settings: document.getElementById("settings_container"),
  addContact: document.querySelector(".sidebar"),
  profile: document.querySelector(".profile_card"),   // IMPORTANT
};


/* -------------------------------------------------------
   CONTACT MENU TOGGLE (OLD CONTACT BOX)
------------------------------------------------------- */
const contactMenu = document.getElementById("contact_menu_box");
const menuBtnContact = document.getElementById("menu_Btn_contact");

if (menuBtnContact && contactMenu) {
  menuBtnContact.addEventListener("click", (e) => {
    e.stopPropagation();
    contactMenu.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if (!contactMenu.contains(e.target) && !menuBtnContact.contains(e.target)) {
      contactMenu.classList.remove("open");
    }
  });
}

/* -------------------------------------------------------
   MENU BUTTONS
------------------------------------------------------- */
const Buttons = {
  block: document.getElementById("block_contact"),
  addContact: document.getElementById("add_contact"),
  settings: document.getElementById("settings"),
  closeSettings: document.getElementById("close_contact_settings"),
  openProfile: document.getElementById("view_profile"),
};

/* -------------------------------------------------------
   PANEL CONTROLLER
------------------------------------------------------- */
function hideAllPanels() {
  if (Panels.contacts) Panels.contacts.style.display = "none";
  if (Panels.blocked) Panels.blocked.style.display = "none";
  if (Panels.settings) Panels.settings.classList.remove("active");
  if (Panels.profile) Panels.profile.style.display = "none";   // FIXED
}

function togglePanel(panelName) {
  const panel = Panels[panelName];
  if (!panel) return;

  const isOpen =
    panel.classList.contains("active") || panel.style.display === "block";

  if (isOpen) {
    showContacts();
    return;
  }

  hideAllPanels();

  if (panelName === "settings") {
    panel.classList.add("active");
  } else {
    panel.style.display = "block";   // PROFILE FIX
  }
}


showContacts();

/* -------------------------------------------------------
   MENU ACTIONS
------------------------------------------------------- */
if (Buttons.block) {
  Buttons.block.addEventListener("click", () => {
    togglePanel("blocked");
    contactMenu?.classList.remove("open");
  });
}

if (Buttons.settings) {
  Buttons.settings.addEventListener("click", () => {
    togglePanel("settings");
    contactMenu?.classList.remove("open");
  });
}

if (Buttons.closeSettings) {
  Buttons.closeSettings.addEventListener("click", () => {
    Panels.settings?.classList.remove("active");
    showContacts();
  });
}

if (Buttons.openProfile) {
  Buttons.openProfile.addEventListener("click", () => {
    togglePanel("profile");
    contactMenu?.classList.remove("open");
  });
}

if (Buttons.addContact) {
  Buttons.addContact.addEventListener("click", () => {
    togglePanel("addContact");
    contactMenu?.classList.remove("open");
  });
}

if (Buttons.select) {
  Buttons.select.addEventListener("click", () => {
    window.showNotification("Select Mode", "Tap a contact to select.");
    contactMenu?.classList.remove("open");
  });
}

/* -------------------------------------------------------
   Bottom sheet + emoji + GIF + send
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
  const form = document.getElementById("text_box_reply");
  const attachmentInput = document.getElementById("attachment_input");

  if (!messageInput || !form) return;

  const closeAll = () => {
    bottomSheet?.classList.remove("visible");
    emojiPicker?.classList.add("hidden");
    gifPicker?.classList.add("hidden");
  };

  const moveCaretToEnd = (el) => {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  plusBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPicker?.classList.add("hidden");
    gifPicker?.classList.add("hidden");
    bottomSheet?.classList.toggle("visible");
  });

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
    window.micBtn?.click();
  });

  sheetEmoji?.addEventListener("click", (e) => {
    e.stopPropagation();
    bottomSheet?.classList.remove("visible");
    gifPicker?.classList.add("hidden");
    emojiPicker?.classList.toggle("hidden");
  });

  emojiPicker?.addEventListener("emoji-click", (event) => {
    const emoji = event.detail.unicode;
    messageInput.innerHTML += emoji;
    moveCaretToEnd(messageInput);
    messageInput.focus();
  });

  sheetGif?.addEventListener("click", (e) => {
    e.stopPropagation();
    bottomSheet?.classList.remove("visible");
    emojiPicker?.classList.add("hidden");
    gifPicker?.classList.toggle("hidden");
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

      img.addEventListener("click", () => {
        messageInput.innerHTML += `<img src="${url}" class="gif-inline">`;
        moveCaretToEnd(messageInput);
        messageInput.focus();
        gifPicker?.classList.add("hidden");
      });

      gifResults.appendChild(img);
    });
  }

  gifSearch?.addEventListener("input", (e) => {
    const q = e.target.value.trim();
    if (!q) loadTrendingGIFs();
    else searchGIFs(q);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const targetId = window.receiver_id;
    if (!targetId) {
      window.showError?.("No receiver selected");
      return;
    }

    const raw = messageInput.innerHTML.trim();
    if (!raw) return;

    const temp = document.createElement("div");
    temp.innerHTML = raw;
    const text = (temp.textContent || "").trim();

    const gifMatch = raw.match(/<img[^>]+src="([^"]+\.gif)"/i);
    const gifUrl = gifMatch ? gifMatch[1] : null;

    try {
      if (gifUrl && !text) {
        const data = await window.postForm("/messages/send", {
          receiver_id: targetId,
          file: 1,
          file_url: gifUrl,
          message: "",
        });

        const success =
          data && (data.success === true || typeof data.id !== "undefined");

        if (success && typeof window.renderMessage === "function") {
          window.renderMessage({
            id: data.id,
            is_me: true,
            file: 1,
            file_url: gifUrl,
            created_at: data.created_at,
            sender_id: getMyUserId(),
            sender_name: "You",
            type: "gif",
            message: "",
          });
        } else if (!success) {
          const errMsg = data?.error || "Failed to send GIF";
          window.showError?.(errMsg);
        }
      } else if (text) {
        const data = await window.postForm("/messages/send", {
          receiver_id: targetId,
          message: text,
        });

        const success =
          data && (data.success === true || typeof data.id !== "undefined");

        if (success && typeof window.renderMessage === "function") {
          window.renderMessage({
            id: data.id,
            is_me: true,
            message: data.message,
            created_at: data.created_at,
            sender_id: getMyUserId(),
            sender_name: "You",
            type: "text",
          });
        } else {
          const msg = data?.error || "Failed to send message";
          window.showError?.(msg);
        }
      }
    } catch (err) {
      console.error("[SEND] error:", err);
      window.showError?.("Failed to send message");
    }

    messageInput.innerHTML = "";
  });
});

























































