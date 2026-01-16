export class ContactSwitcher extends HTMLElement {
  connectedCallback() {
    import("./contact-switcher-logic.js").then(mod => mod.initSwitcher());
  }
}

customElements.define("contact-switcher", ContactSwitcher);
