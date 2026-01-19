// Core session + socket
import { messageWin } from "./session.js";
import { socket } from "./socket.js";
import { DEBUG } from "./debug.js";

// Messaging
import { MessagingEngine } from "./messaging/MessagingEngine.js";
import {
  renderMessages,
  renderIncomingMessage,
} from "./messaging/MessageUI.js";
import { updateReactionUI } from "./messaging/ReactionUI.js";
import "./messaging/TypingUI.js";

// Contacts + Call logs
import { loadContacts, openMessagesFor } from "./dashboard/contacts.js";
import { initCallLogs, normalizeAvatarPath } from "./call-log.js";

// WebRTC
import { WebRTCController } from "./webrtc/WebRTCController.js";
import { initCallUI } from "./webrtc/CallUI.js";

// Dashboard UI
import "./dashboard/DashboardInit.js";

// Make renderMessage globally available for the GIF sender, etc.
window.renderMessage = function (msg) {
  renderIncomingMessage(msg);
};

/* -------------------------------------------------------
   Speaking Detection (Local User)
------------------------------------------------------- */

let speakingDetector = null;

function startSpeakingDetection(stream, wrapperEl) {
  stopSpeakingDetection(); // cleanup if already running
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
  const SPEAKING_THRESHOLD = 0.07; // tweak if needed
  const SMOOTHING = 0.8;

  let smoothedLevel = 0;
  let rafId = null;

  const loop = () => {
    analyser.getByteFrequencyData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length / 255; // 0..1

    smoothedLevel = SMOOTHING * smoothedLevel + (1 - SMOOTHING) * avg;

    if (smoothedLevel > SPEAKING_THRESHOLD) {
      avatarEl.classList.add("speaking");
    } else {
      avatarEl.classList.remove("speaking");
    }

    rafId = requestAnimationFrame(loop);
  };

  loop();

  speakingDetector = {
    audioCtx,
    source,
    analyser,
    avatarEl,
    rafId,
  };
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

(async () => {
  // Load contacts first (sets contactLookup)
  await loadContacts();

  // Messaging engine (Node backend; base path now API-relative, not /NewApp)
  const messaging = new MessagingEngine(
    socket,
    renderMessages,
    renderIncomingMessage,
    updateReactionUI,
    "/api" // assumed Node messaging base; backend will expose /api/messages/...
  );

  // WebRTC
  const rtc = new WebRTCController(socket);
  initCallUI(rtc);

  // Call logs
  initCallLogs({ socket });

  // Expose openChat globally
  window.openChat = async function (contactId) {
    window.currentChatUserId = contactId;
    await messaging.loadMessages(contactId);
  };

  // Expose speaking detection helpers if needed elsewhere
  window.startSpeakingDetection = startSpeakingDetection;
  window.stopSpeakingDetection = stopSpeakingDetection;
})();

document.addEventListener("DOMContentLoaded", () => {
  const contactWindow = document.getElementById("contact_window");
  const contactWidget = document.getElementById("contact_widget");

  // OPEN / TOGGLE
  contactWidget.addEventListener("click", (e) => {
    e.stopPropagation(); // prevent immediate close
    contactWindow.classList.toggle("active");
  });

  // CLOSE when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !contactWindow.contains(e.target) &&
      !contactWidget.contains(e.target)
    ) {
      contactWindow.classList.remove("active");
    }
  });
});

function startIntroTour() {
  console.log("Tour starting…");

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

  if (!introBox) console.error("❌ #introduction NOT FOUND");
  if (!arrow) console.error("❌ #intro_arrow NOT FOUND");

  let index = 0;

  function showStep(i) {
    console.log("Showing step", i);

    const step = steps[i];
    const target = document.querySelector(step.element);

    if (!target) {
      console.error("❌ Target not found:", step.element);
      return;
    }

    const rect = target.getBoundingClientRect();
    console.log("Target rect:", rect);

    // Force nav open
    const nav = document.getElementById("side_nav_buttons");
    nav.classList.add("open");

    // Show intro box
    introBox.style.display = "block";
    introBox.innerHTML = step.text;

    introBox.style.top = rect.top + "px";
    introBox.style.left = rect.right + 20 + "px";

    // Arrow
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
      console.log("Tour finished.");
      introBox.style.display = "none";
      arrow.style.display = "none";

      document.getElementById("side_nav_buttons").classList.remove("open");
      localStorage.setItem("tourCompleted", "true");
    }
  }

  introBox.addEventListener("click", nextStep);

  console.log("Starting first step…");
  nextStep();
}

