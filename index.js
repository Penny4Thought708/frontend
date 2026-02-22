
document.addEventListener("DOMContentLoaded", () => {

  /* ============================
     ELEMENTS
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
  function openModal(modal) {
    modal.classList.add("is-open");
  }

  function closeModal(modal) {
    modal.classList.remove("is-open");
  }

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
  [loginModal, signupModal].forEach(modal => {
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  /* ============================
     COOKIE CONSENT SYSTEM
     (You will add the HTML later)
  ============================ */

  const cookieBox = document.getElementById("cookieConsent");
  const cookieAccept = document.getElementById("cookieAccept");
  const cookieDecline = document.getElementById("cookieDecline");

  // Show cookie box only if not accepted before
  if (cookieBox && !localStorage.getItem("cookiesAccepted")) {
    setTimeout(() => {
      cookieBox.classList.add("is-open");
    }, 800);
  }

  // Accept cookies
  cookieAccept?.addEventListener("click", () => {
    localStorage.setItem("cookiesAccepted", "true");
    cookieBox.classList.remove("is-open");
  });

  // Decline cookies
  cookieDecline?.addEventListener("click", () => {
    cookieBox.classList.remove("is-open");
  });

});

