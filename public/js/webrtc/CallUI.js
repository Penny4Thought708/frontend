
// ============================================================
// CallUI.js — Corrected + Aligned with HTML/CSS/UX
// ============================================================
// Responsibilities:
//   - Owns WebRTCController
//   - Manages call window UI state
//   - Controls primary vs PiP layout
//   - Handles FaceTime-style slide animations
//   - Handles Meet/Discord grid modes
//   - Handles iOS voice mode
//   - Handles video upgrade overlay
//   - Syncs with RemoteParticipants.js
// ============================================================

import { WebRTCController } from "./WebRTCController.js";
import * as RemoteParticipants from "./RemoteParticipants.js";
import { attachLocalStream } from "./WebRTCMedia.js";
import { rtcState } from "./WebRTCState.js";

export class CallUI {
  constructor(socket) {
    this.socket = socket;

    // ------------------------------------------------------------
    // DOM References
    // ------------------------------------------------------------
    this.callWindow = document.getElementById("callWindow");
    this.callBody = this.callWindow.querySelector(".call-body");
    this.callGrid = document.getElementById("callGrid");

    // Local tile + video
    this.localTile = document.getElementById("localParticipant");
    this.localVideo = document.getElementById("localVideo");
    this.localAvatar = this.localTile?.querySelector(".avatar-wrapper");

    // PiP containers
    this.localPip = document.getElementById("localPip");
    this.localPipVideo = document.getElementById("localPipVideo");

    this.remotePip = document.getElementById("remotePip");
    this.remotePipVideo = document.getElementById("remotePipVideo");

    // Controls
    this.callControls = document.getElementById("call-controls");
    this.callStatus = document.getElementById("call-status");
    this.callTimer = document.getElementById("call-timer");

    // Video upgrade overlay
    this.videoUpgradeOverlay = document.getElementById("video-upgrade-overlay");

    // ------------------------------------------------------------
    // State
    // ------------------------------------------------------------

    // Local is primary until callee answers
    this.primaryIsRemote = false;

    // PiP position (default bottom-right)
    this.pipPos = { x: 0, y: 0 };

    // Track whether remote has answered
    this.remoteAnswered = false;

    // Track whether remote video has arrived
    this.remoteHasVideo = false;

    // Track animation state
    this.isAnimatingSwap = false;

    // ------------------------------------------------------------
    // Create WebRTC Controller
    // ------------------------------------------------------------
    this.rtc = new WebRTCController(socket);

    // Bind controller → UI events
    this._bindControllerEvents();

    // Bind UI events (buttons, PiP drag, etc.)
    this._bindUIEvents();

    // Initialize window hidden
    this._hideCallWindow();
  }

  // ============================================================
  // UI WINDOW CONTROL
  // ============================================================

  _showCallWindow() {
    this.callWindow.classList.remove("hidden");
    requestAnimationFrame(() => {
      this.callWindow.classList.add("is-open");
      this.callWindow.classList.add("call-opening");
    });
  }

  _hideCallWindow() {
    this.callWindow.classList.remove("is-open");
    setTimeout(() => {
      this.callWindow.classList.add("hidden");
    }, 220);
  }

  // ============================================================
  // STATUS + TIMER
  // ============================================================

  _setStatus(text) {
    if (this.callStatus) this.callStatus.textContent = text;
  }

  _startTimer() {
    this._timerStart = Date.now();
    clearInterval(this._timerInterval);

    this._timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this._timerStart) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const s = String(elapsed % 60).padStart(2, "0");
      this.callTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  _stopTimer() {
    clearInterval(this._timerInterval);
  }

  // ============================================================
  // EVENT BINDING (Controller → UI)
  // ============================================================

  _bindControllerEvents() {
    const rtc = this.rtc;

    // Local stream attached
    rtc.onLocalStream = (stream) => {
      attachLocalStream(stream);
      this._onLocalVideoReady();
    };

    // Remote stream arrives
    rtc.onRemoteStream = (peerId, stream) => {
      this._onRemoteVideoReady(peerId, stream);
    };

    // Remote answered call
    rtc.onCallAnswered = () => {
      this._onRemoteAnswered();
    };

    // Remote ended call
    rtc.onCallEnded = () => {
      this._endCall();
    };
  }