// Run only on first visit
window.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded. Checking tourCompleted…");

  if (!localStorage.getItem("tourCompleted")) {
    console.log("Tour not completed. Starting in 300ms…");
    setTimeout(startIntroTour, 300);
  } else {
    console.log("Tour already completed.");
  }
});

window.showNotification = function (title, message) {
  const container = document.getElementById("notification_container");

  const note = document.createElement("div");
  note.className = "notification";

  note.innerHTML = `
    <div class="title">${title}</div>
    <div class="body">${message}</div>
  `;

  container.appendChild(note);

  // Slide in
  setTimeout(() => note.classList.add("show"), 10);

  // Auto remove after 5 seconds
  setTimeout(() => {
    note.classList.remove("show");
    setTimeout(() => note.remove(), 400);
  }, 5000);

  // Remove on click
  note.addEventListener("click", () => {
    note.classList.remove("show");
    setTimeout(() => note.remove(), 400);
  });
};

const contactBox = document.getElementById("contact_box");
const contactWidget = document.getElementById("contact_widget");
const contactClose = document.getElementById("contact_close");

// OPEN PANEL
contactWidget.addEventListener("click", () => {
  contactBox.classList.add("open");
});

// CLOSE PANEL
contactClose.addEventListener("click", () => {
  contactBox.classList.remove("open");
});

/* -------------------------------------------------------
   CONTACT MENU TOGGLE
------------------------------------------------------- */

const contactMenu = document.getElementById("contact_menu_box");
const menuWidget = document.getElementById("menu_Btn_contact");

// Open/close the menu
menuWidget.addEventListener("click", (e) => {
  e.stopPropagation();
  contactMenu.classList.toggle("open");
});

// Close menu when clicking outside
document.addEventListener("click", (e) => {
  if (!contactMenu.contains(e.target) && !menuWidget.contains(e.target)) {
    contactMenu.classList.remove("open");
  }
});

/* -------------------------------------------------------
   PANEL REGISTRY
------------------------------------------------------- */

const Panels = {
  contacts: document.getElementById("contacts"),
  blocked: document.getElementById("bloc_box"),
  settings: document.getElementById("settings_container"),
  addContact: document.querySelector(".sidebar"),
  profile: document.querySelector(".profile_card"),
};

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

  // Settings container uses .active
  if (Panels.settings) Panels.settings.classList.remove("active");

  // Profile panel uses .active
  if (Panels.profile) Panels.profile.classList.remove("active");
}

function showContacts() {
  hideAllPanels();
  if (Panels.contacts) Panels.contacts.style.display = "block";
}

function togglePanel(panelName) {
  const panel = Panels[panelName];
  if (!panel) return;

  const isOpen =
    panel.classList.contains("active") ||
    panel.style.display === "block";

  if (isOpen) {
    showContacts();
    return;
  }

  hideAllPanels();

  if (panelName === "settings" || panelName === "profile") {
    panel.classList.add("active");
  } else {
    panel.style.display = "block";
  }
}

/* -------------------------------------------------------
   DEFAULT STATE
------------------------------------------------------- */

showContacts(); // contacts visible by default

/* -------------------------------------------------------
   MENU ACTIONS
------------------------------------------------------- */

// Block Contact
Buttons.block.addEventListener("click", () => {
  togglePanel("blocked");
  contactMenu.classList.remove("open");
});

// Settings (open)
Buttons.settings.addEventListener("click", () => {
  togglePanel("settings");
  contactMenu.classList.remove("open");
});

