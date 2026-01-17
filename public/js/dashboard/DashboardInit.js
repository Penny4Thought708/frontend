// public/js/dashboard/DashboardInit.js

import { initNotificationUI } from "./NotificationUI.js";
import { createPresenceClient } from "./PresenceClient.js";
import { initDraggableWidgets } from "./Widgets.js";
import { initClock } from "./Clock.js";
import { setSignalStrength, setBatteryLevel } from "./StatusIndicators.js";
import { initTodoList } from "./TodoList.js";
import { initNavigationUI } from "./NavigationUI.js";
import { initCallUI } from "../webrtc/CallUI.js";

// ✔ FIXED: relative import (GitHub Pages cannot load /NewApp/... paths)
import { socket } from "../socket.js";

// ✔ FIXED: dynamic session getter
import { getMyUserId } from "../session.js";

// ✔ FIXED: contacts module path
import { updateContactStatus, loadContacts } from "./contacts.js";


document.addEventListener("DOMContentLoaded", () => {
  initNotificationUI();
  initDraggableWidgets();
  initClock();
  initTodoList();
  initNavigationUI();

  setSignalStrength(3);
  setBatteryLevel(85);

  // ⭐ Pass the FUNCTION, not the result
  createPresenceClient(
    socket,
    getMyUserId, // <-- FIXED
    updateContactStatus
  );

  loadContacts();

  if (window.rtc) {
    initCallUI(window.rtc);
  }
});

