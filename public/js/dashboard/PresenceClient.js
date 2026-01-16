// public/js/dashboard/PresenceClient.js

export function createPresenceClient(socket, getMyUserId, updateContactStatus) {
  if (!socket) {
    console.warn("[PresenceClient] socket.io client not found");
    return;
  }

  // ⭐ Register this user with the backend
  socket.emit("session:init", { userId: getMyUserId() });

  // ⭐ Listen for presence updates
  socket.on("statusUpdate", ({ contact_id, online }) => {
    updateContactStatus(contact_id, online);
  });

  socket.on("statusBatch", (users) => {
    users.forEach(({ contact_id, online }) => {
      updateContactStatus(contact_id, online);
    });
  });

  // ⭐ Ask for initial snapshot
  socket.emit("presence:get", { userId: getMyUserId() });
}
