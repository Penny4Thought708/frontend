// public/js/app.js
// -------------------------------------------------------
// Unified dashboard wiring: session + socket + messaging
// + contacts + call logs + voicemail + UI
// -------------------------------------------------------

import { getMyUserId, getJson } from "./session.js";
import { socket } from "./socket.js";
import { DEBUG } from "./debug.js";

// Messaging engine + UI
import { MessagingEngine } from "./messaging/MessagingEngine.js";
import { renderMessages, renderIncomingMessage } from "./messaging/MessageUI.js";
import { updateReactions } from "./messaging/ReactionUI.js";
import "./messaging/TypingUI.js";

// Contacts (new unified system)
import { loadContacts, openMessagesFor } from "./dashboard/contacts.js";

// Call logs
import { initCallLogs } from "./call-log.js";

// WebRTC
import { WebRTCController } from "./webrtc/WebRTCController.js";
import { initCallUI } from "./webrtc/CallUI.js";
import "../components/ContactsMenu.js";

// Backend base
const API_BASE = "https://letsee-backend.onrender.com/api";

/* -------------------------------------------------------
   Identity Waiter
------------------------------------------------------- */
async function waitForIdentity() {
  while (!getMyUserId()) {
    await new Promise((r) => setTimeout(r, 100));
  }
}
// -------------------------------------------------------
// CONTENT MENU INITIALIZATION
// -------------------------------------------------------
function initContentMenu() {
  const menu = document.querySelector("contacts-menu");
  if (!menu) {
    console.error("[content-menu] <contacts-menu> element not found");
    return;
  }

  console.log("[content-menu] Initialized");

  // Track toggle state for the Contacts/Call Log button
  let showingContacts = false;

  // Helper: force all children to display block if hidden
  function forceChildrenDisplay(container) {
    const elements = container.querySelectorAll("*");
    elements.forEach(el => {
      const current = window.getComputedStyle(el).display;
      if (current === "none") {
        el.style.display = "block";
      }
    });
  }

  // Helper: hide all your real containers
  function hideAll() {
    document.querySelector("#sav_con").style.display = "none";
    document.querySelector("#bl_con").style.display = "none";
    document.querySelector("#voicemail_list").style.display = "none";
    document.querySelector("#messaging_box_container").style.display = "none";
  }

  // Helper: update the Contacts button label + icon
  function updateContactsButton() {
    const btn = menu.querySelector("#toggle_Btn");
    if (!btn) return;

    if (showingContacts) {
      btn.innerHTML = `<img src="calllog.png" alt="call-log"> Call Log`;
    } else {
      btn.innerHTML = `<img src="Contacts.png" alt="contacts"> Contacts`;
    }
  }

  // Default state: Call Log is active (but window may be hidden)
  hideAll();
  document.querySelector("#sav_con").style.display = "block";
  forceChildrenDisplay(document.querySelector("#sav_con"));
  updateContactsButton();

  // Main menu handler
  menu.addEventListener("menu-select", (e) => {
    const action = e.detail.action;
    console.log("[content-menu] Selected:", action);

    hideAll();

    switch (action) {
      case "contacts":
        // Toggle between Call Log ↔ Contacts
        showingContacts = !showingContacts;
        updateContactsButton();

        if (showingContacts) {
          // Show Contacts
          const c = document.querySelector("#bl_con");
          c.style.display = "block";
          forceChildrenDisplay(c);
        } else {
          // Show Call Log
          const c = document.querySelector("#sav_con");
          c.style.display = "block";
          forceChildrenDisplay(c);
        }
        break;

      case "messages":
        const msg = document.querySelector("#messaging_box_container");
        msg.style.display = "block";
        forceChildrenDisplay(msg);
        break;

      case "voicemail":
        const vm = document.querySelector("#voicemail_list");
        vm.style.display = "block";
        forceChildrenDisplay(vm);
        break;

      // You did NOT show containers for these, so we skip them
      case "block":
      case "hidden":
      case "dnd":
        break;

      default:
        console.warn("[content-menu] Unknown action:", action);
    }
  });
}

