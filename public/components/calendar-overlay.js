//public/components/calendar-overlay.js
export class CalendarOverlay extends HTMLElement {
  connectedCallback() {
    // The component itself must be positioned inside shared-space
    this.style.position = "absolute";
    this.style.inset = "0";
    this.style.display = "none";
    this.style.pointerEvents = "none"; // allow background clicks to pass through

    this.innerHTML = `
      <!-- Background overlay -->
      <div id="overlay_bg" style="
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.45);
        display: none;
        pointer-events: auto;
      "></div>

      <!-- Calendar window -->
      <div id="calendar_" class="calendar" style="
        position: absolute;
        top: 80px;
        left: 80px;
        width: 400px;
        height: 400px;
        pointer-events: auto;
        z-index: 999999;
      "></div>

      <!-- Task modal -->
      <div id="taskModal" class="modal">
        <div class="modal-content">
          <h3 id="modalTitle"></h3>

          <label>Task:</label>
          <input type="text" id="taskInput">

          <label>Due Time:</label>
          <input type="time" id="taskTime">

          <label>Priority:</label>
          <select id="taskPriority">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <div class="modal-actions">
            <button id="saveTask">Save</button>
            <button id="cancelTask">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // Load calendar logic
    import("./calendar.js").then(mod => mod.initCalendar(this));

    const $cal = $(this).find("#calendar_");
    const $bg = $(this).find("#overlay_bg");

    // -----------------------------------------
    // MAKE RESIZABLE
    // -----------------------------------------
    $cal.resizable({
      containment: "#shared-space",
      minWidth: 300,
      minHeight: 300,
      grid: [25, 25]
    });

    // -----------------------------------------
    // MAKE DRAGGABLE
    // -----------------------------------------
    $cal.draggable({
      containment: "#shared-space",
      handle: "header",
      grid: [25, 25],
      snap: ".snap-target",
      snapTolerance: 15
    });

    // -----------------------------------------
    // MAXIMIZE / RESTORE ON DOUBLE CLICK
    // -----------------------------------------
    let isMaximized = false;
    let original = {};

    $cal.on("dblclick", "header", () => {
      const space = $("#shared-space");

      if (!isMaximized) {
        // Save original position + size
        original = {
          top: $cal.css("top"),
          left: $cal.css("left"),
          width: $cal.width(),
          height: $cal.height()
        };

        $cal.animate({
          top: 0,
          left: 0,
          width: space.width(),
          height: space.height()
        }, 300);

        isMaximized = true;
      } else {
        // Restore
        $cal.animate({
          top: original.top,
          left: original.left,
          width: original.width,
          height: original.height
        }, 300);

        isMaximized = false;
      }
    });

    // -----------------------------------------
    // CLOSE WHEN DOUBLE-CLICKING OUTSIDE
    // -----------------------------------------
    $bg.on("dblclick", () => this.close());
  }

  // -----------------------------------------
  // PUBLIC OPEN/CLOSE API
  // -----------------------------------------
  open() {
    this.style.display = "block";
    this.querySelector("#overlay_bg").style.display = "block";
  }

  close() {
    this.style.display = "none";
    this.querySelector("#overlay_bg").style.display = "none";
  }
}

customElements.define("calendar-overlay", CalendarOverlay);
