// public/js/shared/user-cache.js
// -------------------------------------------------------
// A neutral shared module for cross‑module user data.
// This avoids circular imports between messaging.js,
// contacts.js, session.js, and call-log.js.
// -------------------------------------------------------

// Stores user full names by user_id
export const userNames = {};

// (Optional) Store avatars too if you want message bubbles to show them
export const userAvatars = {};

// (Optional) Store any other per-user metadata
export const userMeta = {};
