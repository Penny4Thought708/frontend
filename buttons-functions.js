/* ============================================================
   HYBRID FLOATING‑SPACE UI CONTROLLER — FINAL ARCHITECTURE
============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  FloatingWindows.init();
  Settings.init();
});

/* ============================================================
   MAIN UI CONTROLLER
============================================================ */
function initUI() {
  const messagingPanel = document.getElementById("messagingPanel");
  const directoryPanel = document.getElementById("directoryPanel");

  // ❗ Call window is intentionally NOT controlled here anymore
  const callWindow = document.getElementById("callWindow");

  const profileWindow = document.getElementById("profileWindow");
  const settingsWindow = document.getElementById("settingsWindow");
  const fullProfileModal = document.getElementById("fullProfileModal");

  const voicemailModal = document.getElementById("voicemailModal");
  const logoutModal = document.getElementById("logoutModal");

  const railButtons = document.querySelectorAll(".app-rail .rail-btn");
  const toggleBtn = document.getElementById("toggleBtn");

  const newPill = document.getElementById("newMessagesPill");
  const msgWin = document.getElementById("messageWin");

  /* -----------------------------------------------------------
     PANEL STATE
  ----------------------------------------------------------- */
  const UIX = {
    hideAllOverlays() {
      // ❗ callWindow REMOVED from this list
      [
        directoryPanel,
        profileWindow,
        settingsWindow,
        fullProfileModal,
        voicemailModal,
        logoutModal
      ].forEach(el => el && el.classList.add("hidden"));

      document.body.classList.remove("panel-open");
    },

    showMessaging() {
      this.hideAllOverlays();
      messagingPanel?.classList.remove("hidden");
      document.body.classList.remove("panel-open");
    },

    showDirectory() {
      if (!directoryPanel) return;
      this.hideAllOverlays();
      messagingPanel?.classList.add("hidden");
      directoryPanel.classList.remove("hidden");
      directoryPanel.classList.add("dir-visible");
      directoryPanel.setAttribute("aria-hidden", "false");
      document.body.classList.add("panel-open");
    },

    showFloating(win) {
      if (!win) return;
      this.hideAllOverlays();
      messagingPanel?.classList.add("hidden");
      win.classList.remove("hidden");
      FloatingWindows.focus(win);
      document.body.classList.add("panel-open");
    },

    showModal(modal) {
      if (!modal) return;
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("panel-open");
    },

    hideModal(modal) {
      if (!modal) return;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("panel-open");
    },

    // ❗ Call window is now controlled ONLY by CallUI.js
    // These functions remain for compatibility but do nothing harmful.
    showCallWindow() {
      console.warn("[UIX] showCallWindow() called — ignored. CallUI controls this.");
    },

    endCall() {
      console.warn("[UIX] endCall() called — ignored. CallUI controls this.");
    }
  };

  /* -----------------------------------------------------------
     DIRECTORY SECTION SWITCHER
  ----------------------------------------------------------- */
  (function initDirectorySwitcher() {
    const navButtons = document.querySelectorAll(".directory-nav button");
    const sections = document.querySelectorAll(".dir-section");
    if (!navButtons.length || !sections.length) return;

    function showSection(sectionName) {
      const newSection = document.getElementById(`dir-${sectionName}`);
      const active = document.querySelector(".dir-section.dir-active");
      if (active === newSection) return;

      if (active) {
        active.classList.remove("dir-active");
        active.classList.add("hidden");
      }

      if (!newSection) return;
      newSection.classList.remove("hidden");
      requestAnimationFrame(() => newSection.classList.add("dir-active"));
    }

    navButtons.forEach(btn => {
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => {
        const section = btn.dataset.section;
        navButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        showSection(section);
      });
    });

    showSection("contacts");
    navButtons[0]?.classList.add("active");
  })();

  /* -----------------------------------------------------------
     THEME TOGGLE
  ----------------------------------------------------------- */
  toggleBtn?.addEventListener("click", () => {
    const body = document.body;
    const isDark = body.classList.contains("dark-mode");
    body.classList.toggle("dark-mode", !isDark);
    body.classList.toggle("light-mode", isDark);
    toggleBtn.setAttribute("aria-pressed", String(!isDark));
  });

  /* -----------------------------------------------------------
     RAIL BUTTON ROUTER
  ----------------------------------------------------------- */
  railButtons.forEach(btn => {
    btn.setAttribute("role", "button");
    btn.addEventListener("click", () => {
      railButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      switch (btn.id) {
        case "btn_chat_main":
          UIX.showMessaging();
          break;
        case "contact_widget":
          UIX.showDirectory();
          break;
        case "btn_search":
          UIX.showFloating(profileWindow);
          break;
        case "btn_settings":
          UIX.showFloating(settingsWindow);
          break;
        case "btn_notifications":
          showToast("Notifications panel coming soon");
          break;
        case "btn_help":
          showToast("Help panel coming soon");
          break;
      }
    });
  });

  /* -----------------------------------------------------------
     ❗ REMOVED: videoBtn → showCallWindow()
     Call window is now opened ONLY by CallUI.js
  ----------------------------------------------------------- */

  /* -----------------------------------------------------------
     LOGOUT MODAL
  ----------------------------------------------------------- */
  window.showLogoutModal = function () {
    UIX.showModal(logoutModal);
  };

  document.getElementById("cancelLogout")?.addEventListener("click", () => {
    UIX.hideModal(logoutModal);
  });

  document.getElementById("confirmLogout")?.addEventListener("click", () => {
    UIX.hideModal(logoutModal);
    showToast("Logged out");
  });

  /* -----------------------------------------------------------
     VOICEMAIL MODAL
  ----------------------------------------------------------- */
  document.getElementById("vmCancelBtn")?.addEventListener("click", () => {
    UIX.hideModal(voicemailModal);
  });

  /* -----------------------------------------------------------
     FULL PROFILE CLOSE
  ----------------------------------------------------------- */
  document.getElementById("closeFullProfile")?.addEventListener("click", () => {
    fullProfileModal?.classList.add("hidden");
    UIX.showMessaging();
  });

  /* -----------------------------------------------------------
     ESC KEY
  ----------------------------------------------------------- */
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      UIX.showMessaging();
      railButtons.forEach(b => b.classList.remove("active"));
    }
  });

  /* -----------------------------------------------------------
     NEW MESSAGES PILL
  ----------------------------------------------------------- */
  if (msgWin && newPill) {
    function isAtBottom() {
      return msgWin.scrollHeight - msgWin.scrollTop - msgWin.clientHeight < 10;
    }

    function showPill() {
      newPill.classList.remove("hidden");
      requestAnimationFrame(() => newPill.classList.add("show"));
    }

    function hidePill() {
      newPill.classList.remove("show");
      setTimeout(() => newPill.classList.add("hidden"), 200);
    }

    msgWin.addEventListener("scroll", () => {
      if (isAtBottom()) hidePill();
      else showPill();
    });

    newPill.addEventListener("click", () => {
      msgWin.scrollTo({ top: msgWin.scrollHeight, behavior: "smooth" });
      hidePill();
    });
  }

  /* -----------------------------------------------------------
     ARIA HOOKS
  ----------------------------------------------------------- */
  if (directoryPanel) {
    directoryPanel.setAttribute("role", "complementary");
    directoryPanel.setAttribute("aria-label", "Directory");
  }
  if (messagingPanel) {
    messagingPanel.setAttribute("role", "main");
  }
}

/* ============================================================
   FLOATING WINDOW ENGINE
============================================================ */
const FloatingWindows = {
  z: 50,

  init() {
    const windows = document.querySelectorAll(".floating-window");
    windows.forEach(win => {
      this.makeDraggable(win);
      win.addEventListener("mousedown", () => this.focus(win));
    });
  },

  focus(win) {
    this.z++;
    win.style.zIndex = this.z;
    win.classList.add("fw-active");
  },

  makeDraggable(win) {
    let isDown = false;
    let offsetX = 0;
    let offsetY = 0;

    win.addEventListener("mousedown", (e) => {
      if (!e.target.closest(".floating-body")) return;
      isDown = true;
      this.focus(win);
      offsetX = e.clientX - win.offsetLeft;
      offsetY = e.clientY - win.offsetTop;
      win.style.transition = "none";
    });

    document.addEventListener("mouseup", () => {
      isDown = false;
      win.style.transition = "";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      win.style.left = `${e.clientX - offsetX}px`;
      win.style.top = `${e.clientY - offsetY}px`;
    });
  }
};
























