// public/js/webrtc/WebRTCState.js
// Centralized, authoritative WebRTC state + robust reset utilities

export const rtcState = {
  /* ---------------------------------------------------
     Peer / Identity
  --------------------------------------------------- */
  peerId: null,
  peerName: null,

  /* ---------------------------------------------------
     Call State
  --------------------------------------------------- */
  inCall: false,
  isCaller: false,
  audioOnly: false,
  incomingOffer: null,

  /* ---------------------------------------------------
     Media Streams
  --------------------------------------------------- */
  localStream: null,
  remoteStream: null,

  /* ---------------------------------------------------
     Timer
  --------------------------------------------------- */
  callTimerSeconds: 0,
  callTimerInterval: null,

  /* ---------------------------------------------------
     State Mutators
  --------------------------------------------------- */

  /**
   * Assign the active peer identity.
   * @param {string|null} id
   * @param {string|null} name
   */
  setPeer(id, name = null) {
    this.peerId = id ?? null;
    if (name) this.peerName = name;
  },

  /**
   * Stop and clear all media streams.
   * Ensures cameras/mics are released cleanly.
   */
  resetMedia() {
    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      console.warn("[rtcState] Error stopping local tracks:", err);
    }

    this.localStream = null;
    this.remoteStream = null;
  },

  /**
   * Reset the call timer safely.
   */
  resetTimer() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
    }
    this.callTimerInterval = null;
    this.callTimerSeconds = 0;
  },

  /**
   * Reset all call‑related flags and peer identity.
   */
  resetCallState() {
    this.inCall = false;
    this.isCaller = false;
    this.audioOnly = false;
    this.incomingOffer = null;

    this.peerId = null;
    this.peerName = null;
  },

  /**
   * Full teardown of all WebRTC state.
   * Use this after any call ends or fails.
   */
  fullReset() {
    this.resetMedia();
    this.resetTimer();
    this.resetCallState();
  },
};
