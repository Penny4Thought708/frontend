// public/js/recording-indicator.js

const recordingIndicator = document.querySelector(".recording-indicator");
const waveformCanvas = document.getElementById("waveformCanvas");
const recordTimerEl = document.getElementById("recordTimer");
const slideCancelEl = document.getElementById("slideCancel");

let timerInterval = null;
let startTime = null;

export function showRecordingUI() {
  if (recordingIndicator) recordingIndicator.style.display = "flex";
  if (waveformCanvas) waveformCanvas.style.display = "block";
  if (recordTimerEl) recordTimerEl.style.display = "inline-block";
  if (slideCancelEl) slideCancelEl.style.display = "inline-block";

  startTime = Date.now();
  startTimer();
}

export function hideRecordingUI() {
  if (recordingIndicator) recordingIndicator.style.display = "none";
  if (waveformCanvas) waveformCanvas.style.display = "none";
  if (recordTimerEl) recordTimerEl.style.display = "none";
  if (slideCancelEl) slideCancelEl.style.display = "none";

  stopTimer();
}

function startTimer() {
  if (!recordTimerEl) return;
  clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const seconds = Math.floor(elapsed / 1000);
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    recordTimerEl.textContent = `${m}:${s}`;
  }, 200);
}

function stopTimer() {
  clearInterval(timerInterval);
}

/**
 * Wire socket events for recording indicators (optional)
 */
export function initRecordingSocketHandlers(socket) {
  socket.on("recording:start", () => {
    showRecordingUI();
  });

  socket.on("recording:stop", () => {
    hideRecordingUI();
  });
}