  // ============================================================
  // EVENT BINDING (UI → Controller)
  // ============================================================

  _bindUIEvents() {
    // TODO: buttons, PiP drag, swap, etc.
    // Will be implemented in Part 2
  }

  // ============================================================
  // LOCAL VIDEO READY
  // ============================================================

  _onLocalVideoReady() {
    // Show local tile
    this.localTile.classList.remove("hidden");

    // Hide avatar
    this.localAvatar?.classList.add("hidden");

    // Local is primary at start
    this.primaryIsRemote = false;

    // Show call window
    this._showCallWindow();

    // Update status
    this._setStatus("Calling…");
  }

  // ============================================================
  // REMOTE ANSWERED
  // ============================================================

  _onRemoteAnswered() {
    this.remoteAnswered = true;
    this._setStatus("Connected");
    this._startTimer();
  }

  // ============================================================
  // REMOTE VIDEO READY
  // ============================================================

  _onRemoteVideoReady(peerId, stream) {
    this.remoteHasVideo = true;

    // Attach stream via RemoteParticipants
    const entry = RemoteParticipants.attachParticipantStream(peerId, stream);

    // If remote answered, animate swap
    if (this.remoteAnswered && !this.primaryIsRemote) {
      this._animateRemoteBecomingPrimary(entry.el);
    }
  }

  // ============================================================
  // ANIMATION: REMOTE BECOMES PRIMARY
  // ============================================================

  _animateRemoteBecomingPrimary(remoteEl) {
    if (this.isAnimatingSwap) return;
    this.isAnimatingSwap = true;

    // Prepare remote tile for slide-up
    remoteEl.classList.add("pre-enter");

    // Prepare local PiP for slide-down
    this.localPip.classList.add("pre-enter");

    // Show remote tile
    remoteEl.classList.remove("hidden");

    // Move local video into PiP
    this.localPipVideo.srcObject = this.localVideo.srcObject;
    this.localPip.classList.remove("hidden");

    // Hide local tile
    this.localTile.classList.add("hidden");

    // Trigger animation
    requestAnimationFrame(() => {
      remoteEl.classList.add("enter-active");
      this.localPip.classList.add("enter-active");
    });

    // Cleanup after animation
    setTimeout(() => {
      remoteEl.classList.remove("pre-enter", "enter-active");
      this.localPip.classList.remove("pre-enter", "enter-active");

      this.primaryIsRemote = true;
      this.isAnimatingSwap = false;

      // Apply normal layout rules
      this._applyPrimaryLayout();
    }, 350);
  }

  // ============================================================
  // PRIMARY LAYOUT ENGINE
  // ============================================================
_applyPrimaryLayout() {
  if (this.isAnimatingSwap) return;

  let remoteEl = null;
  const allRemotes = this.callGrid.querySelectorAll(".participant.remote");

  for (const el of allRemotes) {
    const peerId = el.dataset.peerId;
    const entry = window.RemoteParticipants?.getParticipant?.(peerId);

    if (entry && entry.stream) {
      remoteEl = el;
      break;
    }
  }

  const hasRemote = !!remoteEl;

  const count = hasRemote ? 2 : 1;

  this.callGrid.classList.remove(
    "participants-1",
    "participants-2",
    "participants-3",
    "participants-4",
    "participants-5",
    "participants-6",
    "participants-7",
    "participants-8",
    "participants-9",
    "participants-many"
  );

  if (count === 1) this.callGrid.classList.add("participants-1");
  if (count === 2) this.callGrid.classList.add("participants-2");

  if (!hasRemote) {
    this.primaryIsRemote = false;
    this.localTile.classList.remove("hidden");
    if (remoteEl) remoteEl.classList.add("hidden");
    this.localPip.classList.add("hidden");
    this.remotePip.classList.add("hidden");
    return;
  }

  if (this.primaryIsRemote) {
    remoteEl.classList.remove("hidden");
    this.localTile.classList.add("hidden");
    this.localPip.classList.remove("hidden");
    this.remotePip.classList.add("hidden");
    this.localPipVideo.srcObject = this.localVideo.srcObject;
    this._applyPipTransform(this.localPip);
  } else {
    this.localTile.classList.remove("hidden");
    remoteEl.classList.add("hidden");
    this.remotePip.classList.remove("hidden");
    this.localPip.classList.add("hidden");

    const peerId = remoteEl.dataset.peerId;
    const entry = window.RemoteParticipants?.getParticipant?.(peerId);
    if (entry?.videoEl?.srcObject) {
      this.remotePipVideo.srcObject = entry.videoEl.srcObject;
    }

    this._applyPipTransform(this.remotePip);
  }
}