/* -------------------------------------------------------
   Global GET helper (session-based)
------------------------------------------------------- */
window.apiGet = async function (path) {
  const cleanPath = path.replace(".php", "");
  const url = cleanPath.startsWith("http")
    ? cleanPath
    : `${API_BASE}${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}`;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include"
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("Non-JSON response from", url, ":", text);
    throw new Error("Invalid JSON response");
  }
};

/* -------------------------------------------------------
   Speaking Detection
------------------------------------------------------- */
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

  speakingDetector = { audioCtx, source, analyser, avatarEl, rafId };
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

/* -------------------------------------------------------
   Message List Loader
------------------------------------------------------- */
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

/* -------------------------------------------------------
   Voicemail Loader + UI
------------------------------------------------------- */
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

/* -------------------------------------------------------
   Voicemail badge + toast
------------------------------------------------------- */
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

/* -------------------------------------------------------
   Voicemail Recorder
------------------------------------------------------- */
let vmRecorder;
let vmChunks = [];

async function startVoicemailRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  vmRecorder = new MediaRecorder(stream);

  vmRecorder.ondataavailable = (e) => vmChunks.push(e.data);

  vmRecorder.onstop = async () => {
    const blob = new Blob(vmChunks, { type: "audio/webm" });
    vmChunks = [];

    const form = new FormData();
    form.append("audio", blob);

    const upload = await fetch(`${API_BASE}/messages/audio`, {
      method: "POST",
      body: form,
      credentials: "include",
    });

    const data = await upload.json();

    await fetch(`${API_BASE}/voicemail/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        userId: window.calleeId,
        fromId: window.callerId,
        audioUrl: data.url,
      }),
    });
  };

  vmRecorder.start();
}

socket.on("call:voicemail", () => {
  if (typeof window.showVoicemailRecordingUI === "function") {
    window.showVoicemailRecordingUI();
  }
  startVoicemailRecorder();
});

/* -------------------------------------------------------
   Unified Dashboard Bootstrap
------------------------------------------------------- */
(async () => {
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

  // ⭐ FIX: restore content menu functionality
  initContentMenu();
})();


/* -------------------------------------------------------
   Contact window toggle
------------------------------------------------------- */
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

/* -------------------------------------------------------
   Intro Tour
------------------------------------------------------- */
function startIntroTour() {
  const steps = [
    { element: "#btn_search", text: "Use Search to find local help, resources, and contacts instantly.", arrow: "right" },
    { element: "#btn_chat_main", text: "Start a chat with anyone in your contacts.", arrow: "right" },
    { element: "#contacts_btn", text: "View and manage your contacts here.", arrow: "right" },
    { element: "#btn_notifications", text: "Check your notifications — messages, calls, alerts.", arrow: "right" },
    { element: "#btn_settings", text: "Customize your settings and preferences.", arrow: "right" },
    { element: "#toggleBtn", text: "Switch between light and dark themes.", arrow: "right" },
    { element: "#btn_help", text: "Need help? Open the help center anytime.", arrow: "right" },
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

/* -------------------------------------------------------
   Notification helper
------------------------------------------------------- */
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

/* -------------------------------------------------------
   Contact panel + menu
------------------------------------------------------- */
const contactBox = document.getElementById("contact_box");
const contactWidget = document.getElementById("contact_widget");
const contactClose = document.getElementById("contact_close");

if (contactWidget && contactBox) {
  contactWidget.addEventListener("click", () => {
    contactBox.classList.add("open");
  });
}

if (contactClose && contactBox) {
  contactClose.addEventListener("click", () => {
    contactBox.classList.remove("open");
  });
}

/* -------------------------------------------------------
   CONTACT MENU TOGGLE
------------------------------------------------------- */
const contactMenu = document.getElementById("contact_menu_box");
const menuWidget = document.getElementById("menu_Btn_contact");

if (contactMenu && menuWidget) {
  menuWidget.addEventListener("click", (e) => {
    e.stopPropagation();
    contactMenu.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if (!contactMenu.contains(e.target) && !menuWidget.contains(e.target)) {
      contactMenu.classList.remove("open");
    }
  });
}





































