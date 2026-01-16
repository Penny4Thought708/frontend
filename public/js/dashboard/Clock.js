// public/js/dashboard/Clock.js

export function initClock() {
  function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const clock = document.querySelector(".clock");
    if (clock) clock.textContent = timeString;
  }

  updateClock();
  setInterval(updateClock, 1000);
}