  // ============================================================
  // END CALL
  // ============================================================

  _endCall() {
    this._stopTimer();
    this._setStatus("Call Ended");

    this.callWindow.classList.remove("is-open");
    setTimeout(() => {
      this.callWindow.classList.add("hidden");
    }, 220);
  }
}


  // ------------------------------------------------------------
  // 1. Detect remote participant with a real video stream
  // ------------------------------------------------------------
  let remoteEl = null;
  const allRemotes = this.callGrid.querySelectorAll(".participant.remote");

  for (const el of allRemotes) {
    const peerId = el.dataset.peerId;
    const entry = window.RemoteParticipants?.getParticipant?.(peerId);

    if (entry && entry.stream) {
      remoteEl = el;
      break;
    }
  }

  const hasRemote = !!remoteEl;

  // ------------------------------------------------------------
  // 2. Update grid participant count classes
  // ------------------------------------------------------------
  const count = hasRemote ? 2 : 1;

  this.callGrid.classList.remove(
    "participants-1",
    "participants-2",
    "participants-3",
    "participants-4",
    "participants-5",
    "participants-6",
    "participants-7",
    "participants-8",
    "participants-9",
    "participants-many"
  );

  if (count === 1) this.callGrid.classList.add("participants-1");
  if (count === 2) this.callGrid.classList.add("participants-2");

  // ------------------------------------------------------------
  // 3. Apply primary vs PiP layout
  // ------------------------------------------------------------

  if (!hasRemote) {
    // ----------------------------------------------------------
    // ONLY LOCAL VIDEO EXISTS
    // ----------------------------------------------------------
    this.primaryIsRemote = false;

    // Local tile visible
    this.localTile.classList.remove("hidden");

    // Remote tile hidden
    if (remoteEl) remoteEl.classList.add("hidden");

    // PiPs hidden
    this.localPip.classList.add("hidden");
    this.remotePip.classList.add("hidden");

    return;
  }

  // ------------------------------------------------------------
  // REMOTE EXISTS — APPLY PRIMARY LOGIC
  // ------------------------------------------------------------

  if (this.primaryIsRemote) {
    // ----------------------------------------------------------
    // REMOTE IS PRIMARY
    // ----------------------------------------------------------

    // Remote tile visible
    remoteEl.classList.remove("hidden");

    // Local tile hidden
    this.localTile.classList.add("hidden");

    // Local PiP visible
    this.localPip.classList.remove("hidden");
    this.remotePip.classList.add("hidden");

    // Sync PiP video
    this.localPipVideo.srcObject = this.localVideo.srcObject;

    // Apply PiP transform
    this._applyPipTransform(this.localPip);

  } else {
    // ----------------------------------------------------------
    // LOCAL IS PRIMARY
    // ----------------------------------------------------------

    // Local tile visible
    this.localTile.classList.remove("hidden");

    // Remote tile hidden
    remoteEl.classList.add("hidden");

    // Remote PiP visible
    this.remotePip.classList.remove("hidden");
    this.localPip.classList.add("hidden");

    // Sync PiP video
    const peerId = remoteEl.dataset.peerId;
    const entry = window.RemoteParticipants?.getParticipant?.(peerId);
    if (entry?.videoEl?.srcObject) {
      this.remotePipVideo.srcObject = entry.videoEl.srcObject;
    }

    // Apply PiP transform
    this._applyPipTransform(this.remotePip);
  }
}

// ============================================================
// APPLY PIP TRANSFORM
// ============================================================
//
// Moves PiP to the saved drag position.
// If no drag position exists, resets to bottom-right.
// ============================================================

