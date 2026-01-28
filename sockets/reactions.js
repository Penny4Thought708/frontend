// frontend/sockets/reactions.js

export default function registerReactionHandlers(io, socket) {
  // Frontend emits this
  socket.on("message:reaction", (payload) => {
    // Broadcast to all clients
    io.emit("message:reaction", payload);
  });
}



