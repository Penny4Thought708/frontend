// components.js
// Custom elements for Scrubber's app shell + layout + UI
// NOTE: No Shadow DOM so existing CSS + JS keep working.

/* ============================
   Base helper
============================ */

function defineIfNotExists(tag, clazz) {
  if (!customElements.get(tag)) {
    customElements.define(tag, clazz);
  }
}

/* ============================
   APP SHELL + LAYOUT
============================ */

class AppShell extends HTMLElement {}
defineIfNotExists("app-shell", AppShell);

class AppHeader extends HTMLElement {}
defineIfNotExists("app-header", AppHeader);

class AppMain extends HTMLElement {}
defineIfNotExists("app-main", AppMain);

class AppRail extends HTMLElement {}
defineIfNotExists("app-rail", AppRail);

class AppWorkspace extends HTMLElement {}
defineIfNotExists("app-workspace", AppWorkspace);

/* ============================
   DIRECTORY PANEL
============================ */

class DirectoryPanel extends HTMLElement {
  connectedCallback() {
    // Future: open/close animations, lazy loading, etc.
  }
}
defineIfNotExists("directory-panel", DirectoryPanel);

class DirectorySections extends HTMLElement {}
defineIfNotExists("directory-sections", DirectorySections);

/* ============================
   MESSAGING PANEL
============================ */

class MessagingPanel extends HTMLElement {
  connectedCallback() {
    // Future: auto-scroll, unread badge logic, etc.
  }
}
defineIfNotExists("messaging-panel", MessagingPanel);

/* ============================
   CALL WINDOW
============================ */

class CallWindow extends HTMLElement {
  connectedCallback() {
    // Future: attach RTC events, animate open/close, etc.
  }
}
defineIfNotExists("call-window", CallWindow);

/* ============================
   FLOATING WINDOWS
============================ */

class AppFloatingWindows extends HTMLElement {}
defineIfNotExists("app-floating-windows", AppFloatingWindows);

class FloatingWindow extends HTMLElement {
  connectedCallback() {
    // Future: drag, focus, z-index management, etc.
  }
}
defineIfNotExists("floating-window", FloatingWindow);

/* ============================
   MODALS
============================ */

class AppModals extends HTMLElement {}
defineIfNotExists("app-modals", AppModals);

class AppModal extends HTMLElement {
  connectedCallback() {
    // Future: ESC close, focus trap, aria-hidden toggling, etc.
  }
}
defineIfNotExists("modal", AppModal);

/* ============================
   TOASTS
============================ */

class AppToasts extends HTMLElement {}
defineIfNotExists("app-toasts", AppToasts);

class AppToast extends HTMLElement {
  connectedCallback() {
    // Future: auto-dismiss timers, slide-in/out animations, etc.
  }
}
defineIfNotExists("toast", AppToast);

/* ============================
   FOOTER
============================ */

class AppFooter extends HTMLElement {}
defineIfNotExists("app-footer", AppFooter);

/* ============================
   OPTIONAL: HOOKS / UTILITIES
============================ */

// Example: helper to open/close floating windows by data-window-id
export function openFloatingWindow(windowId) {
  const win = document.querySelector(
    `floating-window[data-window-id="${windowId}"]`
  );
  if (win) {
    win.classList.remove("hidden");
  }
}

export function closeFloatingWindow(windowId) {
  const win = document.querySelector(
    `floating-window[data-window-id="${windowId}"]`
  );
  if (win) {
    win.classList.add("hidden");
  }
}

// Example: open/close call window
export function openCallWindow() {
  const win = document.querySelector('call-window[data-window-id="video-call"]');
  if (win) {
    win.classList.remove("hidden");
  }
}

export function closeCallWindow() {
  const win = document.querySelector('call-window[data-window-id="video-call"]');
  if (win) {
    win.classList.add("hidden");
  }
}
