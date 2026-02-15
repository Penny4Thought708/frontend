// ============================================================
// VoicemailUI.js — Neon‑Glass Voicemail System
// Handles:
//   - Loading voicemail list
//   - Rendering voicemail cards
//   - Playback controller
//   - Delete + save
//   - Mark-as-read
//   - Real-time "new voicemail" events
// ============================================================
import { API_BASE } from "../config.js";

let activeAudio = null;
let activeCard = null;

/* -------------------------------------------------------
   Load Voicemails
------------------------------------------------------- */
import { API_BASE } from "../config.js";

export async function loadVoicemails() {
  const listEl = document.getElementById("voiceMList");
  listEl.innerHTML = "";

  try {
    const res = await fetch(`${API_BASE}/api/voicemail/list`, {
      method: "GET",
      credentials: "include"   // REQUIRED for req.session.user_id
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
      const card = renderVoicemailCard(vm);
      listEl.appendChild(card);
    });

  } catch (err) {
    console.error("Voicemail load error:", err);
    listEl.innerHTML = `<li class="vm-empty">Error loading voicemails</li>`;
  }
}

/* -------------------------------------------------------
   Render a Single Voicemail Card
------------------------------------------------------- */
function renderVoicemailCard(vm) {
  const li = document.createElement("li");
  li.className = "vm-card glass-heavy";
  li.dataset.id = vm.id;

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
      activeCard.querySelector(".vm-play-btn span").textContent = "play_arrow";
    }

    // Toggle play/pause
    if (audio.paused) {
      audio.play();
      playBtn.querySelector("span").textContent = "pause";
      activeAudio = audio;
      activeCard = card;
      markVoicemailRead(vm.id, card);
    } else {
      audio.pause();
      playBtn.querySelector("span").textContent = "play_arrow";
    }
  };

  audio.onended = () => {
    playBtn.querySelector("span").textContent = "play_arrow";
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

  await fetch(`/api/voicemail/mark-read/${id}`, { method: "POST" });
  dot.classList.remove("unread");
}

/* -------------------------------------------------------
   Delete Voicemail
------------------------------------------------------- */
async function deleteVoicemail(id, card) {
  const res = await fetch(`/api/voicemail/delete/${id}`, { method: "DELETE" });
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
    const list = document.getElementById("voiceMList");
    const card = renderVoicemailCard(vm);
    list.prepend(card);
  });
}
