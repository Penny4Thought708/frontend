// public/js/messaging/MessagingEngine.js

import { getMyUserId } from "../session.js";

export class MessagingEngine {
  /**
   * @param {Object} config
   * @param {number} [config.userId]           - (Unused now; user comes from session via getMyUserId)
   * @param {Socket|null} config.socket       - Socket.io (or similar) instance, or null if not yet wired
   * @param {Object} [config.callbacks]       - Event callbacks from UI
   */
  constructor({ userId, socket, callbacks = {} }) {
    // ⭐ Dynamic userId — always reflects the current logged-in user
    Object.defineProperty(this, "userId", {
      get: () => getMyUserId()
    });

    this.socket = socket || null;

    // Core callbacks (UI hooks)
    this.callbacks = {
      onMessagesLoaded: callbacks.onMessagesLoaded || (() => {}),
      onIncomingMessage: callbacks.onIncomingMessage || (() => {}),
      onReactionUpdate: callbacks.onReactionUpdate || (() => {}),
      onAudioMessage: callbacks.onAudioMessage || (() => {}),
      onTypingStart: callbacks.onTypingStart || (() => {}),
      onTypingStop: callbacks.onTypingStop || (() => {}),
      onDelivered: callbacks.onDelivered || (() => {}),
      onRead: callbacks.onRead || (() => {}),
      onDeleted: callbacks.onDeleted || (() => {}),
      onEdited: callbacks.onEdited || (() => {}),
      onHiddenListLoaded: callbacks.onHiddenListLoaded || (() => {}),
      onRestored: callbacks.onRestored || (() => {}),
      onError: callbacks.onError || ((err) => console.error("[MessagingEngine]", err))
    };

    this._setupSocketListeners();
  }

  /* --------------------------------------------------------
   * Low-level HTTP helpers
   * ------------------------------------------------------ */

