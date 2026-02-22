import { API_BASE } from "./public/js/config.js";

/* ============================================================
   LOGIN FORM SUBMIT (API AUTH)
============================================================ */
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  const loginButton = loginForm.querySelector(".btn-submit");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("log-password").value.trim();
    const errorBox = document.getElementById("errorBox");

    errorBox.innerHTML = "";
    loginButton.classList.add("loading");

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include"
      });

      const data = await res.json();

      if (data.success) {
        if (data.token) {
          localStorage.setItem("auth_token", data.token);
        }
        window.location.href = "dashboard.html";
      } else {
        errorBox.innerHTML = `<p class="error">${data.error}</p>`;
      }
    } catch (err) {
      errorBox.innerHTML = `<p class="error">Network error</p>`;
    }

    loginButton.classList.remove("loading");
  });
}

/* ============================================================
   DOM READY — MODALS + COOKIE CONSENT + PRIVACY CENTER
============================================================ */
document.addEventListener("DOMContentLoaded", () => {

  /* ============================
     MODAL ELEMENTS
  ============================ */
  const loginModal = document.getElementById("loginModal");
  const signupModal = document.getElementById("signupModal");

  const loginBtn = document.getElementById("loginBtn");
  const signupBtn = document.getElementById("signupBtn");

  const closeLogin = document.getElementById("closeLogin");
  const closeSignup = document.getElementById("closeSignup");

  const openSignupFromLogin = document.getElementById("openSignupFromLogin");
  const openLoginFromSignup = document.getElementById("openLoginFromSignup");

  /* ============================
     OPEN / CLOSE HELPERS
  ============================ */
  const openModal = (modal) => modal?.classList.add("is-open");
  const closeModal = (modal) => modal?.classList.remove("is-open");

  /* ============================
     LOGIN OPEN / CLOSE
  ============================ */
  loginBtn?.addEventListener("click", () => openModal(loginModal));
  closeLogin?.addEventListener("click", () => closeModal(loginModal));

  /* ============================
     SIGNUP OPEN / CLOSE
  ============================ */
  signupBtn?.addEventListener("click", () => openModal(signupModal));
  closeSignup?.addEventListener("click", () => closeModal(signupModal));

  /* ============================
     SWITCH LOGIN ↔ SIGNUP
  ============================ */
  openSignupFromLogin?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal(loginModal);
    setTimeout(() => openModal(signupModal), 150);
  });

  openLoginFromSignup?.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal(signupModal);
    setTimeout(() => openModal(loginModal), 150);
  });

  /* ============================
     CLOSE ON BACKDROP CLICK
  ============================ */
  [loginModal, signupModal].forEach((modal) => {
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  /* ============================
     COOKIE CONSENT SYSTEM
  ============================ */
  const cookieBox = document.getElementById("cookieConsent");
  const cookieAccept = document.getElementById("cookieAccept");
  const cookieDecline = document.getElementById("cookieDecline");

  if (cookieBox && !localStorage.getItem("cookiesAccepted")) {
    setTimeout(() => {
      cookieBox.classList.add("is-open");
    }, 600);
  }

  cookieAccept?.addEventListener("click", () => {
    localStorage.setItem("cookiesAccepted", "true");
    cookieBox.classList.remove("is-open");
  });

  cookieDecline?.addEventListener("click", () => {
    cookieBox.classList.remove("is-open");
  });

  /* ============================
     PRIVACY CENTER MODAL
  ============================ */
  const privacyCenter = document.getElementById("privacyCenter");
  const closePrivacy = document.getElementById("closePrivacy");
  const savePrivacy = document.getElementById("savePrivacy");

  const toggleAnalytics = document.getElementById("toggleAnalytics");
  const togglePersonalization = document.getElementById("togglePersonalization");

  function openPrivacyCenter() {
    privacyCenter?.classList.add("is-open");
  }

  function closePrivacyCenter() {
    privacyCenter?.classList.remove("is-open");
  }

  closePrivacy?.addEventListener("click", closePrivacyCenter);

  savePrivacy?.addEventListener("click", () => {
    const prefs = {
      analytics: toggleAnalytics?.checked || false,
      personalization: togglePersonalization?.checked || false
    };

    localStorage.setItem("privacyPreferences", JSON.stringify(prefs));
    closePrivacyCenter();
  });

});

