// public/js/image-viewer.js

const viewer = document.getElementById("img-viewer");
const viewerImg = document.getElementById("img-viewer-img");

let currentIndex = -1;
let images = [];

function refreshImageList() {
  images = Array.from(document.querySelectorAll(".msg-image"));
}

export function initImageViewer() {
  if (!viewer || !viewerImg) return;

  document.addEventListener("click", (e) => {
    const img = e.target.closest(".msg-image");
    if (!img) return;

    refreshImageList();
    currentIndex = images.indexOf(img);
    openViewer(img.src);
  });

  viewer.addEventListener("click", (e) => {
    if (e.target === viewer || e.target === viewerImg) {
      closeViewer();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (viewer.style.display !== "flex") return;

    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowRight") showNext();
    if (e.key === "ArrowLeft") showPrev();
  });
}

function openViewer(src) {
  viewerImg.src = src;
  viewer.style.display = "flex";
  viewer.classList.add("visible");
}

function closeViewer() {
  viewer.classList.remove("visible");
  setTimeout(() => {
    viewer.style.display = "none";
    viewerImg.src = "";
  }, 150);
}

function showNext() {
  if (images.length === 0) return;
  currentIndex = (currentIndex + 1) % images.length;
  viewerImg.src = images[currentIndex].src;
}

function showPrev() {
  if (images.length === 0) return;
  currentIndex = (currentIndex - 1 + images.length) % images.length;
  viewerImg.src = images[currentIndex].src;
}