// Settings (close button)
Buttons.closeSettings.addEventListener("click", () => {
  if (Panels.settings && Panels.settings.classList)
    Panels.settings.classList.remove("open");
  showContacts();
});

Buttons.openProfile.addEventListener("click", () => {
  togglePanel("profile");
  contactMenu.classList.remove("open");
});


/* -------------------------------------------------------
   BLOCKED CONTACTS LOADER
------------------------------------------------------- */

function loadBlockedContacts(list) {
  const ul = document.getElementById("blocked-contacts");
  ul.innerHTML = "";

  list.forEach((name) => {
    const li = document.createElement("li");
    li.textContent = name;
    ul.appendChild(li);
  });
}

loadBlockedContacts(["John Doe", "Spam Caller", "Unknown Number"]);

// -------------------------------------------------------
// Voicemail + DND + Wavesurfer UI logic
// -------------------------------------------------------

window.addEventListener("load", function () {
  customElements.whenDefined("contacts-menu").then(() => {
    const toggleBtn = document.getElementById("toggle_Btn");
    const messagingBtn = document.getElementById("messaging_Btn");
    const blockBtn = document.getElementById("block_Btn");
    const voicemailBtn = document.getElementById("voicemail_Btn");
    const donotBtn = document.getElementById("donot_Btn");

    const panelTitle = document.getElementById("panelTitle");
    const messagingBox2 = document.getElementById("messaging_box_container");
    const vmListPanel = document.getElementById("voicemail_list"); // voicemail panel container
    const savedCon = document.getElementById("sav_con"); // call history panel
    const blockedCon = document.getElementById("bl_con"); // contacts panel
    const blockListBox = document.getElementById("bloc_box"); // blocked contacts panel

    function showSection(section) {
      [savedCon, blockedCon, vmListPanel, blockListBox, messagingBox2].forEach(
        (sec) => {
          if (!sec) return;
          sec.style.display = "none";
        }
      );

      if (section) section.style.display = "block";
    }

    // Toggle between Call Log and Contacts
    toggleBtn.addEventListener("click", function () {
      if (savedCon && savedCon.style.display !== "none") {
        showSection(blockedCon);
        panelTitle.textContent = "Contacts";
        this.innerHTML = '<img src="Contacts.png" alt="contacts"> Contacts';
      } else {
        showSection(savedCon);
        panelTitle.textContent = "Call History";
        this.innerHTML = '<img src="calllog.png" alt="call-log"> Call Log';
      }
    });

    messagingBtn.addEventListener("click", () => {
      showSection(messagingBox2);
      panelTitle.textContent = "Messaging";

      loadMessageList(window.user_id);
    });

    // Block List
    blockBtn.addEventListener("click", () => {
      showSection(blockListBox);
      panelTitle.textContent = "Blocked Contacts";
    });

    // Voicemail panel
    voicemailBtn.addEventListener("click", () => {
      showSection(vmListPanel);
      panelTitle.textContent = "Voicemail";
      loadVoicemails(); // refresh list when opening
    });

    // Do Not Disturb toggle
    const icon = donotBtn.querySelector("img");
    let dndActive = false;

    donotBtn.addEventListener("click", () => {
      dndActive = !dndActive;
      icon.classList.toggle("active", dndActive);

      socket.emit("dnd:update", {
        userId: CURRENT_LOGGED_IN_USER_ID,
        active: dndActive,
      });
    });

    // Default view
    showSection(savedCon);
    panelTitle.textContent = "Call History";

    // Initial load of voicemails (for badge on first load)
    loadVoicemails();
  });
});

window.openMessagingPanel = function () {
  const messagingBox2 = document.getElementById("messaging_box_container");
  const panelTitle = document.getElementById("panelTitle");

  showSection(messagingBox2);
  panelTitle.textContent = "Messaging";

  // Load conversation list if not loaded yet
  loadMessageList(window.user_id);
};

