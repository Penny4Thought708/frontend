// public/js/dashboard/StatusIndicators.js

export function setSignalStrength(level) {
  document.querySelectorAll(".signal_bars .bar").forEach((bar, index) => {
    bar.classList.toggle("active", index < level);
  });
}

export function setBatteryLevel(percent) {
  const level = document.querySelector(".battery .level");
  if (level) level.style.width = percent + "%";
}
