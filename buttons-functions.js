function initUI() {
  // Cache common elements
  const messageBox = document.getElementById("message_box");
  const toggleBtn = document.getElementById("toggleBtn");
  const navButtons = document.querySelectorAll("#side_nav_buttons button");
  const settingsContainer = document.getElementById("settings_container");
  const chatButton = document.getElementById("btn_chat_main");
  const panel = document.getElementById("conwrap");
  const serScreen = document.getElementById("search_panel");
  const saveBtn = document.getElementById("save_settings");
  const resetBtn = document.getElementById("reset_settings");

  // 🌙 Theme toggle
  toggleBtn?.addEventListener("click", () => {
    const html = document.documentElement;
    const currentTheme = html.getAttribute("data-theme");
    if (currentTheme === "dark") {
      html.setAttribute("data-theme", "light");
      toggleBtn.textContent = "☀️";
    } else {
      html.setAttribute("data-theme", "dark");
      toggleBtn.textContent = "🌙";
    }
  });

  // 🔘 Side nav active state
  function setActiveButton(btnId) {
    navButtons.forEach((b) => b.classList.remove("active"));
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add("active");
  }

 navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    navButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // ⭐ Hide main container by default
     conwrap.classList.add("hidden");

    switch (btn.id) {
      case "btn_chat_main":

        conwrap.classList.remove("hidden");
        break;

      case "btn_search":
        serScreen?.classList.toggle("active");
        break;

      case "btn_notifications":
        alert("Show notifications");
        break;

      case "btn_settings":
        settingsContainer?.classList.add("active");
        break;

      case "btn_help":
        alert("Show help guide");
        break;
    }
  });
});


  // 🗂 Panel toggles


  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      messageBox?.classList.remove("active");
      serScreen?.classList.remove("active");
      settingsContainer?.classList.remove("active");
      setActiveButton("");
    }
  });

  // Chat toggle
  chatButton?.addEventListener("click", () => {
    panel?.classList.toggle("active");
    serScreen?.classList.remove("active");
  });
// Grab elements
const themeSelect = document.getElementById("theme_select");
const accentColor = document.getElementById("accent_color");
const fontSize = document.getElementById("font_size");

