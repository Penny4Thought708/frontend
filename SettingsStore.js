const SettingsStore = {
  defaults: {
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

  data: {},

  load() {
    const saved = localStorage.getItem("appSettings");
    this.data = saved ? { ...this.defaults, ...JSON.parse(saved) } : { ...this.defaults };
  },

  save() {
    localStorage.setItem("appSettings", JSON.stringify(this.data));
  },

  reset() {
    localStorage.removeItem("appSettings");
    this.data = { ...this.defaults };
  }
};