_applyPipTransform(pipEl) {
  if (!pipEl) return;

  // Default PiP position (bottom-right)
  if (!this.pipPos || typeof this.pipPos.x !== "number") {
    this.pipPos = { x: 0, y: 0 };
  }

  pipEl.style.transform = `translate3d(${this.pipPos.x}px, ${this.pipPos.y}px, 0)`;
}

// ============================================================
// SWAP PRIMARY (DOUBLE-TAP OR BUTTON)
// ============================================================
//
// This allows the user to swap primary manually.
// ============================================================

_swapPrimary() {
  if (this.isAnimatingSwap) return;

  this.primaryIsRemote = !this.primaryIsRemote;
  this._applyPrimaryLayout();
}

// ============================================================
// DRAG HANDLER FOR PIP
// ============================================================
//
// This enables dragging PiP around the screen.
// ============================================================

_enablePipDrag(pipEl) {
  if (!pipEl) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;

  pipEl.addEventListener("pointerdown", (e) => {
    isDragging = true;
    pipEl.classList.add("dragging");

    startX = e.clientX - this.pipPos.x;
    startY = e.clientY - this.pipPos.y;

    pipEl.setPointerCapture(e.pointerId);
  });

  pipEl.addEventListener("pointermove", (e) => {
    if (!isDragging) return;

    this.pipPos.x = e.clientX - startX;
    this.pipPos.y = e.clientY - startY;

    pipEl.style.transform = `translate3d(${this.pipPos.x}px, ${this.pipPos.y}px, 0)`;
  });

  pipEl.addEventListener("pointerup", (e) => {
    isDragging = false;
    pipEl.classList.remove("dragging");
    pipEl.releasePointerCapture(e.pointerId);
  });
}
// ============================================================
// UI → CONTROLLER EVENT BINDING
// ============================================================

_bindUIEvents() {
  // ------------------------------------------------------------
  // CALL CONTROL BUTTONS
  // ------------------------------------------------------------

  // Answer incoming call
  const answerBtn = document.getElementById("answer-call");
  if (answerBtn) {
    answerBtn.addEventListener("click", () => {
      this.rtc.answerCall();
      this._setStatus("Connecting…");
      this.callWindow.classList.remove("inbound-mode");
      this.callWindow.classList.add("active-mode");
    });
  }

  // Decline incoming call
  const declineBtn = document.getElementById("decline-call");
  if (declineBtn) {
    declineBtn.addEventListener("click", () => {
      this.rtc.endCall();
      this._endCall();
    });
  }

  // End active call
  const endBtn = document.getElementById("end-call");
  if (endBtn) {
    endBtn.addEventListener("click", () => {
      this.rtc.endCall();
      this._endCall();
    });
  }

  // Toggle mute
  const muteBtn = document.getElementById("mute-call");
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      const muted = this.rtc.toggleMute();
      muteBtn.classList.toggle("active", muted);
    });
  }

  // Toggle camera
  const camBtn = document.getElementById("camera-toggle");
  if (camBtn) {
    camBtn.addEventListener("click", () => {
      const off = this.rtc.toggleCamera();
      camBtn.classList.toggle("active", off);

      if (off) {
        this.localAvatar?.classList.remove("hidden");
        this.localVideo.classList.remove("show");
      } else {
        this.localAvatar?.classList.add("hidden");
        this.localVideo.classList.add("show");
      }
    });
  }

  // ------------------------------------------------------------
  // MORE CONTROLS MENU
  // ------------------------------------------------------------

  const moreBtn = document.getElementById("more-controls-btn");
  const moreMenu = document.getElementById("more-controls-menu");

  if (moreBtn && moreMenu) {
    moreBtn.addEventListener("click", () => {
      const isOpen = moreMenu.classList.contains("show");
      moreMenu.classList.toggle("show", !isOpen);
      moreMenu.classList.toggle("hidden", isOpen);
    });

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!moreBtn.contains(e.target) && !moreMenu.contains(e.target)) {
        moreMenu.classList.add("hidden");
        moreMenu.classList.remove("show");
      }
    });
  }

  // ------------------------------------------------------------
  // PIP DRAG ENABLED
  // ------------------------------------------------------------

  this._enablePipDrag(this.localPip);
  this._enablePipDrag(this.remotePip);

  // ------------------------------------------------------------
  // DOUBLE-TAP TO SWAP PRIMARY
  // ------------------------------------------------------------

  let lastTap = 0;

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTap < 300) {
      this._swapPrimary();
    }
    lastTap = now;
  };

  // Attach to both PiPs
  this.localPip?.addEventListener("pointerdown", handleDoubleTap);
  this.remotePip?.addEventListener("pointerdown", handleDoubleTap);

  // ------------------------------------------------------------
  // PREVENT TEXT SELECTION DURING DRAG
  // ------------------------------------------------------------

  document.addEventListener("selectstart", (e) => {
    if (this.localPip.classList.contains("dragging") ||
        this.remotePip.classList.contains("dragging")) {
      e.preventDefault();
    }
  });
}
// ============================================================
// LOCAL VIDEO READY (MEDIA HANDLING)
// ============================================================
//
// Called when WebRTCMedia attaches the local stream to #localVideo.
// This is where we:
//   - Show the local tile
//   - Hide the avatar
//   - Mark local video as active
//   - Ensure local is primary (until remote answers)
// ============================================================

