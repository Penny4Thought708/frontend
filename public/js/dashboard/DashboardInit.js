// public/js/dashboard/DashboardInit.js

import { initNotificationUI } from "./NotificationUI.js";
import { createPresenceClient } from "./PresenceClient.js";
import { initDraggableWidgets } from "./Widgets.js";
import { initClock } from "./Clock.js";
import { setSignalStrength, setBatteryLevel } from "./StatusIndicators.js";
import { initTodoList } from "./TodoList.js";
import { initNavigationUI } from "./NavigationUI.js";

import { updateContactStatus, loadContacts } from "./contacts.js";

// Core systems
import { socket } from "../socket.js";
import { getMyUserId } from "../session.js";

// WebRTC
import { WebRTCController } from "../webrtc/WebRTCController.js";
import { initCallUI } from "../webrtc/CallUI.js";

document.addEventListener("DOMContentLoaded", () => {
  /* -------------------------------------------------------
     Dashboard UI Initialization
  ------------------------------------------------------- */
  initNotificationUI();
  initDraggableWidgets();
  initClock();
  initTodoList();
  initNavigationUI();

  // Fake device indicators (UI only)
  setSignalStrength(3);
  setBatteryLevel(85);

  /* -------------------------------------------------------
     Presence + Contacts
  ------------------------------------------------------- */
  createPresenceClient(socket, getMyUserId, updateContactStatus);
  loadContacts();

  /* -------------------------------------------------------
     WebRTC Initialization
  ------------------------------------------------------- */

  // Create the controller ONCE and expose globally for debugging
  const rtc = new WebRTCController(socket);
  window.rtc = rtc;

  // Bind UI buttons + media elements to the controller
  initCallUI(rtc);

  console.log("[Dashboard] WebRTC initialized");
});



