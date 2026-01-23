// public/js/dashboard/PresenceClient.js

/* -------------------------------------------------------
   Presence Client (FINAL VERSION)
------------------------------------------------------- */
export function createPresenceClient(
  socket,
  getMyUserId,
  updateContactStatus,
  pendingPresence
) {
  if (!socket) {
    console.warn("[PresenceClient] socket.io client not found");
    return;
  }

  const myId = getMyUserId();
  if (!myId) {
    console.warn("[PresenceClient] No user ID available");
    return;
  }

  // ⭐ Register this user with the backend
  socket.emit("session:init", { userId: myId });

  /* -------------------------------------------------------
     Single presence update
  ------------------------------------------------------- */
  socket.on("statusUpdate", ({ contact_id, online }) => {
    const id = String(contact_id);

    // If card exists, update immediately
    if (updateContactStatus(id, online)) return;

    // Otherwise buffer it
    pendingPresence.set(id, online);
  });

  /* -------------------------------------------------------
     Batch presence update
  ------------------------------------------------------- */
  socket.on("statusBatch", (users) => {
    users.forEach(({ contact_id, online }) => {
      const id = String(contact_id);

      if (updateContactStatus(id, online)) return;

      pendingPresence.set(id, online);
    });
  });

  /* -------------------------------------------------------
     Request initial snapshot
  ------------------------------------------------------- */
  socket.emit("presence:get", { userId: myId });
}

