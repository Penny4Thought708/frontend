// public/js/messaging/MessagingEngine.js

import { getMyUserId } from "../session.js";

// ⭐ UI Modules
import { renderIncomingMessage, renderMessages } from "./MessageUI.js";
import { updateReactions } from "./ReactionUI.js";
import { showTyping, hideTyping } from "./TypingUI.js";

// ⭐ State Store
import { store } from "./StateStore.js";

export class MessagingEngine {
  constructor({ socket, callbacks = {} }) {
    Object.defineProperty(this, "userId", {
      get: () => getMyUserId()
    });

    this.socket = socket || null;

    // ⭐ UI callback wiring
    this.callbacks = {
      onMessagesLoaded: ({ contactId, messages }) => {
        store.cacheMessages(contactId, messages);
        messages.forEach((m) => renderMessages(m));
      },

      onIncomingMessage: (msg) => {
        store.appendMessage(msg);
        renderIncomingMessage(msg);
      },

      onReactionUpdate: (payload) => {
        updateReactions(payload);
      },

      onTypingStart: ({ from }) => {
        showTyping(from);
      },

      onTypingStop: ({ from }) => {
        hideTyping(from);
      },

      onAudioMessage: (msg) => {
        store.appendMessage(msg);
        renderIncomingMessage(msg);
      },

      onDelivered: () => {},
      onRead: () => {},
      onDeleted: () => {},
      onEdited: () => {},
      onHiddenListLoaded: () => {},
      onRestored: () => {},
      onError: (err) => console.error("[MessagingEngine]", err)
    };

    this._setupSocketListeners();
  }

  /* --------------------------------------------------------
   * HTTP Helpers
   * ------------------------------------------------------ */

  async _get(url) {
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
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
      if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
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
      if (!res.ok) throw new Error(`POST(JSON) ${url} failed: ${res.status}`);
      return await res.json();
    } catch (err) {
      this.callbacks.onError(err);
      throw err;
    }
  }

  /* --------------------------------------------------------
   * Socket Wiring
   * ------------------------------------------------------ */

  _setupSocketListeners() {
    if (!this.socket) return;

    this.socket.on("message:new", (msg) => {
      this.callbacks.onIncomingMessage(msg);
    });

    this.socket.on("message:reactions", (payload) => {
      this.callbacks.onReactionUpdate(payload);
    });

    this.socket.on("message:audio", (msg) => {
      this.callbacks.onAudioMessage(msg);
    });

    this.socket.on("typing:start", (payload) => {
      this.callbacks.onTypingStart(payload);
    });

    this.socket.on("typing:stop", (payload) => {
      this.callbacks.onTypingStop(payload);
    });

    this.socket.on("message:delivered", (payload) => {
      this.callbacks.onDelivered(payload);
    });

    this.socket.on("message:read", (payload) => {
      this.callbacks.onRead(payload);
    });

    this.socket.on("message:deleted", (payload) => {
      this.callbacks.onDeleted(payload);
    });

    this.socket.on("message:edited", (payload) => {
      this.callbacks.onEdited(payload);
    });

    this.socket.on("message:restored", (payload) => {
      this.callbacks.onRestored(payload);
    });
  }

  /* --------------------------------------------------------
   * High-level API
   * ------------------------------------------------------ */

  async loadMessages(contactId) {
    const url = `/NewApp/api/messages/load.php?contact_id=${encodeURIComponent(contactId)}`;
    const messages = await this._get(url);

    this.callbacks.onMessagesLoaded({ contactId, messages });
    return messages;
  }

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

    if (this.socket) {
      this.socket.emit("message:new", msg);
    }

    this.callbacks.onIncomingMessage(msg);
    return msg;
  }

  async editMessage(messageId, newText) {
    const result = await this._postJson("/NewApp/api/messages/edit.php", {
      id: messageId,
      user_id: this.userId,
      message: newText
    });

    const payload = { id: result.id, message: result.message };

    if (this.socket) {
      this.socket.emit("message:edited", payload);
    }

    this.callbacks.onEdited(payload);
    return result;
  }

  async deleteMessage(messageId, forEveryone = false) {
    if (!forEveryone) return this.hideMessage(messageId);

    const result = await this._postForm("/NewApp/api/messages/delete.php", {
      id: messageId,
      everyone: 1
    });

    if (result?.success && this.socket) {
      this.socket.emit("message:deleted", { messageId, everyone: true });
    }

    this.callbacks.onDeleted({ messageId, everyone: true });
    return result;
  }

  async hideMessage(messageId) {
    const result = await this._postForm("/NewApp/api/messages/hide.php", {
      id: messageId
    });

    if (result?.success && this.socket) {
      this.socket.emit("message:hidden", {
        messageId,
        userId: this.userId
      });
    }

    this.callbacks.onDeleted({ messageId, everyone: false });
    return result;
  }

  async restoreMessage(messageId) {
    const result = await this._postForm("/NewApp/api/messages/restore.php", {
      id: messageId
    });

    if (result?.success && this.socket) {
      this.socket.emit("message:restored", { id: messageId });
    }

    this.callbacks.onRestored({ id: messageId });
    return result;
  }

  async getHiddenMessages() {
    const list = await this._get("/NewApp/api/messages/hidden.php");
    this.callbacks.onHiddenListLoaded(list);
    return list;
  }

  async toggleReaction(messageId, emoji) {
    const result = await this._postForm("/NewApp/api/messages/react.php", {
      id: messageId,
      emoji,
      user_id: this.userId
    });

    if (result?.success) {
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

  async markRead(messageId, fromUserId, toUserId) {
    const result = await this._postForm("/NewApp/api/messages/read.php", {
      from: fromUserId,
      to: toUserId,
      messageId
    });

    if (result?.success && this.socket) {
      this.socket.emit("message:read", {
        messageId,
        from: fromUserId,
        to: toUserId
      });
    }

    this.callbacks.onRead({ messageId, from: fromUserId, to: toUserId });
    return result;
  }

  async sendAudioMessage(audioBlob, receiverId, meta = {}) {
    const form = new FormData();
    form.append("audio", audioBlob, meta.filename || "audio.webm");
    form.append("receiver_id", receiverId);
    if (meta.comment) form.append("comment", meta.comment);

    const res = await fetch("/NewApp/api/messages/audio.php", {
      method: "POST",
      body: form,
      credentials: "include"
    });

    if (!res.ok) throw new Error(`Audio upload failed: ${res.status}`);

    const msg = await res.json();

    if (this.socket) {
      this.socket.emit("message:audio", msg);
    }

    this.callbacks.onAudioMessage(msg);
    return msg;
  }

  typingStart(contactId) {
    if (!this.socket) return;
    const payload = { from: this.userId, to: contactId };
    this.socket.emit("typing:start", payload);
    this.callbacks.onTypingStart(payload);
  }

  typingStop(contactId) {
    if (!this.socket) return;
    const payload = { from: this.userId, to: contactId };
    this.socket.emit("typing:stop", payload);
    this.callbacks.onTypingStop(payload);
  }
}

