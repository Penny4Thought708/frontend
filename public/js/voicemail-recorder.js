// -------------------------------------------------------
// Voicemail Recorder UI + Upload
// -------------------------------------------------------

window.openVoicemailRecorder = function (toUserId) {
  const modal = document.getElementById("voicemailModal");
  const recordBtn = document.getElementById("vmRecordBtn");
  const stopBtn = document.getElementById("vmStopBtn");
  const sendBtn = document.getElementById("vmSendBtn");
  const status = document.getElementById("vmStatus");

  let mediaRecorder = null;
  let chunks = [];

  modal.style.display = "flex";
  status.textContent = "Ready to record";

  recordBtn.onclick = async () => {
    chunks = [];

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const fileName = `voicemail_${Date.now()}.webm`;

      // Upload to server
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
        setTimeout(() => (modal.style.display = "none"), 1000);
      } else {
        status.textContent = "Upload failed";
      }
    };

    mediaRecorder.start();
    status.textContent = "Recording…";
    recordBtn.style.display = "none";
    stopBtn.style.display = "inline-flex";
  };

  stopBtn.onclick = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      status.textContent = "Processing…";
    }
    stopBtn.style.display = "none";
    sendBtn.style.display = "none";
  };
};
