/* ============================================================
   HYBRID FLOATING‑SPACE UI CONTROLLER — FINAL ARCHITECTURE
============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  FloatingWindows.init();
  Settings.init();
});

/* ============================================================
   MAIN UI CONTROLLER
============================================================ */
function initUI() {
  const messagingPanel = document.getElementById("messagingPanel");
  const directoryPanel = document.getElementById("directoryPanel");
  const callWindow = document.getElementById("callWindow");

  const profileWindow = document.getElementById("profileWindow");
  const settingsWindow = document.getElementById("settingsWindow");
  const fullProfileModal = document.getElementById("fullProfileModal");

  const voicemailModal = document.getElementById("voicemailModal");
  const logoutModal = document.getElementById("logoutModal");

  const railButtons = document.querySelectorAll(".app-rail .rail-btn");
  const toggleBtn = document.getElementById("toggleBtn");
  const videoBtn = document.getElementById("videoBtn");

  const newPill = document.getElementById("newMessagesPill");
  const msgWin = document.getElementById("messageWin");

  /* -----------------------------------------------------------
     PANEL STATE
  ----------------------------------------------------------- */
  const UIX = {
    hideAllOverlays() {
      [directoryPanel, profileWindow, settingsWindow, fullProfileModal, voicemailModal, logoutModal, callWindow]
        .forEach(el => el && el.classList.add("hidden"));
      document.body.classList.remove("panel-open");
    },

    showMessaging() {
      this.hideAllOverlays();
      messagingPanel?.classList.remove("hidden");
      document.body.classList.remove("panel-open");
    },

    showDirectory() {
      if (!directoryPanel) return;
      this.hideAllOverlays();
      messagingPanel?.classList.add("hidden");
      directoryPanel.classList.remove("hidden");
      directoryPanel.classList.add("dir-visible");
      directoryPanel.setAttribute("aria-hidden", "false");
      document.body.classList.add("panel-open");
    },

    showFloating(win) {
      if (!win) return;
      this.hideAllOverlays();
      messagingPanel?.classList.add("hidden");
      win.classList.remove("hidden");
      FloatingWindows.focus(win);
      document.body.classList.add("panel-open");
    },

    showModal(modal) {
      if (!modal) return;
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("panel-open");
    },

    hideModal(modal) {
      if (!modal) return;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("panel-open");
    },

    showCallWindow() {
      if (!callWindow) return;
      this.hideAllOverlays();
      messagingPanel?.classList.add("hidden");
      callWindow.classList.remove("hidden");
      callWindow.setAttribute("aria-hidden", "false");
      document.body.classList.add("panel-open");
    },

    endCall() {
      if (!callWindow) return;
      callWindow.classList.add("hidden");
      callWindow.setAttribute("aria-hidden", "true");
      this.showMessaging();
    }
  };

  /* -----------------------------------------------------------
     DIRECTORY SECTION SWITCHER
  ----------------------------------------------------------- */
  (function initDirectorySwitcher() {
    const navButtons = document.querySelectorAll(".directory-nav button");
    const sections = document.querySelectorAll(".dir-section");
    if (!navButtons.length || !sections.length) return;

    function showSection(sectionName) {
      const newSection = document.getElementById(`dir-${sectionName}`);
      const active = document.querySelector(".dir-section.dir-active");
      if (active === newSection) return;

      if (active) {
        active.classList.remove("dir-active");
        active.classList.add("hidden");
      }

      if (!newSection) return;
      newSection.classList.remove("hidden");
      requestAnimationFrame(() => newSection.classList.add("dir-active"));
    }

    navButtons.forEach(btn => {
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => {
        const section = btn.dataset.section;
        navButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        showSection(section);
      });
    });

    showSection("contacts");
    navButtons[0]?.classList.add("active");
  })();

  /* -----------------------------------------------------------
     THEME TOGGLE
  ----------------------------------------------------------- */
  toggleBtn?.addEventListener("click", () => {
    const body = document.body;
    const isDark = body.classList.contains("dark-mode");
    body.classList.toggle("dark-mode", !isDark);
    body.classList.toggle("light-mode", isDark);
    toggleBtn.setAttribute("aria-pressed", String(!isDark));
  });

  /* -----------------------------------------------------------
     RAIL BUTTON ROUTER
  ----------------------------------------------------------- */
  railButtons.forEach(btn => {
    btn.setAttribute("role", "button");
    btn.addEventListener("click", () => {
      railButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      switch (btn.id) {
        case "btn_chat_main":
          UIX.showMessaging();
          break;
        case "contact_widget":
          UIX.showDirectory();
          break;
        case "btn_search":
          UIX.showFloating(profileWindow); // placeholder: attach real search window if added
          break;
        case "btn_settings":
          UIX.showFloating(settingsWindow);
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
     VIDEO / CALL WINDOW
  ----------------------------------------------------------- */
  videoBtn?.addEventListener("click", () => {
    UIX.showCallWindow();
  });

  document.getElementById("end-call")?.addEventListener("click", () => {
    UIX.endCall();
  });

  /* -----------------------------------------------------------
     LOGOUT MODAL
  ----------------------------------------------------------- */
  window.showLogoutModal = function () {
    UIX.showModal(logoutModal);
  };

  document.getElementById("cancelLogout")?.addEventListener("click", () => {
    UIX.hideModal(logoutModal);
  });

  document.getElementById("confirmLogout")?.addEventListener("click", () => {
    // plug in real logout
    UIX.hideModal(logoutModal);
    showToast("Logged out");
  });

  /* -----------------------------------------------------------
     VOICEMAIL MODAL
  ----------------------------------------------------------- */
  document.getElementById("vmCancelBtn")?.addEventListener("click", () => {
    UIX.hideModal(voicemailModal);
  });

  /* -----------------------------------------------------------
     FULL PROFILE CLOSE
  ----------------------------------------------------------- */
  document.getElementById("closeFullProfile")?.addEventListener("click", () => {
    fullProfileModal?.classList.add("hidden");
    UIX.showMessaging();
  });

  /* -----------------------------------------------------------
     ESC KEY
  ----------------------------------------------------------- */
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      UIX.showMessaging();
      railButtons.forEach(b => b.classList.remove("active"));
    }
  });

  /* -----------------------------------------------------------
     NEW MESSAGES PILL
  ----------------------------------------------------------- */
  if (msgWin && newPill) {
    function isAtBottom() {
      return msgWin.scrollHeight - msgWin.scrollTop - msgWin.clientHeight < 10;
    }

    function showPill() {
      newPill.classList.remove("hidden");
      requestAnimationFrame(() => newPill.classList.add("show"));
    }

    function hidePill() {
      newPill.classList.remove("show");
      setTimeout(() => newPill.classList.add("hidden"), 200);
    }

    msgWin.addEventListener("scroll", () => {
      if (isAtBottom()) hidePill();
      else showPill();
    });

    newPill.addEventListener("click", () => {
      msgWin.scrollTo({ top: msgWin.scrollHeight, behavior: "smooth" });
      hidePill();
    });
  }

  /* -----------------------------------------------------------
     ARIA HOOKS
  ----------------------------------------------------------- */
  if (directoryPanel) {
    directoryPanel.setAttribute("role", "complementary");
    directoryPanel.setAttribute("aria-label", "Directory");
  }
  if (messagingPanel) {
    messagingPanel.setAttribute("role", "main");
  }
}

/* ============================================================
   FLOATING WINDOW ENGINE
============================================================ */
const FloatingWindows = {
  z: 50,

  init() {
    const windows = document.querySelectorAll(".floating-window");
    windows.forEach(win => {
      this.makeDraggable(win);
      win.addEventListener("mousedown", () => this.focus(win));
    });
  },

  focus(win) {
    this.z++;
    win.style.zIndex = this.z;
    win.classList.add("fw-active");
  },

  makeDraggable(win) {
    let isDown = false;
    let offsetX = 0;
    let offsetY = 0;

    win.addEventListener("mousedown", (e) => {
      if (!e.target.closest(".floating-body")) return;
      isDown = true;
      this.focus(win);
      offsetX = e.clientX - win.offsetLeft;
      offsetY = e.clientY - win.offsetTop;
      win.style.transition = "none";
    });

    document.addEventListener("mouseup", () => {
      isDown = false;
      win.style.transition = "";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      win.style.left = `${e.clientX - offsetX}px`;
      win.style.top = `${e.clientY - offsetY}px`;
    });
  }
};

/* ============================================================
   TOAST UTILITY
============================================================ */
function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = msg;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
  }, 2000);

  setTimeout(() => toast.remove(), 2600);
}

/* ============================================================
   SETTINGS CONTROLLER (UNCHANGED CORE, ARIA-SAFE)
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





















