// node-backend/sockets/reactions.js

export default function registerReactionHandlers(io, socket) {
  // When a client toggles a reaction, broadcast the result
  socket.on("reaction:toggle", (payload) => {
    // payload typically: { message_id, user_id, emoji, ... }
    io.emit("reaction:update", payload);
  });
}