_onLocalVideoReady() {
  // Show local tile
  this.localTile.classList.remove("hidden");

  // Hide avatar
  this.localAvatar?.classList.add("hidden");

  // Mark video as active
  this.localVideo.classList.add("show");

  // Local is primary at start
  this.primaryIsRemote = false;

  // Show call window
  this._showCallWindow();

  // Update status
  this._setStatus("Calling…");
}
// ============================================================
// CALL LIFECYCLE — START OUTBOUND CALL
// ============================================================
//
// Called when the user initiates a call.
// This prepares the UI for the "calling…" state.
// ============================================================

startOutboundCall() {
  // Reset UI state
  this._resetCallUI();

  // Show call window
  this._showCallWindow();

  // Outbound calls start in active mode (not inbound)
  this.callWindow.classList.remove("inbound-mode");
  this.callWindow.classList.add("active-mode");

  // Local is primary until remote answers
  this.primaryIsRemote = false;

  // Status
  this._setStatus("Calling…");
}
// ============================================================
// INBOUND CALL — SHOW INBOUND UI
// ============================================================
//
// Called when someone calls YOU.
// This shows the inbound UI with Answer/Decline buttons.
// ============================================================

showInboundCall(callerName = "Incoming Call") {
  // Reset UI
  this._resetCallUI();

  // Show call window
  this._showCallWindow();

  // Inbound mode
  this.callWindow.classList.add("inbound-mode");
  this.callWindow.classList.remove("active-mode");

  // Status
  this._setStatus(callerName);
}
// ============================================================
// ANSWER CALL (UI SIDE)
// ============================================================
//
// Called after the user presses "Answer".
// The controller will then trigger onCallAnswered().
// ============================================================

onAnswered() {
  this.callWindow.classList.remove("inbound-mode");
  this.callWindow.classList.add("active-mode");

  this._setStatus("Connecting…");
}
// ============================================================
// REMOTE ANSWERED (CONTROLLER EVENT)
// ============================================================
//
// Called when the remote peer accepts the call.
// This is where the FaceTime-style transition becomes possible.
// ============================================================

_onRemoteAnswered() {
  this.remoteAnswered = true;

  // Update status + start timer
  this._setStatus("Connected");
  this._startTimer();

  // If remote video already arrived, animate swap now
  if (this.remoteHasVideo && !this.primaryIsRemote) {
    const remotes = this.callGrid.querySelectorAll(".participant.remote");
    if (remotes.length > 0) {
      this._animateRemoteBecomingPrimary(remotes[0]);
    }
  }
}
// ============================================================
// END CALL (UI + CONTROLLER)
// ============================================================
//
// Called when either side ends the call.
// This cleans up EVERYTHING and returns UI to pristine state.
// ============================================================

_endCall() {
  // Stop timer
  this._stopTimer();

  // Status
  this._setStatus("Call Ended");

  // Fade out window
  this.callWindow.classList.remove("is-open");

  setTimeout(() => {
    this.callWindow.classList.add("hidden");
  }, 220);

  // Reset UI state
  this._resetCallUI();

  // Clear participants
  RemoteParticipants.clearAllParticipants();

  // Reset flags
  this.remoteAnswered = false;
  this.remoteHasVideo = false;
  this.primaryIsRemote = false;
}
// ============================================================
// RESET CALL UI (INTERNAL)
// ============================================================
//
// This resets the UI to a clean state so a new call can start.
// ============================================================

