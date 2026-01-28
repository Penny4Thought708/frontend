// node-backend/sockets/reactions.js

export default function registerReactionHandlers(io, socket) {
  // Frontend emits: "message:reaction"
  socket.on("message:reaction", (payload) => {
    // payload: { messageId, from, emoji }

    // Broadcast to all clients
    io.emit("message:reaction", payload);
  });
}

