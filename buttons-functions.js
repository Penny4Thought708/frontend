/* ============================================================
   HYBRID FLOATING‑SPACE UI CONTROLLER — FINAL ARCHITECTURE
============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  Settings.init();
});

/* -----------------------------------------------------------
   GLOBAL PARALLAX BACKGROUND
----------------------------------------------------------- */
document.addEventListener("mousemove", (e) => {
  const x = (e.clientX / window.innerWidth - 0.5) * 10;
  const y = (e.clientY / window.innerHeight - 0.5) * 10;
  const bg = document.querySelector(".workspace-bg");
  if (bg) bg.style.transform = `translate(${x}px, ${y}px)`;
});

function initUI() {
  /* -----------------------------------------------------------
     CORE ELEMENTS
  ----------------------------------------------------------- */
  const messaging = document.getElementById("messaging_box");
  const miniChat = document.getElementById("miniChatBubble");

  const conwrap = document.getElementById("conwrap"); 
  const video = document.getElementById("video-container");
  const search = document.getElementById("search_panel");
  const settings = document.getElementById("settings_container");
  const profile = document.getElementById("contact_window");
  const voicemail = document.getElementById("voicemailModal");
  const fullProfile = document.getElementById("fullProfileModal");

  const toggleBtn = document.getElementById("toggleBtn");
  const railButtons = document.querySelectorAll(".app-rail .rail-btn");

  /* -----------------------------------------------------------
     PANEL STATE MANAGEMENT — FINAL
  ----------------------------------------------------------- */
  const UIX = {
    hideAllPanelsExceptMessaging() {
      [conwrap, video, search, settings, profile, voicemail, fullProfile]
        .forEach(p => p?.classList.add("hidden"));
    },

    showMessaging() {
      this.hideAllPanelsExceptMessaging();
      messaging.classList.remove("hidden");
      miniChat.classList.add("hidden");
      document.body.classList.remove("panel-open");
    },

    collapseMessaging() {
      messaging.classList.add("hidden");
      miniChat.classList.remove("hidden");
    },

    showFloating(panel) {
      this.hideAllPanelsExceptMessaging();
      this.collapseMessaging();
      panel.classList.remove("hidden");
      document.body.classList.add("panel-open");

      /* ⭐ SEARCH PANEL SPECIAL BEHAVIOR */
      if (panel === search) {
        const left = document.querySelector(".search_");
        const map = document.querySelector(".map-container");

        left?.classList.add("active");      // slide in
        map?.classList.remove("visible");   // hide map until results
      }
    },

    showLeftPanel() {
      this.hideAllPanelsExceptMessaging();
      this.collapseMessaging();
      conwrap.classList.remove("hidden");
      document.body.classList.add("panel-open");
    }
  };

  /* -----------------------------------------------------------
     THEME TOGGLE
  ----------------------------------------------------------- */
  toggleBtn?.addEventListener("click", () => {
    const html = document.documentElement;
    const theme = html.getAttribute("data-theme");
    html.setAttribute("data-theme", theme === "dark" ? "light" : "dark");
    toggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  });

  /* -----------------------------------------------------------
     LEFT RAIL BUTTONS — FINAL LOGIC
  ----------------------------------------------------------- */
  railButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      railButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      switch (btn.id) {
        case "btn_chat_main":
          UIX.showMessaging();
          break;

        case "contact_widget":
          UIX.showLeftPanel();
          break;

        case "btn_search":
          UIX.showFloating(search);
          break;

        case "btn_settings":
          UIX.showFloating(settings);
          break;

        case "voicemail_Btn":
          UIX.showFloating(voicemail);
          break;

        case "btn_notifications":
          showToast("Notifications panel coming soon");
          break;

        case "btn_help":
          showToast("Help panel coming soon");
          break;
      }
    });
  });

  /* -----------------------------------------------------------
     VIDEO CALL OVERRIDE
  ----------------------------------------------------------- */
  document.getElementById("videoBtn")?.addEventListener("click", () => {
    UIX.showFloating(video);
  });

  document.getElementById("end-call")?.addEventListener("click", () => {
    video.classList.add("hidden");
    UIX.showMessaging();
  });

  /* -----------------------------------------------------------
     MINI CHAT BUBBLE
  ----------------------------------------------------------- */
  miniChat?.addEventListener("click", () => {
    UIX.showMessaging();
  });

  /* -----------------------------------------------------------
     FULL PROFILE MODAL
  ----------------------------------------------------------- */
  document.getElementById("closeFullProfile")?.addEventListener("click", () => {
    fullProfile.classList.add("hidden");
    UIX.showMessaging();
  });

  /* -----------------------------------------------------------
     ESC KEY CLOSES FLOATING PANELS
  ----------------------------------------------------------- */
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      UIX.showMessaging();
      railButtons.forEach(b => b.classList.remove("active"));
    }
  });

  /* -----------------------------------------------------------
     DEFAULT STATE — SHOW MESSAGING ON LOAD
  ----------------------------------------------------------- */
  UIX.showMessaging();
}

