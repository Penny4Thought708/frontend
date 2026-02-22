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
   DOM READY — ALL UI SYSTEMS MERGED
============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM ready");

  /* ============================
     MODALS (NEW SYSTEM)
  ============================ */
  const loginModal = document.getElementById("loginModal");
  const signupModal = document.getElementById("signupModal");

  const loginBtn = document.getElementById("loginBtn");
  const signupBtn = document.getElementById("signupBtn");

  const closeLogin = document.getElementById("closeLogin");
  const closeSignup = document.getElementById("closeSignup");

  const openSignupFromLogin = document.getElementById("openSignupFromLogin");
  const openLoginFromSignup = document.getElementById("openLoginFromSignup");

  const openModal = (modal) => modal?.classList.add("is-open");
  const closeModal = (modal) => modal?.classList.remove("is-open");

  loginBtn?.addEventListener("click", () => openModal(loginModal));
  closeLogin?.addEventListener("click", () => closeModal(loginModal));

  signupBtn?.addEventListener("click", () => openModal(signupModal));
  closeSignup?.addEventListener("click", () => closeModal(signupModal));

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

  [loginModal, signupModal].forEach((modal) => {
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  /* ============================
     OLD POPUP SYSTEM (popup / popup2)
  ============================ */
  const popup = document.getElementById("popup");
  const popup2 = document.getElementById("popup2");
  const closePopup = document.getElementById("closePopup");
  const closePopup2 = document.getElementById("closePopup2");
  const openSignupFrom = document.getElementById("openSignupFrom");

  loginBtn?.addEventListener("click", (e) => {
    if (loginBtn.type === "submit") return;
    e.preventDefault();
    popup?.classList.add("show");
    popup2?.classList.remove("show");
  });

  closePopup?.addEventListener("click", () => popup?.classList.remove("show"));
  closePopup2?.addEventListener("click", () => popup2?.classList.remove("show"));

  openSignupFrom?.addEventListener("click", (e) => {
    e.preventDefault();
    popup?.classList.remove("show");
    popup2?.classList.add("show");
  });

  openSignupFromLogin?.addEventListener("click", (e) => {
    e.preventDefault();
    popup2?.classList.remove("show");
    popup?.classList.add("show");
  });

  /* ============================
     SIGNUP VALIDATION
  ============================ */
  const signupForm = document.getElementById("sign_form_link");

  signupBtn?.addEventListener("click", (e) => {
    if (signupBtn.type === "submit") return;
    e.preventDefault();
    popup2?.classList.add("show");
    popup?.classList.remove("show");
  });

  if (signupForm) {
    signupForm.addEventListener("submit", (e) => {
      const pass = document.getElementById("signup_password").value;
      const confirm = document.getElementById("confirm-password").value;
      const errorMessage = document.getElementById("error_signup");

      if (pass !== confirm) {
        e.preventDefault();
        errorMessage.textContent = "Passwords do not match.";
        errorMessage.style.display = "block";
      } else {
        errorMessage.style.display = "none";
      }
    });
  }

  /* ============================
     COOKIE CONSENT
  ============================ */
  const cookieBox = document.getElementById("cookieConsent");
  const cookieAccept = document.getElementById("cookieAccept");
  const cookieDecline = document.getElementById("cookieDecline");

  if (cookieBox && !localStorage.getItem("cookiesAccepted")) {
    setTimeout(() => cookieBox.classList.add("is-open"), 400);
  }

  cookieAccept?.addEventListener("click", () => {
    localStorage.setItem("cookiesAccepted", "true");
    cookieBox.classList.remove("is-open");
  });

  cookieDecline?.addEventListener("click", () => {
    cookieBox.classList.remove("is-open");
    privacyCenter?.classList.add("is-open");
  });

  /* ============================
     PRIVACY CENTER
  ============================ */
  const privacyCenter = document.getElementById("privacyCenter");
  const closePrivacy = document.getElementById("closePrivacy");
  const savePrivacy = document.getElementById("savePrivacy");

  const toggleAnalytics = document.getElementById("toggleAnalytics");
  const togglePersonalization = document.getElementById("togglePersonalization");

  const tabs = document.querySelectorAll(".privacy-tab");
  const panels = document.querySelectorAll(".privacy-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const target = tab.dataset.tab;
      document.getElementById(`tab-${target}`).classList.add("active");
    });
  });

  document.getElementById("resetPrivacy")?.addEventListener("click", () => {
    toggleAnalytics.checked = false;
    togglePersonalization.checked = false;
  });

  closePrivacy?.addEventListener("click", () => {
    privacyCenter?.classList.remove("is-open");
  });

  savePrivacy?.addEventListener("click", () => {
    const prefs = {
      analytics: toggleAnalytics?.checked || false,
      personalization: togglePersonalization?.checked || false
    };
    localStorage.setItem("privacyPreferences", JSON.stringify(prefs));
    privacyCenter?.classList.remove("is-open");
  });

 /* ============================
   HERO SLIDER (FIXED)
============================ */
const slides = [
  { 
    title: "Your Home, Your Hands, Our Help", 
    text: "Scrubber’s gives you the confidence to tackle any project, big or small." 
  },
  { 
    title: "Build It. Fix It. Scrub It.", 
    text: "From shelving to shower installs, Scrubber’s connects DIYers with the tools, tips, and pros." 
  },
  { 
    title: "Smarter DIY Starts Here", 
    text: "Scrubber’s blends expert insight with instant messaging and walkthroughs." 
  }
];

let currentIndex = 0;

// Correct selectors for your new HTML
const heroTitle = document.querySelector(".hero-title");
const heroText = document.querySelector(".hero-subtitle");

// Correct dot selectors
const dots = [
  document.querySelector(".dot-1"),
  document.querySelector(".dot-2"),
  document.querySelector(".dot-3")
];

function updateSlide(index) {
  if (heroTitle && heroText) {
    heroTitle.textContent = slides[index].title;
    heroText.textContent = slides[index].text;
  }

  dots.forEach((dot, i) => {
    if (dot) {
      dot.style.backgroundColor = i === index ? "cyan" : "gray";
    }
  });
}

updateSlide(currentIndex);

// Arrows
document.getElementById("arrow-right")?.addEventListener("click", () => {
  currentIndex = (currentIndex + 1) % slides.length;
  updateSlide(currentIndex);
});

document.getElementById("arrow-left")?.addEventListener("click", () => {
  currentIndex = (currentIndex - 1 + slides.length) % slides.length;
  updateSlide(currentIndex);
});