// Apply settings live
function applySettings(settings) {
  if (settings.theme) {
    document.body.dataset.theme = settings.theme;
  }
  if (settings.accentColor) {
    document.documentElement.style.setProperty("--accent-color", settings.accentColor);
  }
  if (settings.fontSize) {
    document.documentElement.style.fontSize = settings.fontSize + "px";
  }
}

  // 📑 Dropdown accessibility
  const menuOp = document.getElementById("menu_op");
  if (menuOp) {
    const menuWrapper = menuOp.closest(".menu-wrapper");
    const dropdown = menuWrapper.querySelector(".dropdown-content");
    const items = Array.from(dropdown.querySelectorAll("button"));

    menuOp.addEventListener("click", (e) => {
      e.stopPropagation();
      menuWrapper.classList.toggle("open");
      const expanded = menuWrapper.classList.contains("open");
      menuOp.setAttribute("aria-expanded", expanded);
      if (expanded && items.length > 0) items[0].focus();
    });

    document.addEventListener("click", (e) => {
      if (!menuWrapper.contains(e.target)) {
        menuWrapper.classList.remove("open");
        menuOp.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (!menuWrapper.classList.contains("open")) return;
      const currentIndex = items.indexOf(document.activeElement);
      switch (e.key) {
        case "Escape":
          menuWrapper.classList.remove("open");
          menuOp.setAttribute("aria-expanded", "false");
          menuOp.focus();
          break;
        case "ArrowDown":
          e.preventDefault();
          items[(currentIndex + 1) % items.length].focus();
          break;
        case "ArrowUp":
          e.preventDefault();
          items[(currentIndex - 1 + items.length) % items.length].focus();
          break;
        case "Home":
          e.preventDefault();
          items[0].focus();
          break;
        case "End":
          e.preventDefault();
          items[items.length - 1].focus();
          break;
      }
    });
  }
}
// Run initializer once DOM is ready
document.addEventListener("DOMContentLoaded", initUI);
/* ---------------------------------------------------------
   SETTINGS CONTROLLER — GOOGLE MEET STYLE
   Works with your IDs and WebRTC controller
--------------------------------------------------------- */

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

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  async init() {
    this.loadFromStorage();
    this.bindUI();
    await this.loadDevices();
    this.applyUI();
  },

  /* ---------------------------------------------------------
     LOAD DEVICES (Camera, Mic, Speaker)
  --------------------------------------------------------- */
  async loadDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const cams = devices.filter(d => d.kind === "videoinput");
      const mics = devices.filter(d => d.kind === "audioinput");
      const outs = devices.filter(d => d.kind === "audiooutput");

      this.populateSelect("camera_select", cams);
      this.populateSelect("microphone_select", mics);
      this.populateSelect("speaker_select", outs);

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

  /* ---------------------------------------------------------
     BIND UI EVENTS
  --------------------------------------------------------- */
  bindUI() {
    // Appearance
    this.bind("theme_select", "theme");
    this.bind("accent_color", "accent");
    this.bind("font_size", "fontSize");

    // Video
    this.bind("camera_select", "camera");
    this.bind("resolution_select", "resolution");
    this.bind("background_blur", "backgroundBlur", true);
    this.bind("mirror_video", "mirrorVideo", true);

    // Audio
    this.bind("microphone_select", "microphone");
    this.bind("speaker_select", "speaker");
    this.bind("noise_suppression", "noiseSuppression", true);
    this.bind("echo_cancellation", "echoCancellation", true);
    this.bind("auto_gain", "autoGain", true);

    // Notifications
    this.bind("call_alerts", "callAlerts", true);
    this.bind("message_alerts", "messageAlerts", true);
    this.bind("sound_effects", "soundEffects", true);

    // Accessibility
    this.bind("high_contrast", "highContrast", true);
    this.bind("keyboard_shortcuts", "keyboardShortcuts", true);
    this.bind("screen_reader", "screenReader", true);

    // Profile
    this.bind("contact_display_name", "profileName");
    this.bind("contact_email", "profileEmail");
    this.bindFile("contact_profile_picture", "profilePicture");

    // Privacy
    this.bind("show_online", "showOnline", true);
    this.bind("allow_messages", "allowMessages", true);

    // Save / Reset
    document.getElementById("save_settings").addEventListener("click", () => this.save());
    document.getElementById("reset_settings").addEventListener("click", () => this.reset());
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
      if (file) {
        this.data[key] = file;
      }
    });
  },

  /* ---------------------------------------------------------
     APPLY SETTINGS TO UI
  --------------------------------------------------------- */
  applyUI() {
    for (const key in this.data) {
      const el = document.getElementById(this.mapKeyToId(key));
      if (!el) continue;

      if (typeof this.data[key] === "boolean") {
        el.checked = this.data[key];
      } else if (key === "profilePicture") {
        // handled separately
      } else {
        el.value = this.data[key];
      }
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

  /* ---------------------------------------------------------
     LIVE APPLY (Google Meet style)
  --------------------------------------------------------- */
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

      case "backgroundBlur":
        // integrate with your WebRTC blur pipeline
        break;

      case "mirrorVideo":
        // apply CSS transform to local preview
        break;

      case "microphone":
      case "camera":
      case "speaker":
        // integrate with WebRTCController
        break;
    }
  },

  /* ---------------------------------------------------------
     SAVE / LOAD / RESET
  --------------------------------------------------------- */
  save() {
    localStorage.setItem("appSettings", JSON.stringify(this.data));
    window.showNotification("Settings Saved", "Your preferences have been updated.");
  },

  loadFromStorage() {
    const saved = localStorage.getItem("appSettings");
    if (saved) {
      this.data = { ...this.data, ...JSON.parse(saved) };
    }
  },

  reset() {
    localStorage.removeItem("appSettings");
    location.reload();
  }
};

/* ---------------------------------------------------------
   INIT ON LOAD
--------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  Settings.init();
});