/* ---------------------------------------------------------
   Load Message List (Node backend version)
--------------------------------------------------------- */
async function loadMessageList() {
  const list = document.getElementById("messaging_list");
  const header = document.getElementById("unread_header");

  list.innerHTML = "";
  header.textContent = "Loading...";

  try {
    // Node backend route (session-based, no userId needed)
    const data = await getJson("/contacts");

    const conversations = data.contacts || [];
    window.lastMessageList = conversations;

    // Total unread count
    const totalUnread = conversations.reduce(
      (sum, c) => sum + (c.unread_count || 0),
      0
    );

    // Header text
    header.textContent =
      totalUnread > 0
        ? `You have ${totalUnread} unread message${totalUnread === 1 ? "" : "s"}`
        : "No unread messages";

    // Render each conversation
    conversations.forEach((conv) => {
      list.appendChild(buildMessageCard(conv));
    });

  } catch (err) {
    console.error("[loadMessageList] Error:", err);
    header.textContent = "Failed to load messages";
  }
}


/* ---------------------------------------------------------
   Build Conversation Card
--------------------------------------------------------- */
function buildMessageCard(conv) {
  const li = document.createElement("li");
  li.className = "message-card " + (conv.unread > 0 ? "unread" : "read");

  const avatar = conv.avatar || "img/defaultUser.png";

  li.innerHTML = `
        <div class="msg-avatar">
            <img src="${avatar}">
            ${
              conv.unread > 0
                ? `<span class="unread-badge">${conv.unread}</span>`
                : ""
            }
        </div>

        <div class="msg-info">
            <div class="msg-top">
                <div class="msg-name">${conv.name}</div>
                <div class="msg-time">${formatTime(
                  conv.lastMessage.timestamp
                )}</div>
            </div>
            <div class="msg-bottom">
                <div class="msg-preview">${sanitizePreview(
                  conv.lastMessage.text
                )}</div>
            </div>
        </div>
    `;

  /* SINGLE CLICK HANDLER — correct, clean, unified */
  li.addEventListener("click", () => {
    // Convert message-list conversation → contact object
    const userRaw = {
      contact_id: conv.id,
      contact_name: conv.name,
      avatar: conv.avatar,
    };

    // Use your existing messaging system
    openMessagesFor(userRaw);

    // Mark visually as read
    li.classList.remove("unread");
    li.classList.add("read");
  });

  return li;
}
function showSection(section) {
  // Hide all panels
  document
    .querySelectorAll(".panel")
    .forEach((p) => p.classList.remove("active"));

  // Show the selected panel
  section.classList.add("active");
}

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */
function formatTime(iso) {
  const date = new Date(iso);
  return date.toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sanitizePreview(text) {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// -------------------------------------------------------
// Helpers for theme + Wavesurfer
// -------------------------------------------------------
function isDarkMode() {
  // Adjust to match your app's dark mode toggle logic
  return document.body.classList.contains("dark-mode");
}

// -------------------------------------------------------
// Voicemail loading + rendering
// -------------------------------------------------------
async function loadVoicemails() {
  try {
    const res = await fetch(`${API_BASE}/voicemail/list`, { credentials: "include" })


    const data = await res.json();

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

// Realtime voicemail
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
      <span>${
        vm.timestamp ? new Date(vm.timestamp).toLocaleString() : ""
      }</span>
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

  // ---- Wavesurfer: waveform + theme + peaks + speed + download ----
  if (!isMissedCall && typeof WaveSurfer !== "undefined") {
    const dark = isDarkMode();

    const waveform = WaveSurfer.create({
      container: `#waveform-${vm.id}`,
      waveColor: dark ? "#777777" : "#999",
      progressColor: dark ? "#4da3ff" : "#007aff",
      cursorColor: dark ? "#ffffff" : "#000000", // animated playhead
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

    // Optional: hook if you ever want to sync extra UI with playback
    waveform.on("audioprocess", () => {
      // custom per-frame logic if needed
    });
  }

  // Mark listened
  li.querySelector(".mark-listened").onclick = async () => {
    try {
      await fetch("http://localhost:3001/api/voicemail/listened", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vm.id }),
      });

      li.classList.remove("unheard");
      decrementVoicemailBadge();
    } catch (err) {
      console.error("mark-listened error:", err);
    }
  };

  // Call back
  li.querySelector(".call-back").onclick = () => {
    socket.emit("call:start", { to: vm.from_id });
  };

  // Delete voicemail
  li.querySelector(".delete-voicemail").onclick = async () => {
    try {
      await fetch("http://localhost:3001/api/voicemail/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vm.id }),
      });

      li.remove();
      decrementVoicemailBadge();
    } catch (err) {
      console.error("voicemail delete error:", err);
    }
  };

  // Swipe-to-delete (mobile)
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
// Badge + toast
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

    const upload = await fetch(
      "http://localhost/NewApp/api/messages/audio.php",
      {
        method: "POST",
        body: form,
      }
    );

    const data = await upload.json();

    await fetch("http://localhost:3001/api/voicemail/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: calleeId,
        fromId: callerId,
        audioUrl: data.url,
      }),
    });
  };

  vmRecorder.start();
}
socket.on("call:voicemail", () => {
  showVoicemailRecordingUI();
  startVoicemailRecorder();
});

