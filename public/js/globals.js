export function getMyUserId() { return window.currentUserId; }
export function getMyFullname() { return window.currentUserFullname; }
export function getReceiver() { return window.currentReceiverId; }
export async function getIceServers() { return window.ICE_SERVERS || []; }

export { 
  addCallLogEntry,
  showLocalVideo,
  fadeInVideo,
  showLocalAvatar,
  showRemoteAvatar,
  showRemoteVideo,
  setRemoteAvatar,
  UI,
  ringtone,
  ringback,
  startTimer,
  stopTimer,
  stopAudio
};
