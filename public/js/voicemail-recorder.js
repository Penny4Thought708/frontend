// -------------------------------------------------------
// Voicemail Recorder UI + Upload (Updated for new call flow)
// -------------------------------------------------------

export function openVoicemailRecorder(toUserId) {

  const modal = document.getElementById("voicemailModal");
  const recordBtn = document.getElementById("vmRecordBtn");
  const stopBtn = document.getElementById("vmStopBtn");
  const playBtn = document.getElementById("vmPlayBtn");
  const sendBtn = document.getElementById("vmSendBtn");
  const deleteBtn = document.getElementById("vmDeleteBtn");
  const status = document.getElementById("vmStatus");
  const timerEl = document.getElementById("vmTimer");
  const wave = document.querySelector(".vm-wave");

  let mediaRecorder = null;
  let chunks = [];
  let audioBlob = null;
  let audioURL = null;
  let audio = null;
  let timer = null;
  let seconds = 0;

  // Reset UI
  modal.classList.remove("hidden");

  modal.style.display = "flex";
  modal.classList.add("open");

  status.textContent = "Ready to record";
  timerEl.textContent = "00:00";

  recordBtn.style.display = "inline-flex";
  stopBtn.style.display = "none";
  playBtn.style.display = "none";
  sendBtn.style.display = "none";
  deleteBtn.style.display = "none";

  wave.style.opacity = "0.3";

  // Timer
  function startTimer() {
    seconds = 0;
    timer = setInterval(() => {
      seconds++;
      const m = String(Math.floor(seconds / 60)).padStart(2, "0");
      const s = String(seconds % 60).padStart(2, "0");
      timerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timer);
    timer = null;
  }

  // Start recording
  recordBtn.onclick = async () => {
    chunks = [];

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    window._vmRecorderStream = stream;

    mediaRecorder = new MediaRecorder(stream);
    window._vmMediaRecorder = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

    mediaRecorder.onstop = () => {
      audioBlob = new Blob(chunks, { type: "audio/webm" });
      audioURL = URL.createObjectURL(audioBlob);
      audio = new Audio(audioURL);

      status.textContent = "Preview your message";

      playBtn.style.display = "inline-flex";
      sendBtn.style.display = "inline-flex";
      deleteBtn.style.display = "inline-flex";
    };

    mediaRecorder.start();
    startTimer();

    status.textContent = "Recording…";
    wave.style.opacity = "1";

    recordBtn.style.display = "none";
    stopBtn.style.display = "inline-flex";
  };

  // Stop recording
  stopBtn.onclick = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      stopTimer();
      status.textContent = "Processing…";
    }
    stopBtn.style.display = "none";
    wave.style.opacity = "0.3";
  };

  // Playback
  playBtn.onclick = () => {
    if (audio) audio.play();
  };

  // Delete / re-record
  deleteBtn.onclick = () => {
    audio = null;
    audioBlob = null;
    audioURL = null;

    status.textContent = "Ready to record";
    timerEl.textContent = "00:00";

    playBtn.style.display = "none";
    sendBtn.style.display = "none";
    deleteBtn.style.display = "none";
    recordBtn.style.display = "inline-flex";
  };

  // Send voicemail
  sendBtn.onclick = async () => {
    if (!audioBlob) return;

    status.textContent = "Uploading…";

    const formData = new FormData();
    formData.append("file", audioBlob, `voicemail_${Date.now()}.webm`);
    formData.append("toUserId", toUserId);

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
};

// -------------------------------------------------------
// Close Voicemail Modal
// -------------------------------------------------------

function closeVoicemailModal() {
  const modal = document.getElementById("voicemailModal");

  // Stop recorder if active
  try {
    if (window._vmRecorderStream) {
      window._vmRecorderStream.getTracks().forEach(t => t.stop());
      window._vmRecorderStream = null;
    }
    if (window._vmMediaRecorder && window._vmMediaRecorder.state !== "inactive") {
      window._vmMediaRecorder.stop();
    }
  } catch {}

  modal.classList.remove("open");
  modal.classList.add("closing");

  setTimeout(() => {
    modal.classList.remove("closing");
    modal.style.display = "none";
  }, 450);
}



