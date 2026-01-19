// node-backend/sockets/messages.js
export default function registerMessageHandlers(io, socket) {
  const toStr = (v) => (v == null ? null : String(v));

  /* -------------------------------------------------------
     TEXT MESSAGE (real-time relay)
  ------------------------------------------------------- */
  socket.on("message:new", (msg) => {
    const toId = toStr(msg.receiver_id || msg.to);
    const fromId = toStr(msg.sender_id || msg.from);

    // Deliver to receiver
    io.to(`user:${toId}`).emit("message:new", msg);

    // Echo back to sender
    io.to(`user:${fromId}`).emit("message:new", msg);
  });

  /* -------------------------------------------------------
     TYPING INDICATOR
  ------------------------------------------------------- */
  socket.on("typing:start", ({ from, to }) => {
    io.to(`user:${to}`).emit("typing:start", { from });
  });

  socket.on("typing:stop", ({ from, to }) => {
    io.to(`user:${to}`).emit("typing:stop", { from });
  });

  /* -------------------------------------------------------
     RECORDING INDICATOR
  ------------------------------------------------------- */
  socket.on("recording:start", ({ from, to }) => {
    io.to(`user:${to}`).emit("recording:start", { from });
  });

  socket.on("recording:stop", ({ from, to }) => {
    io.to(`user:${to}`).emit("recording:stop", { from });
  });

  /* -------------------------------------------------------
     AUDIO MESSAGE
  ------------------------------------------------------- */
  socket.on("message:audio", ({ id, from, to, url }) => {
    const payload = { id, from: String(from), url };

    // Deliver to receiver
    io.to(`user:${to}`).emit("message:audio", payload);

    // Echo back to sender
    io.to(`user:${from}`).emit("message:audio", payload);
  });

  /* -------------------------------------------------------
     VOICEMAIL (real-time)
  ------------------------------------------------------- */
  socket.on("voicemail:new", (vm) => {
    io.to(`user:${vm.user_id}`).emit("voicemail:new", vm);
  });
}