_resetCallUI() {
  // Remove all mode flags
  this.callWindow.classList.remove(
    "inbound-mode",
    "active-mode",
    "voice-only-call",
    "camera-off",
    "meet-mode",
    "discord-mode",
    "ios-voice-mode",
    "video-upgrade-mode"
  );

  // Hide PiPs
  this.localPip.classList.add("hidden");
  this.remotePip.classList.add("hidden");

  // Reset PiP position
  this.pipPos = { x: 0, y: 0 };
  this.localPip.style.transform = "";
  this.remotePip.style.transform = "";

  // Reset local tile
  this.localTile.classList.add("hidden");
  this.localAvatar?.classList.remove("hidden");
  this.localVideo.classList.remove("show");

  // Reset remote tiles (if any)
  const remotes = this.callGrid.querySelectorAll(".participant.remote");
  remotes.forEach((el) => {
    el.classList.add("hidden");
  });

  // Reset status + timer
  this._setStatus("Connecting…");
  this.callTimer.textContent = "00:00";
  this._stopTimer();
}
// ============================================================
// iOS VOICE MODE — ENTER
// ============================================================
//
// This activates the iPhone-style audio call UI.
// Used when:
//   - Outbound audio-only call
//   - Remote declines video
//   - User toggles video off before connecting
// ============================================================

_enterIOSVoiceMode() {
  this.callWindow.classList.add("ios-voice-mode");
  this.callWindow.classList.add("voice-only-call");

  // Hide all videos
  this.localVideo.classList.remove("show");
  this.localAvatar?.classList.remove("hidden");

  const remotes = this.callGrid.querySelectorAll(".participant.remote");
  remotes.forEach((el) => {
    const entry = RemoteParticipants.getParticipant(el.dataset.peerId);
    if (!entry) return;

    entry.videoEl?.classList.remove("show");
    entry.avatarEl?.classList.remove("hidden");
  });

  // Hide PiPs
  this.localPip.classList.add("hidden");
  this.remotePip.classList.add("hidden");

  // Status
  this._setStatus("Audio Call");
}
// ============================================================
// iOS VOICE MODE — EXIT
// ============================================================
//
// Called when switching from audio → video.
// ============================================================

_exitIOSVoiceMode() {
  this.callWindow.classList.remove("ios-voice-mode");
  this.callWindow.classList.remove("voice-only-call");

  // Restore local video if camera is on
  if (!this.rtc.isCameraOff) {
    this.localVideo.classList.add("show");
    this.localAvatar?.classList.add("hidden");
  }

  // Restore remote video if available
  const remotes = this.callGrid.querySelectorAll(".participant.remote");
  remotes.forEach((el) => {
    const entry = RemoteParticipants.getParticipant(el.dataset.peerId);
    if (!entry) return;

    if (!entry.cameraOff) {
      entry.videoEl?.classList.add("show");
      entry.avatarEl?.classList.add("hidden");
    }
  });

  this._applyPrimaryLayout();
}
// ============================================================
// VIDEO UPGRADE — SHOW OVERLAY
// ============================================================
//
// Called when remote requests to switch from audio → video.
// ============================================================

_showVideoUpgradeOverlay() {
  this.callWindow.classList.add("video-upgrade-mode");

  // Blur grid
  this.callGrid.classList.add("desktop-video-preview");

  // Show overlay
  this.videoUpgradeOverlay.classList.remove("hidden");
  requestAnimationFrame(() => {
    this.videoUpgradeOverlay.classList.add("show");
  });
}
// ============================================================
// VIDEO UPGRADE — HIDE OVERLAY
// ============================================================

_hideVideoUpgradeOverlay() {
  this.callWindow.classList.remove("video-upgrade-mode");

  // Remove blur
  this.callGrid.classList.remove("desktop-video-preview");

  // Hide overlay
  this.videoUpgradeOverlay.classList.remove("show");
  setTimeout(() => {
    this.videoUpgradeOverlay.classList.add("hidden");
  }, 220);
}
// ============================================================
// USER ACCEPTS VIDEO UPGRADE
// ============================================================

