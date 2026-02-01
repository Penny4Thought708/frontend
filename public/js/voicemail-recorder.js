// -------------------------------------------------------
// Voicemail Recorder UI + Upload (Upgraded for new call flow)
// -------------------------------------------------------

window.openVoicemailRecorder = function (toUserId) {
  const modal = document.getElementById("voicemailModal");
  const recordBtn = document.getElementById("vmRecordBtn");
  const stopBtn = document.getElementById("vmStopBtn");
  const status = document.getElementById("vmStatus");

  let mediaRecorder = null;
  let chunks = [];

  // Play voicemail prompt
  try {
    const prompt = new Audio("/audio/voicemail_prompt.mp3");
    prompt.play().catch(() => {});
  } catch (err) {
    console.warn("Voicemail prompt failed:", err);
  }

  modal.style.display = "flex";

  // ⭐ THIS triggers the slide‑in animation
  modal.classList.add("open");

  status.textContent = "Ready to record";

  // Reset UI
  recordBtn.style.display = "inline-flex";
  stopBtn.style.display = "none";

  // Start recording
  recordBtn.onclick = async () => {
    chunks = [];

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const fileName = `voicemail_${Date.now()}.webm`;

      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("toUserId", toUserId);

      status.textContent = "Uploading…";

      const res = await fetch("/api/voicemail/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (json.success) {
        status.textContent = "Voicemail sent!";
        setTimeout(() => closeVoicemailModal(), 1000);
      } else {
        status.textContent = "Upload failed";
      }
    };

    mediaRecorder.start();
    status.textContent = "Recording…";
    recordBtn.style.display = "none";
    stopBtn.style.display = "inline-flex";
  };

  // Stop recording
  stopBtn.onclick = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      status.textContent = "Processing…";
    }
    stopBtn.style.display = "none";
  };
};