  async _get(url) {
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: {
          "Accept": "application/json"
        }
      });
      if (!res.ok) {
        throw new Error(`GET ${url} failed: ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      this.callbacks.onError(err);
      throw err;
    }
  }

  async _postForm(url, data) {
    const form = new FormData();
    Object.entries(data || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) form.append(k, v);
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        body: form,
        credentials: "include"
      });
      if (!res.ok) {
        throw new Error(`POST ${url} failed: ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      this.callbacks.onError(err);
      throw err;
    }
  }

  async _postJson(url, payload) {
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload || {})
      });
      if (!res.ok) {
        throw new Error(`POST(JSON) ${url} failed: ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      this.callbacks.onError(err);
      throw err;
    }
  }

  /* --------------------------------------------------------
   * Socket wiring
   * ------------------------------------------------------ */

  _setupSocketListeners() {
    if (!this.socket) return;

    // Incoming message from server
    this.socket.on("message:new", (msg) => {
      this.callbacks.onIncomingMessage(msg);
    });

    // Reaction updates
    this.socket.on("message:reactions", (payload) => {
      // { message_id, reactions: [{user_id, emoji}, ...] }
      this.callbacks.onReactionUpdate(payload);
    });

    // Audio message delivered
    this.socket.on("message:audio", (msg) => {
      this.callbacks.onAudioMessage(msg);
    });

    // Typing indicators
    this.socket.on("typing:start", (payload) => {
      // { from, to }
      this.callbacks.onTypingStart(payload);
    });

    this.socket.on("typing:stop", (payload) => {
      this.callbacks.onTypingStop(payload);
    });

    // Delivered & read receipts
    this.socket.on("message:delivered", (payload) => {
      // { messageId, from, to }
      this.callbacks.onDelivered(payload);
    });

    this.socket.on("message:read", (payload) => {
      // { messageId, from, to }
      this.callbacks.onRead(payload);
    });

    // Deletion
    this.socket.on("message:deleted", (payload) => {
      // { messageId, everyone }
      this.callbacks.onDeleted(payload);
    });

    // Edits
    this.socket.on("message:edited", (payload) => {
      // { id, message }
      this.callbacks.onEdited(payload);
    });

    // Restore
    this.socket.on("message:restored", (payload) => {
      // { id }
      this.callbacks.onRestored(payload);
    });
  }

  /* --------------------------------------------------------
   * High-level API: Loading & sending
   * ------------------------------------------------------ */

  /**
   * Load conversation with a specific contact.
   * Uses: /api/messages/load.php → messages.php (GET)
   */
  async loadMessages(contactId) {
    const url = `/NewApp/api/messages/load.php?contact_id=${encodeURIComponent(contactId)}`;
    const messages = await this._get(url);
    this.callbacks.onMessagesLoaded({ contactId, messages });
    return messages;
  }

  /**
   * Send a text message.
   * Uses: /api/messages/send.php → messages.php (POST)
   */
  async sendMessage(receiverId, text, extras = {}) {
    const payload = {
      receiver_id: receiverId,
      message: text,
      transport: extras.transport || "http",
      file: extras.file ? 1 : 0,
      filename: extras.filename || null,
      file_url: extras.file_url || null,
      comment: extras.comment || null
    };

    const msg = await this._postForm("/NewApp/api/messages/send.php", payload);

    // Optionally emit over socket so other side gets it in real-time
    if (this.socket) {
      this.socket.emit("message:new", msg);
    }

    // Let UI render immediately from HTTP result
    this.callbacks.onIncomingMessage(msg);

    return msg;
  }

  /**
   * Edit a message (only sender).
   * Uses: /api/messages/edit.php → messages_edit.php (JSON POST)
   */
  async editMessage(messageId, newText) {
    const result = await this._postJson("/NewApp/api/messages/edit.php", {
      id: messageId,
      user_id: this.userId,
      message: newText
    });

    const payload = {
      id: result.id,
      message: result.message
    };

    if (this.socket) {
      this.socket.emit("message:edited", payload);
    }

    this.callbacks.onEdited(payload);
    return result;
  }

  /* --------------------------------------------------------
   * Delete / hide / restore / hidden list
   * ------------------------------------------------------ */

  /**
   * Hard delete (for everyone) or delete-for-me (delegated to hide).
   * Uses: /api/messages/delete.php → messages_delete.php (POST)
   */
  async deleteMessage(messageId, forEveryone = false) {
    if (!forEveryone) {
      // Use hide for delete-for-me
      return this.hideMessage(messageId);
    }

    const result = await this._postForm("/NewApp/api/messages/delete.php", {
      id: messageId,
      everyone: 1
    });

    if (result && result.success && this.socket) {
      this.socket.emit("message:deleted", {
        messageId,
        everyone: true
      });
    }

    this.callbacks.onDeleted({ messageId, everyone: true });
    return result;
  }

  /**
   * Hide message for current user (delete-for-me).
   * Uses: /api/messages/hide.php → messages_hide.php (POST)
   */
  async hideMessage(messageId) {
    const result = await this._postForm("/NewApp/api/messages/hide.php", {
      id: messageId
    });

    if (result && result.success && this.socket) {
      // Per-user only; broadcast only if you want cross-client sync
      this.socket.emit("message:hidden", {
        messageId,
        userId: this.userId
      });
    }

    this.callbacks.onDeleted({ messageId, everyone: false });
    return result;
  }

  /**
   * Restore a previously hidden message for current user.
   * Uses: /api/messages/restore.php → restore script (POST)
   */
  async restoreMessage(messageId) {
    const result = await this._postForm("/NewApp/api/messages/restore.php", {
      id: messageId
    });

    if (result && result.success && this.socket) {
      this.socket.emit("message:restored", { id: messageId });
    }

    this.callbacks.onRestored({ id: messageId });
    return result;
  }

  /**
   * Get list of hidden messages for current user.
   * Uses: /api/messages/hidden.php → messages_hidden_list.php (GET)
   */
  async getHiddenMessages() {
    const list = await this._get("/NewApp/api/messages/hidden.php");
    this.callbacks.onHiddenListLoaded(list);
    return list;
  }

  /* --------------------------------------------------------
   * Reactions
   * ------------------------------------------------------ */

  /**
   * Toggle / set emoji reaction.
   * Uses: /api/messages/react.php → messages_react.php (POST)
   */
  async toggleReaction(messageId, emoji) {
    const result = await this._postForm("/NewApp/api/messages/react.php", {
      id: messageId,
      emoji,
      user_id: this.userId
    });

    if (result && result.success) {
      const payload = {
        message_id: result.message_id,
        reactions: result.reactions
      };

      if (this.socket) {
        this.socket.emit("message:reactions", payload);
      }

      this.callbacks.onReactionUpdate(payload);
    }

    return result;
  }

  /* --------------------------------------------------------
   * Read receipts
   * ------------------------------------------------------ */

  /**
   * Mark a specific message as read.
   * Uses: /api/messages/read.php → messages_read.php (POST)
   */
  async markRead(messageId, fromUserId, toUserId) {
    const result = await this._postForm("/NewApp/api/messages/read.php", {
      from: fromUserId,
      to: toUserId,
      messageId
    });

    if (result && result.success && this.socket) {
      this.socket.emit("message:read", {
        messageId,
        from: fromUserId,
        to: toUserId
      });
    }

    this.callbacks.onRead({ messageId, from: fromUserId, to: toUserId });
    return result;
  }

  /* --------------------------------------------------------
   * Audio upload
   * ------------------------------------------------------ */

  /**
   * Send an audio message.
   * Uses: /api/messages/audio.php → upload_audio.php (multipart POST)
   *
   * @param {File|Blob} audioBlob
   * @param {number} receiverId
   * @param {Object} [meta]
   */
  async sendAudioMessage(audioBlob, receiverId, meta = {}) {
    const form = new FormData();
    form.append("audio", audioBlob, meta.filename || "audio.webm");
    form.append("receiver_id", receiverId);

    if (meta.comment) form.append("comment", meta.comment);

    try {
      const res = await fetch("/NewApp/api/messages/audio.php", {
        method: "POST",
        body: form,
        credentials: "include"
      });
      if (!res.ok) {
        throw new Error(`Audio upload failed: ${res.status}`);
      }
      const msg = await res.json();

      if (this.socket) {
        this.socket.emit("message:audio", msg);
      }

      this.callbacks.onAudioMessage(msg);
      return msg;
    } catch (err) {
      this.callbacks.onError(err);
      throw err;
    }
  }

  /* --------------------------------------------------------
   * Typing indicators (socket-only)
   * ------------------------------------------------------ */

  /**
   * Start typing indicator.
   * Typing is socket-based in your architecture; PHP endpoints are stubs at most.
   */
  typingStart(contactId) {
    if (!this.socket) return;
    const payload = { from: this.userId, to: contactId };
    this.socket.emit("typing:start", payload);
    this.callbacks.onTypingStart(payload);
  }

  /**
   * Stop typing indicator.
   */
  typingStop(contactId) {
    if (!this.socket) return;
    const payload = { from: this.userId, to: contactId };
    this.socket.emit("typing:stop", payload);
    this.callbacks.onTypingStop(payload);
  }
}