_acceptVideoUpgrade() {
  this._hideVideoUpgradeOverlay();

  // Exit voice-only mode
  this._exitIOSVoiceMode();

  // Enable camera
  this.rtc.enableCamera();

  // Status
  this._setStatus("Switching to video…");
}
// ============================================================
// USER DECLINES VIDEO UPGRADE
// ============================================================

_declineVideoUpgrade() {
  this._hideVideoUpgradeOverlay();

  // Stay in voice-only mode
  this._enterIOSVoiceMode();

  // Notify remote
  this.rtc.declineVideoUpgrade();

  this._setStatus("Audio Only");
}
// ============================================================
// BIND VIDEO UPGRADE BUTTONS
// ============================================================

_bindVideoUpgradeButtons() {
  const acceptMobile = document.getElementById("video-upgrade-accept");
  const declineMobile = document.getElementById("video-upgrade-decline");

  const acceptDesktop = document.getElementById("video-upgrade-accept-desktop");
  const declineDesktop = document.getElementById("video-upgrade-decline-desktop");

  if (acceptMobile) acceptMobile.addEventListener("click", () => this._acceptVideoUpgrade());
  if (declineMobile) declineMobile.addEventListener("click", () => this._declineVideoUpgrade());

  if (acceptDesktop) acceptDesktop.addEventListener("click", () => this._acceptVideoUpgrade());
  if (declineDesktop) declineDesktop.addEventListener("click", () => this._declineVideoUpgrade());
}
// ============================================================
// MODE HELPERS (Meet / Discord / iOS)
// ============================================================
//
// These allow you to switch between layout modes dynamically.
// CallUI can use these based on participant count, device type,
// or user preference.
// ============================================================

_setMeetMode() {
  this.callWindow.classList.add("meet-mode");
  this.callWindow.classList.remove("discord-mode");
}

_setDiscordMode() {
  this.callWindow.classList.add("discord-mode");
  this.callWindow.classList.remove("meet-mode");
}

_setIOSVoiceMode() {
  this._enterIOSVoiceMode();
}

_exitIOSMode() {
  this._exitIOSVoiceMode();
}
// ============================================================
// SCREEN SHARE MODE
// ============================================================
//
// When remote or local starts screen sharing, the grid switches
// into a stage + filmstrip layout.
// ============================================================

_enterScreenShareMode(peerId) {
  this.callGrid.classList.add("screen-share-mode");

  // Mark the presenting participant
  const entry = RemoteParticipants.getParticipant(peerId);
  if (entry?.el) {
    entry.el.classList.add("stage");
  }

  // Everyone else becomes filmstrip
  const remotes = this.callGrid.querySelectorAll(".participant.remote");
  remotes.forEach((el) => {
    if (el.dataset.peerId !== peerId) {
      el.classList.add("filmstrip");
    }
  });

  // Local tile becomes filmstrip if not presenting
  if (peerId !== "local") {
    this.localTile.classList.add("filmstrip");
  }

  // Hide PiPs during screen share
  this.localPip.classList.add("hidden");
  this.remotePip.classList.add("hidden");
}

_exitScreenShareMode() {
  this.callGrid.classList.remove("screen-share-mode");

  // Remove stage/filmstrip classes
  const all = this.callGrid.querySelectorAll(".participant");
  all.forEach((el) => {
    el.classList.remove("stage", "filmstrip");
  });

  // Restore PiP layout
  this._applyPrimaryLayout();
}
// ============================================================
// DEBUG PANEL TOGGLE
// ============================================================

_toggleDebug() {
  const debugBtn = document.getElementById("call-debug-toggle");
  if (!debugBtn) return;

  debugBtn.addEventListener("click", () => {
    document.body.classList.toggle("debug-call-ui");
  });
}
// ============================================================
// FINAL INITIALIZATION
// ============================================================
//
// Called automatically by constructor.
// Wires up:
//   - Video upgrade buttons
//   - Debug toggle
//   - Default mode
// ============================================================

_init() {
  this._bindVideoUpgradeButtons();
  this._toggleDebug();

  // Default to Meet mode
  this._setMeetMode();
}
// ============================================================
// EXPORT
// ============================================================

export default CallUI;