/* -----------------------------------------------------------
   TOAST UTILITY
----------------------------------------------------------- */
function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
  }, 2000);

  setTimeout(() => toast.remove(), 2600);
}

/* ============================================================
   SETTINGS CONTROLLER (unchanged)
============================================================ */

const Settings = {
  data: {
    theme: "system",
    accent: "#4CAF50",
    fontSize: 16,

    camera: null,
    resolution: "720p",
    backgroundBlur: false,
    mirrorVideo: false,

    microphone: null,
    speaker: null,
    noiseSuppression: false,
    echoCancellation: false,
    autoGain: false,

    callAlerts: true,
    messageAlerts: true,
    soundEffects: true,

    highContrast: false,
    keyboardShortcuts: true,
    screenReader: false,

    profileName: "",
    profileEmail: "",
    profilePicture: null,

    showOnline: true,
    allowMessages: true,
  },

  async init() {
    this.loadFromStorage();
    this.bindUI();
    await this.loadDevices();
    this.applyUI();
  },

  async loadDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.populateSelect("camera_select", devices.filter(d => d.kind === "videoinput"));
      this.populateSelect("microphone_select", devices.filter(d => d.kind === "audioinput"));
      this.populateSelect("speaker_select", devices.filter(d => d.kind === "audiooutput"));
    } catch (err) {
      console.error("Device load error:", err);
    }
  },

  populateSelect(id, list) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = "";
    list.forEach(dev => {
      const opt = document.createElement("option");
      opt.value = dev.deviceId;
      opt.textContent = dev.label || "Unnamed Device";
      el.appendChild(opt);
    });
  },

  bindUI() {
    this.bind("theme_select", "theme");
    this.bind("accent_color", "accent");
    this.bind("font_size", "fontSize");

    this.bind("camera_select", "camera");
    this.bind("resolution_select", "resolution");
    this.bind("background_blur", "backgroundBlur", true);
    this.bind("mirror_video", "mirrorVideo", true);

    this.bind("microphone_select", "microphone");
    this.bind("speaker_select", "speaker");
    this.bind("noise_suppression", "noiseSuppression", true);
    this.bind("echo_cancellation", "echoCancellation", true);
    this.bind("auto_gain", "autoGain", true);

    this.bind("call_alerts", "callAlerts", true);
    this.bind("message_alerts", "messageAlerts", true);
    this.bind("sound_effects", "soundEffects", true);

    this.bind("high_contrast", "highContrast", true);
    this.bind("keyboard_shortcuts", "keyboardShortcuts", true);
    this.bind("screen_reader", "screenReader", true);

    this.bind("contact_display_name", "profileName");
    this.bind("contact_email", "profileEmail");
    this.bindFile("contact_profile_picture", "profilePicture");

    this.bind("show_online", "showOnline", true);
    this.bind("allow_messages", "allowMessages", true);

    document.getElementById("save_settings")?.addEventListener("click", () => this.save());
    document.getElementById("reset_settings")?.addEventListener("click", () => this.reset());
  },

  bind(id, key, isCheckbox = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      this.data[key] = isCheckbox ? el.checked : el.value;
      this.applyLive(key);
    });
  },

  bindFile(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const file = el.files[0];
      if (file) this.data[key] = file;
    });
  },

  applyUI() {
    for (const key in this.data) {
      const el = document.getElementById(this.mapKeyToId(key));
      if (!el) continue;
      if (typeof this.data[key] === "boolean") el.checked = this.data[key];
      else if (key !== "profilePicture") el.value = this.data[key];
    }
  },

  mapKeyToId(key) {
    return {
      theme: "theme_select",
      accent: "accent_color",
      fontSize: "font_size",

      camera: "camera_select",
      resolution: "resolution_select",
      backgroundBlur: "background_blur",
      mirrorVideo: "mirror_video",

      microphone: "microphone_select",
      speaker: "speaker_select",
      noiseSuppression: "noise_suppression",
      echoCancellation: "echo_cancellation",
      autoGain: "auto_gain",

      callAlerts: "call_alerts",
      messageAlerts: "message_alerts",
      soundEffects: "sound_effects",

      highContrast: "high_contrast",
      keyboardShortcuts: "keyboard_shortcuts",
      screenReader: "screen_reader",

      profileName: "contact_display_name",
      profileEmail: "contact_email",
      profilePicture: "contact_profile_picture",

      showOnline: "show_online",
      allowMessages: "allow_messages",
    }[key];
  },

  applyLive(key) {
    switch (key) {
      case "theme":
        document.body.dataset.theme = this.data.theme;
        break;

      case "accent":
        document.documentElement.style.setProperty("--accent", this.data.accent);
        break;

      case "fontSize":
        document.documentElement.style.fontSize = this.data.fontSize + "px";
        break;
    }
  },

  save() {
    localStorage.setItem("appSettings", JSON.stringify(this.data));
  },

  loadFromStorage() {
    const saved = localStorage.getItem("appSettings");
    if (saved) this.data = { ...this.data, ...JSON.parse(saved) };
  },

  reset() {
    localStorage.removeItem("appSettings");
    location.reload();
  }
};








