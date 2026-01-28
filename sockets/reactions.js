// node-backend/sockets/reactions.js

export default function registerReactionHandlers(io, socket) {
  socket.on("message:reaction", (payload) => {
    // Broadcast to all connected clients
    io.emit("message:reaction", payload);
  });
}





