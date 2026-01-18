// node-backend/sockets/messages.js
export default function registerMessageHandlers(io, socket) {
  const toStr = (v) => (v == null ? null : String(v));

  /* -------------------------------------------------------
     TEXT MESSAGE
  ------------------------------------------------------- */
  socket.on("message:new", (msg) => {
    const toStrId = toStr(msg.to);

    for (const [id, s] of io.of("/").sockets) {
      if (toStr(s.userId) === toStrId) {
        s.emit("message:new", msg);
      }
    }

    socket.emit("message:new", msg);
  });

  /* -------------------------------------------------------
     TYPING INDICATOR
  ------------------------------------------------------- */
  socket.on("typing", (data) => {
    const toStrId = toStr(data.to);

    for (const [id, s] of io.of("/").sockets) {
      if (toStr(s.userId) === toStrId) {
        s.emit("typing", data);
      }
    }
  });

  /* -------------------------------------------------------
     RECORDING INDICATOR
  ------------------------------------------------------- */
  socket.on("recording:start", ({ from, to }) => {
    const fromStr = toStr(from ?? socket.userId);
    const toStrId = toStr(to);

    for (const [id, s] of io.of("/").sockets) {
      if (toStr(s.userId) === toStrId) {
        s.emit("recording:start", { from: fromStr });
      }
    }
  });

  socket.on("recording:stop", ({ from, to }) => {
    const fromStr = toStr(from ?? socket.userId);
    const toStrId = toStr(to);

    for (const [id, s] of io.of("/").sockets) {
      if (toStr(s.userId) === toStrId) {
        s.emit("recording:stop", { from: fromStr });
      }
    }
  });

  /* -------------------------------------------------------
     AUDIO MESSAGE
  ------------------------------------------------------- */
  socket.on("message:audio", ({ id, from, to, url }) => {
    const fromStr = String(from);
    const toStr = String(to);

    // Deliver to receiver
    for (const [sid, s] of io.of("/").sockets) {
      if (String(s.userId) === toStr) {
        s.emit("message:audio", {
          id,
          from: fromStr,
          url
        });
      }
    }

    // Echo back to sender
    socket.emit("message:audio", {
      id,
      from: fromStr,
      url
    });
  });
}
