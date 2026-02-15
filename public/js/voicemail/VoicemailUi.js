// ============================================================
// VoicemailUI.js — Neon‑Glass Voicemail System
// ============================================================

import { API_BASE } from "../config.js";

let activeAudio = null;
let activeCard = null;

/* -------------------------------------------------------
   Load Voicemails
------------------------------------------------------- */
export async function loadVoicemails() {
  const listEl = document.getElementById("voiceMList");
  listEl.innerHTML = "";

  try {
    const res = await fetch(`${API_BASE}/api/voicemail/list`, {
      method: "GET",
      credentials: "include"
    });

    const json = await res.json();

    if (!json.success) {
      listEl.innerHTML = `<li class="vm-empty">Failed to load voicemails</li>`;
      return;
    }

    const vms = json.voicemails;

    if (vms.length === 0) {
      listEl.innerHTML = `<li class="vm-empty">No voicemails yet</li>`;
      return;
    }

    vms.forEach(vm => {
      const normalized = normalizeVoicemail(vm);
      const card = renderVoicemailCard(normalized);
      listEl.appendChild(card);
    });

  } catch (err) {
    console.error("Voicemail load error:", err);
    listEl.innerHTML = `<li class="vm-empty">Error loading voicemails</li>`;
  }
}

/* -------------------------------------------------------
   Normalize Backend → Frontend Fields
------------------------------------------------------- */
function normalizeVoicemail(vm) {
  return {
    ...vm,
    timestamp: vm.created_at,
    dateString: new Date(vm.created_at).toLocaleString(),
    from_name: vm.from_name || "Unknown",
    from_avatar: vm.from_avatar || "img/default-avatar.png",
    from_theme: vm.from_theme || "system"
  };
}

/* -------------------------------------------------------
   Theme → Accent Color Mapping
------------------------------------------------------- */
function themeColor(theme) {
  switch (theme) {
    case "neon": return "#00e0ff";
    case "sunset": return "#ff7a50";
    case "forest": return "#4cd964";
    case "ocean": return "#4da6ff";
    case "rose": return "#ff4b8a";
    case "gold": return "#ffcc33";
    case "dark": return "#8899aa";
    default: return "#00e0ff"; // system default
  }
}

/* -------------------------------------------------------
   Render a Single Voicemail Card
------------------------------------------------------- */
function renderVoicemailCard(vm) {
  const li = document.createElement("li");
  li.className = "vm-card";
  li.dataset.id = vm.id;

  // Apply theme accent color
  li.style.setProperty("--vm-accent", themeColor(vm.from_theme));

  li.innerHTML = `
    <div class="vm-header">
      <img class="vm-avatar" src="${vm.from_avatar}">
      <div class="vm-info">
        <div class="vm-from">${vm.from_name}</div>
        <div class="vm-time">${formatTimestamp(vm.timestamp)}</div>
      </div>
      <div class="vm-status ${vm.listened ? "" : "unread"}"></div>
    </div>

    <div class="vm-body">
      <button class="vm-play-btn">
        <span class="material-symbols-outlined">play_arrow</span>
      </button>

      <div class="vm-waveform">
        ${renderWaveform(vm.peaks_json)}
      </div>

      <div class="vm-duration">0:00</div>
    </div>

    <div class="vm-actions">
      <button class="vm-delete"><span class="material-symbols-outlined">delete</span></button>
      <button class="vm-save"><span class="material-symbols-outlined">download</span></button>
    </div>

    <div class="vm-transcript ${vm.transcript ? "" : "hidden"}">
      ${vm.transcript || ""}
    </div>
  `;

  wireVoicemailCard(li, vm);
  return li;
}

/* -------------------------------------------------------
   Wire Card Interactions
------------------------------------------------------- */
function wireVoicemailCard(card, vm) {
  const playBtn = card.querySelector(".vm-play-btn");
  const durationEl = card.querySelector(".vm-duration");
  const audio = new Audio(vm.audio_url);

  audio.onloadedmetadata = () => {
    durationEl.textContent = formatDuration(audio.duration);
  };

  playBtn.onclick = () => {
  // Stop previous audio
  if (activeAudio && activeAudio !== audio) {
    activeAudio.pause();

    if (activeCard) {
      const prevBtn = activeCard.querySelector(".vm-play-btn span");
      if (prevBtn) prevBtn.textContent = "play_arrow";
      activeCard.classList.remove("vm-playing");
    }
  }

  // Toggle play/pause
  if (audio.paused) {
    audio.play();
    playBtn.querySelector("span").textContent = "pause";
    card.classList.add("vm-playing");
    activeAudio = audio;
    activeCard = card;
    markVoicemailRead(vm.id, card);
  } else {
    audio.pause();
    playBtn.querySelector("span").textContent = "play_arrow";
    card.classList.remove("vm-playing");
  }
};


  audio.onended = () => {
    playBtn.querySelector("span").textContent = "play_arrow";
    card.classList.remove("vm-playing");
  };

  // Delete
  card.querySelector(".vm-delete").onclick = () => deleteVoicemail(vm.id, card);

  // Save
  card.querySelector(".vm-save").onclick = () => {
    const a = document.createElement("a");
    a.href = vm.audio_url;
    a.download = `voicemail_${vm.id}.webm`;
    a.click();
  };
}

/* -------------------------------------------------------
   Mark as Read
------------------------------------------------------- */
async function markVoicemailRead(id, card) {
  const dot = card.querySelector(".vm-status");
  if (!dot.classList.contains("unread")) return;

  dot.classList.remove("unread");

  await fetch(`${API_BASE}/api/voicemail/listened`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
}

/* -------------------------------------------------------
   Delete Voicemail
------------------------------------------------------- */
async function deleteVoicemail(id, card) {
  const res = await fetch(`${API_BASE}/api/voicemail/delete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });

  const json = await res.json();

  if (json.success) {
    card.classList.add("leaving");
    setTimeout(() => card.remove(), 250);
  }
}

/* -------------------------------------------------------
   Waveform Renderer
------------------------------------------------------- */
function renderWaveform(peaksJson) {
  if (!peaksJson) return "";

  let peaks = [];
  try {
    peaks = JSON.parse(peaksJson);
  } catch {
    return "";
  }

  return peaks
    .map(v => `<div class="bar" style="height:${Math.max(8, v * 100)}%"></div>`)
    .join("");
}

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */
function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* -------------------------------------------------------
   Real-Time New Voicemail Event
------------------------------------------------------- */
export function bindVoicemailSocket(socket) {
  socket.on("voicemail:new", (vm) => {
    const normalized = normalizeVoicemail(vm);
    const list = document.getElementById("voiceMList");
    const card = renderVoicemailCard(normalized);
    list.prepend(card);
  });
}

