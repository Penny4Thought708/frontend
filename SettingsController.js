const SettingsController = {
  async init() {
    SettingsStore.load();
    this.bindUI();
    await DeviceManager.init();
    this.applyUI();
 
  },

  /* ---------------- UI Binding ---------------- */
  bindUI() {
    const bind = (id, key, isCheck = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        SettingsStore.data[key] = isCheck ? el.checked : el.value;
        this.applyLive(key);
        SettingsStore.save();
      });
    };

    bind("theme_select", "theme");
    bind("accent_color", "accent");
    bind("font_size", "fontSize");

    bind("camera_select", "camera");
    bind("resolution_select", "resolution");
    bind("background_blur", "backgroundBlur", true);
    bind("mirror_video", "mirrorVideo", true);

    bind("microphone_select", "microphone");
    bind("speaker_select", "speaker");
    bind("noise_suppression", "noiseSuppression", true);
    bind("echo_cancellation", "echoCancellation", true);
    bind("auto_gain", "autoGain", true);

    bind("call_alerts", "callAlerts", true);
    bind("message_alerts", "messageAlerts", true);
    bind("sound_effects", "soundEffects", true);

    bind("high_contrast", "highContrast", true);
    bind("keyboard_shortcuts", "keyboardShortcuts", true);
    bind("screen_reader", "screenReader", true);

    bind("contact_display_name", "profileName");
    bind("contact_email", "profileEmail");

    bind("show_online", "showOnline", true);
    bind("allow_messages", "allowMessages", true);
  },

  /* ---------------- Device Dropdowns ---------------- */
  updateDeviceDropdowns() {
    this.fill("camera_select", DeviceManager.cameras);
    this.fill("microphone_select", DeviceManager.microphones);
    this.fill("speaker_select", DeviceManager.speakers);
  },

  fill(id, list) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = "";
    list.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || "Unnamed Device";
      el.appendChild(opt);
    });
  },

  /* ---------------- Apply UI ---------------- */
  applyUI() {
    for (const key in SettingsStore.data) {
      const id = this.mapKeyToId(key);
      const el = document.getElementById(id);
      if (!el) continue;

      const val = SettingsStore.data[key];
      if (typeof val === "boolean") el.checked = val;
      else if (key !== "profilePicture") el.value = val;
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

      showOnline: "show_online",
      allowMessages: "allow_messages",
    }[key];
  },

  /* ---------------- Live Apply ---------------- */
  applyLive(key) {
    const val = SettingsStore.data[key];

    switch (key) {
          case "camera":
          MediaPreview.startCamera(val);
          window.RTC?.switchCamera?.(val);
          break;

          case "microphone":
          MediaPreview.startMic(val);
          window.RTC?.switchMicrophone?.(val);
          break;

          case "speaker":
          window.RTC?.switchSpeaker?.(val);
          break;


      case "mirrorVideo":
        const vid = document.getElementById("camera_preview");
        if (vid) vid.style.transform = val ? "scaleX(-1)" : "none";
        window.RTC?.setMirror?.(val);
        break;

      case "backgroundBlur":
        window.RTC?.setBackgroundBlur?.(val);
        break;

      case "theme":
        document.body.dataset.theme = val;
        break;

      case "accent":
        document.documentElement.style.setProperty("--accent", val);
        break;

      case "fontSize":
        document.documentElement.style.fontSize = val + "px";
        break;
    }
  },
};
window.SettingsController = SettingsController;