/* -------------------------------------------------------
   WHATSAPP‑STYLE BOTTOM SHEET + GIF PICKER + EMOJI + SEND
   (STABLE, CONTENTEDITABLE, WITH DEBUG LOGS)
------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  console.log(
    "[UI] DOMContentLoaded - initializing bottom sheet, emoji, GIF, and send handler"
  );

  /* -------------------------------------------------------
     ELEMENTS
  ------------------------------------------------------- */
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

  const messageInput = document.getElementById("message_input"); // contenteditable
  const form = document.getElementById("text_box_reply");
  const attachmentInput = document.getElementById("attachment_input");

  console.log("[UI] Elements:", {
    plusBtn,
    bottomSheet,
    sheetCamera,
    sheetGallery,
    sheetFile,
    sheetAudio,
    sheetEmoji,
    sheetGif,
    emojiPicker,
    gifPicker,
    gifSearch,
    gifResults,
    messageInput,
    form,
    attachmentInput,
  });

  /* -------------------------------------------------------
     SAFETY CHECKS
  ------------------------------------------------------- */
  if (!messageInput || !form) {
    console.warn(
      "[UI] message_input or form#text_box_reply missing — messaging UI disabled"
    );
    return;
  }

  /* -------------------------------------------------------
     HELPERS
  ------------------------------------------------------- */
  const closeAll = () => {
    console.log("[UI] closeAll()");
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

  /* -------------------------------------------------------
     TOGGLE BOTTOM SHEET
  ------------------------------------------------------- */
  plusBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    console.log("[UI] plusBtn clicked");
    emojiPicker?.classList.add("hidden");
    gifPicker?.classList.add("hidden");
    bottomSheet?.classList.toggle("visible");
  });

  /* -------------------------------------------------------
     CLICK OUTSIDE HANDLER (BOTTOM SHEET + EMOJI + GIF)
  ------------------------------------------------------- */
  document.addEventListener("click", (e) => {
    const target = e.target;

    const clickedInsideSheet = bottomSheet?.contains(target);
    const clickedPlus = target === plusBtn;
    const clickedEmojiShadow = target.closest("emoji-picker") !== null;
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
    console.log("[SHEET] Camera clicked");
    closeAll();
    // camera logic placeholder
  });

  sheetGallery?.addEventListener("click", () => {
    console.log("[SHEET] Gallery clicked");
    closeAll();
    attachmentInput?.click();
  });

  sheetFile?.addEventListener("click", () => {
    console.log("[SHEET] File clicked");
    closeAll();
    attachmentInput?.click();
  });

  sheetAudio?.addEventListener("click", () => {
    console.log("[SHEET] Audio clicked");
    closeAll();
    window.micBtn?.click();
  });

  /* -------------------------------------------------------
     EMOJI PICKER TOGGLE
  ------------------------------------------------------- */
  sheetEmoji?.addEventListener("click", (e) => {
    e.stopPropagation();
    console.log("[EMOJI] sheetEmoji clicked");
    bottomSheet?.classList.remove("visible");
    gifPicker?.classList.add("hidden");
    emojiPicker?.classList.toggle("hidden");
  });

  /* -------------------------------------------------------
     EMOJI INSERTION (CONTENTEDITABLE AWARE)
  ------------------------------------------------------- */
  emojiPicker?.addEventListener("emoji-click", (event) => {
    const emoji = event.detail.unicode;
    console.log("[EMOJI] Insert:", emoji);

    messageInput.innerHTML += emoji;
    moveCaretToEnd(messageInput);
    messageInput.focus();
  });

  /* -------------------------------------------------------
     GIF PICKER TOGGLE
  ------------------------------------------------------- */
  sheetGif?.addEventListener("click", (e) => {
    e.stopPropagation();
    console.log("[GIF] sheetGif clicked");

    bottomSheet?.classList.remove("visible");
    emojiPicker?.classList.add("hidden");
    gifPicker?.classList.toggle("hidden");

    loadTrendingGIFs();
  });

  /* -------------------------------------------------------
     TENOR API CONFIG
  ------------------------------------------------------- */
  const TENOR_KEY = "AIzaSyCdGnnQLWc8TnlSHcVgW2xlFzM1v1KyuPQ";
  const TENOR_TRENDING = `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&limit=30`;
  const TENOR_SEARCH = (q) =>
    `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(
      q
    )}&key=${TENOR_KEY}&limit=30`;

  /* -------------------------------------------------------
     LOAD TRENDING GIFS
  ------------------------------------------------------- */
  async function loadTrendingGIFs() {
    if (!gifResults) {
      console.warn("[GIF] gifResults not found – cannot render GIFs");
      return;
    }
    console.log("[GIF] Loading trending GIFs…", TENOR_TRENDING);

    try {
      const res = await fetch(TENOR_TRENDING);
      if (!res.ok) {
        console.error("[GIF] Trending request failed:", res.status);
        return;
      }
      const data = await res.json();
      console.log("[GIF] Trending response:", data);
      renderGIFs(data.results || []);
    } catch (err) {
      console.error("[GIF] Failed to load trending GIFs", err);
    }
  }

  /* -------------------------------------------------------
     SEARCH GIFS
  ------------------------------------------------------- */
  async function searchGIFs(query) {
    if (!gifResults) {
      console.warn("[GIF] gifResults not found – cannot render GIFs");
      return;
    }
    console.log("[GIF] Searching GIFs for:", query);

    try {
      const url = TENOR_SEARCH(query);
      const res = await fetch(url);
      if (!res.ok) {
        console.error("[GIF] Search request failed:", res.status);
        return;
      }
      const data = await res.json();
      console.log("[GIF] Search response:", data);
      renderGIFs(data.results || []);
    } catch (err) {
      console.error("[GIF] Failed to search GIFs", err);
    }
  }

  /* -------------------------------------------------------
     RENDER GIF GRID
  ------------------------------------------------------- */
  function renderGIFs(gifs) {
    if (!gifResults) {
      console.warn("[GIF] gifResults not found – cannot render GIFs");
      return;
    }

    console.log("[GIF] Rendering GIF grid, count:", gifs.length);
    gifResults.innerHTML = "";

    gifs.forEach((gif) => {
      const url =
        gif?.media_formats?.tinygif?.url || gif?.media_formats?.gif?.url;

      if (!url) {
        console.warn("[GIF] GIF without URL:", gif);
        return;
      }

      const img = document.createElement("img");
      img.src = url;
      img.alt = "GIF";

      img.addEventListener("click", () => {
        console.log("[GIF] Selected:", url);

        // Insert GIF inline inside the contenteditable input
        messageInput.innerHTML += `<img src="${url}" class="gif-inline">`;

        moveCaretToEnd(messageInput);
        messageInput.focus();
        console.log("[GIF] Inserted into message_input");

        gifPicker?.classList.add("hidden");
      });

      gifResults.appendChild(img);
    });
  }

  /* -------------------------------------------------------
     GIF SEARCH INPUT
  ------------------------------------------------------- */
  gifSearch?.addEventListener("input", (e) => {
    const q = e.target.value.trim();
    console.log("[GIF] Search input:", q);
    if (!q) loadTrendingGIFs();
    else searchGIFs(q);
  });

  /* -------------------------------------------------------
     SEND HANDLER (TEXT + GIF) USING window.postForm
  ------------------------------------------------------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    console.log("[SEND] Submit triggered");

    const targetId = window.receiver_id;
    console.log("[SEND] receiver_id:", targetId);

    if (!targetId) {
      console.warn("[SEND] No receiver selected");
      window.showError?.("No receiver selected");
      return;
    }

    const raw = messageInput.innerHTML.trim();
    console.log("[SEND] Raw HTML:", raw);

    if (!raw) {
      console.warn("[SEND] Empty message; abort");
      return;
    }

    // Extract plain text
    const temp = document.createElement("div");
    temp.innerHTML = raw;
    const text = (temp.textContent || "").trim();
    console.log("[SEND] Extracted text:", text);

    // Extract first GIF URL (if any)
    const gifMatch = raw.match(/<img[^>]+src="([^"]+\.gif)"/i);
    const gifUrl = gifMatch ? gifMatch[1] : null;
    console.log("[SEND] Extracted GIF URL:", gifUrl);

    if (typeof window.postForm !== "function") {
      console.error("[SEND] window.postForm is not a function");
      window.showError?.("Internal error: send helper missing");
      return;
    }

    try {
      // Pure GIF message
      if (gifUrl && !text) {
        console.log("[SEND] Sending pure GIF");

        const data = await window.postForm("/api/messages/send.php", {
          receiver_id: targetId,
          file: 1,
          file_url: gifUrl,
          message: "",
        });

        console.log("[SEND] GIF response:", data);

        const success =
          data && (data.success === true || typeof data.id !== "undefined");

        if (!success) {
          const errMsg = data?.error || "Failed to send GIF";
          console.warn("[SEND] GIF send failed (backend):", errMsg);
          window.showError?.(errMsg);
        } else {
          console.log("[SEND] GIF send success, response:", data);
          if (typeof window.renderMessages === "function") {
            window.renderMessages({
              id: data.id,
              is_me: true,
              file: 1,
              file_url: gifUrl,
              created_at: data.created_at,
              sender_id: window.getMyUserId(),
              sender_name: "You",
              type: "gif",
              message: "",
            });
            console.log("[SEND] GIF rendered locally via renderMessage");
          } else {
            console.warn(
              "[SEND] GIF sent, but window.renderMessage is not defined"
            );
            // no error toast here – backend succeeded, UI just won’t optimistically render
          }
        }
      } else if (text) {
        // Text message (emojis, etc.)
        console.log("[SEND] Sending text:", text);

        const data = await window.postForm("/api/messages/send.php", {
          receiver_id: targetId,
          message: text,
        });

        console.log("[SEND] Text response:", data);

        const success =
          data && (data.success === true || typeof data.id !== "undefined");

        if (success && typeof window.renderMessage === "function") {
          window.renderMessage({
            id: data.id,
            is_me: true,
            message: data.message,
            created_at: data.created_at,
            sender_id: window.getMyUserId(),
            sender_name: "You",
            type: "text",
          });
          console.log("[SEND] Text rendered locally");
        } else {
          const msg = data?.error || "Failed to send message";
          console.warn("[SEND] Text send failed:", msg);
          window.showError?.(msg);
        }
      } else {
        console.warn("[SEND] Neither GIF nor text present; nothing sent");
      }
    } catch (err) {
      console.error("[SEND] Exception during send:", err);
      window.showError?.("Failed to send message");
    }

    messageInput.innerHTML = "";
    console.log("[SEND] message_input cleared");
  });

  console.log("[UI] Bottom sheet + emoji + GIF + send initialized");
});





