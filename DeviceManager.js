const DeviceManager = {
  cameras: [],
  microphones: [],
  speakers: [],

  async init() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (err) {
      console.warn("Permissions denied:", err);
    }

    await this.refresh();

    navigator.mediaDevices.addEventListener("devicechange", () => this.refresh());
  },

  async refresh() {
    const devices = await navigator.mediaDevices.enumerateDevices();

    this.cameras = devices.filter(d => d.kind === "videoinput");
    this.microphones = devices.filter(d => d.kind === "audioinput");
    this.speakers = devices.filter(d => d.kind === "audiooutput");

    if (window.SettingsController) {
      SettingsController.updateDeviceDropdowns();
    }
  }
};

window.DeviceManager = DeviceManager;
