// public/js/dashboard/PresenceClient.js

/* -------------------------------------------------------
   Wait for Identity (prevents early initialization)
------------------------------------------------------- */
async function waitForIdentity(getMyUserId) {
  let id = getMyUserId();

  while (!id) {
    await new Promise(r => setTimeout(r, 50));
    id = getMyUserId();
  }

  return id;
}

/* -------------------------------------------------------
   Presence Client (FINAL FIXED VERSION)
------------------------------------------------------- */
export async function createPresenceClient(
  socket,
  getMyUserId,
  updateContactStatus,
  pendingPresence
) {
  if (!socket) {
    console.warn("[PresenceClient] socket.io client not found");
    return;
  }

  // ⭐ Wait until identity is fully loaded
  const myId = await waitForIdentity(getMyUserId);

  console.log("[PresenceClient] Identity ready:", myId);

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
