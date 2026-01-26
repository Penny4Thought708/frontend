// public/js/dashboard/DashboardInit.js

import { initNotificationUI } from "./NotificationUI.js";
import { createPresenceClient } from "./PresenceClient.js";
import { initDraggableWidgets } from "./Widgets.js";
import { initClock } from "./Clock.js";
import { setSignalStrength, setBatteryLevel } from "./StatusIndicators.js";
import { initTodoList } from "./TodoList.js";
import { initNavigationUI } from "./NavigationUI.js";

// IMPORTANT — contacts.js is NOT in /dashboard/
import {
  updateContactStatus,
  loadContacts
} from "./contacts.js";

// Core systems
import { socket } from "../socket.js";
import { getMyUserId } from "../session.js";

// WebRTC
import { WebRTCController } from "../webrtc/WebRTCController.js";
import { initCallUI } from "../webrtc/CallUI.js";

/* -------------------------------------------------------
   Wait for Identity (prevents early initialization)
------------------------------------------------------- */
async function waitForIdentity() {
  let id = getMyUserId();
  while (!id) {
    await new Promise(r => setTimeout(r, 50));
    id = getMyUserId();
  }
  return id;
}

document.addEventListener("DOMContentLoaded", async () => {
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
     Identity MUST load before anything else
  ------------------------------------------------------- */
  const myId = await waitForIdentity();
  console.log("[Dashboard] Identity ready:", myId);

  /* -------------------------------------------------------
     Presence + Contacts (AFTER identity)
  ------------------------------------------------------- */
  window.pendingPresence = new Map();

  // Presence client now works with your monolithic contacts.js
  createPresenceClient(
    socket,
    getMyUserId,
    updateContactStatus,
    window.pendingPresence
  );

  // Load contacts AFTER presence client is ready
  await loadContacts();

  /* -------------------------------------------------------
     WebRTC Initialization
  ------------------------------------------------------- */
  const rtc = new WebRTCController(socket);
  window.rtc = rtc;

  initCallUI(rtc);

  console.log("[Dashboard] WebRTC initialized");
});



