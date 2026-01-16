const MediaPreview = {
  cameraStream: null,
  micStream: null,
  micCtx: null,
  micAnalyser: null,
  micRaf: null,

  async startCamera(deviceId) {
    this.stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true
      });

      this.cameraStream = stream;

      const video = document.getElementById("camera_preview");
      if (video) video.srcObject = stream;
      else console.warn("camera_preview element not found");
    } catch (err) {
      console.error("Camera preview error:", err);
    }
  },

  stopCamera() {
    if (!this.cameraStream) return;
    this.cameraStream.getTracks().forEach(t => t.stop());
    this.cameraStream = null;
  },

  async startMic(deviceId) {
    this.stopMic();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      });

      this.micStream = stream;
      this.micCtx = new AudioContext();
      const src = this.micCtx.createMediaStreamSource(stream);

      this.micAnalyser = this.micCtx.createAnalyser();
      this.micAnalyser.fftSize = 512;
      src.connect(this.micAnalyser);

      const bar = document.querySelector("#mic_level_bar .mic-level-fill");
      if (!bar) {
        console.warn("mic_level_bar element missing");
        return;
      }

      const data = new Uint8Array(this.micAnalyser.frequencyBinCount);

      const loop = () => {
        this.micAnalyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b) / data.length;
        bar.style.width = Math.min(100, (avg / 255) * 100) + "%";
        this.micRaf = requestAnimationFrame(loop);
      };

      loop();
    } catch (err) {
      console.error("Mic preview error:", err);
    }
  },

  stopMic() {
    if (this.micRaf) cancelAnimationFrame(this.micRaf);
    if (this.micCtx) this.micCtx.close().catch(() => {});
    if (this.micStream) this.micStream.getTracks().forEach(t => t.stop());

    this.micStream = null;
    this.micCtx = null;
    this.micAnalyser = null;
    this.micRaf = null;
  },

  async testSpeaker(deviceId) {
    try {
      const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");

      if (audio.setSinkId && deviceId) {
        await audio.setSinkId(deviceId);
      }

      await audio.play();
    } catch (err) {
      console.warn("Speaker test failed:", err);
    }
  }
};

window.MediaPreview = MediaPreview;

