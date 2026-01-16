export class ContactsMenu extends HTMLElement {
  connectedCallback() {
this.innerHTML = `
  <div class="menu-wrapper">
    <button class="menu-op" aria-haspopup="true" aria-expanded="false">
      <span class="material-symbols-outlined">more_vert</span>
    </button>

    <div class="dropdown-content" aria-label="Contacts menu">

      <button id="toggle_Btn" data-action="contacts">
        <img src="img/Contacts.png" alt="contacts"> Contacts
      </button>
      <button id="messaging_Btn" data-action="messages">
      <img src="img/messages.png" alt="messages"> Messages
      </button>
      <button id="block_Btn" data-action="block">
        <img src="img/block.png" alt="blocked-contacts"> Block List
      </button>

      <button id="voicemail_Btn" data-action="voicemail">
        <img src="img/voicemail.png" alt="voicemail"> Voicemail
      </button>

      <button id="manageHiddenBtn" data-action="hidden">
        Hidden Messages
      </button>

      <button id="donot_Btn" data-action="dnd">
        <img src="img/donot.png" alt="dnd"> Do Not Disturb
      </button>

    </div>
  </div>
`;



    this.initEvents();
  }

  initEvents() {
    const wrapper = this.querySelector(".menu-wrapper");
    const menuBtn = wrapper.querySelector(".menu-op");
    const dropdown = wrapper.querySelector(".dropdown-content");

    // Toggle dropdown
    menuBtn.addEventListener("click", () => {
      dropdown.classList.toggle("open");
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) dropdown.classList.remove("open");
    });

    // Handle menu actions
    dropdown.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.dataset.action;
      this.dispatchEvent(new CustomEvent("menu-select", { detail: { action } }));
    });
  }
}

customElements.define("contacts-menu", ContactsMenu);
