// public/js/messaging/HTTPTransport.js
export class HTTPTransport {
  constructor(base = "") {
    this.base = base; // e.g., "/api" if you want
  }

  async get(path, params = {}) {
    const url = new URL(this.base + path, window.location.origin);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.append(k, v);
    });

    const res = await fetch(url.toString(), {
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  async post(path, payload = {}) {
    const res = await fetch(this.base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new Error(`POST ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  async upload(path, formData) {
    const res = await fetch(this.base + path, {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new Error(`UPLOAD ${path} failed: ${res.status}`);
    }
    return res.json();
  }
}
