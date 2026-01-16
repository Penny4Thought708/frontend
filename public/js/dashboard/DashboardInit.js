// C:\xampp\htdocs\NewApp\public\js\dashboard\DashboardInit.js

import { initNotificationUI } from "./NotificationUI.js";
import { createPresenceClient } from "./PresenceClient.js";
import { initDraggableWidgets } from "./Widgets.js";
import { initClock } from "./Clock.js";
import { setSignalStrength, setBatteryLevel } from "./StatusIndicators.js";
import { initTodoList } from "./TodoList.js";
import { initNavigationUI } from "./NavigationUI.js";
import { initCallUI } from "../webrtc/CallUI.js";
import { socket } from "/NewApp/public/js/socket.js";

// ⭐ Use the dynamic session getter (function)
import { getMyUserId } from "../session.js";

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
