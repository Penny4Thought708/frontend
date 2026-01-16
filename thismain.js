
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM ready");

  const loginBtn = document.getElementById("loginBtn");
  const signupBtn = document.getElementById("signupBtn");
  const popup = document.getElementById("popup");
  const popup2 = document.getElementById("popup2");
  const closePopup = document.getElementById("closePopup");
  const closePopup2 = document.getElementById("closePopup2");
  const openSignupFrom = document.getElementById("openSignupFrom");
  const openSignupFromLogin = document.getElementById("openSignupFromLogin");

  if (loginBtn && popup && popup2) {
    loginBtn.addEventListener("click", (e) => {
      if (loginBtn.type === "submit") return;
      e.preventDefault();
      popup.classList.add("show");
      popup2.classList.remove("show");
    });
  }

  if (closePopup && popup) {
    closePopup.addEventListener("click", () => popup.classList.remove("show"));
  }

  if (closePopup2 && popup2) {
    closePopup2.addEventListener("click", () => popup2.classList.remove("show"));
  }

  if (openSignupFrom && popup && popup2) {
    openSignupFrom.addEventListener("click", (e) => {
      e.preventDefault();
      popup.classList.remove("show");
      popup2.classList.add("show");
    });
  }

  if (openSignupFromLogin && popup && popup2) {
    openSignupFromLogin.addEventListener("click", (e) => {
      e.preventDefault();
      popup2.classList.remove("show");
      popup.classList.add("show");
    });
  }



  // Signup form validation
  const signupForm = document.getElementById("sign_form_link");
  if(signupBtn) {
    signupBtn.addEventListener("click", (e) => {
      if (signupBtn.type === "submit") return;
      e.preventDefault();
      popup2.classList.add("show");
      popup.classList.remove("show");
    });
  }
  if (signupForm) {
    signupForm.addEventListener("submit", function (e) {
      const signup_password = document.getElementById("signup_password").value;
      const confirm = document.getElementById("confirm-password").value;
      const errorMessage = document.getElementById("error_signup");

      if (signup_password !== confirm) {
        e.preventDefault();
        if (errorMessage) {
          errorMessage.textContent = "Passwords do not match.";
          errorMessage.style.display = "block";
        }
      } else if (errorMessage) {
        errorMessage.style.display = "none";
      }
    });
  }

  // Slides logic
  const slides = [
    { title: "Your Home, Your Hands, Our Help", text: "Scrubber’s gives you the confidence to tackle any project, big or small." },
    { title: "Build It. Fix It. Scrub It.", text: "From shelving to shower installs, Scrubber’s connects DIYers with the tools, tips, and pros." },
    { title: "Smarter DIY Starts Here", text: "Scrubber’s blends expert insight with instant messaging and walkthroughs." }
  ];

  let currentIndex = 0;
  const heroTitle = document.querySelector(".hero-text h1");
  const heroText = document.querySelector(".for_text p");
  const dots = [document.getElementById("dot_1"), document.getElementById("dot_2"), document.getElementById("dot_3")];

  function updateSlide(index) {
    if (heroTitle && heroText) {
      heroTitle.textContent = slides[index].title;
      heroText.textContent = slides[index].text;
    }
    dots.forEach((dot, i) => {
      if (dot) dot.style.backgroundColor = i === index ? "cyan" : "gray";
    });
  }

  updateSlide(currentIndex);

  const arrowRight = document.getElementById("arrow-right");
  const arrowLeft = document.getElementById("arrow-left");

  if (arrowRight) {
    arrowRight.addEventListener("click", () => {
      currentIndex = (currentIndex + 1) % slides.length;
      updateSlide(currentIndex);
    });
  }

  if (arrowLeft) {
    arrowLeft.addEventListener("click", () => {
      currentIndex = (currentIndex - 1 + slides.length) % slides.length;
      updateSlide(currentIndex);
    });
  }

  // Login success handler
  function handleLoginSuccess() {
    localStorage.setItem("loggedIn", "true");
    window.location.href = "/dashboard.php";
  }

  const loggedIn = localStorage.getItem("loggedIn");
  if (loggedIn === "true" &&
      (window.location.pathname.includes("login") || window.location.pathname.includes("signup"))) {
    window.location.href = "/dashboard.php";
  }
});
