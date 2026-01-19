// public/js/dashboard/NotificationUI.js

export function triggerBellShake(bell) {
  bell.classList.add("active");
  setTimeout(() => bell.classList.remove("active"), 1000);
}

export function showNotificationPopup() {
  const note = document.getElementById("note-message");
  if (note) note.classList.add("active");
}

export function initNotificationUI() {
  const bell = document.querySelector(".notification-bell");
  const badge = document.querySelector(".badge");
  const closeBtn = document.getElementById("close_notifications");

  // Simulated notification
  setTimeout(() => {
//    badge.textContent = "2";
    triggerBellShake(bell);
  }, 2000);

  closeBtn?.addEventListener("click", () => {
    document.getElementById("note-message")?.classList.remove("active");
  });
}

