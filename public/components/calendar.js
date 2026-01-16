//\NewApp\public\components\calendar.js
export function initCalendar(root) {
  const calendar = root.querySelector("#calendar_");
  const modal = root.querySelector("#taskModal");

  // -------------------------------------------------------
  // OPEN TASK MODAL
  // -------------------------------------------------------
  function openTaskModal(dateKey, existingTask, callback) {
    modal.style.display = "block";

    const title = modal.querySelector("#modalTitle");
    const input = modal.querySelector("#taskInput");
    const time = modal.querySelector("#taskTime");
    const priority = modal.querySelector("#taskPriority");

    title.textContent = `Task for ${dateKey}`;
    input.value = existingTask?.text || "";
    time.value = existingTask?.time || "";
    priority.value = existingTask?.priority || "medium";

    modal.querySelector("#saveTask").onclick = () => {
      callback({
        date: dateKey,
        text: input.value,
        time: time.value,
        priority: priority.value
      });
      modal.style.display = "none";
    };

    modal.querySelector("#cancelTask").onclick = () => {
      modal.style.display = "none";
    };
  }

  // -------------------------------------------------------
  // BUILD CALENDAR
  // -------------------------------------------------------
  function buildCalendar(month, year) {
    calendar.innerHTML = "";

    const tasks = JSON.parse(localStorage.getItem("calendarTasks") || "[]");

    // Header
    const header = document.createElement("header");
    const prevBtn = document.createElement("button");
    const nextBtn = document.createElement("button");
    const title = document.createElement("h3");

    prevBtn.textContent = "<";
    nextBtn.textContent = ">";
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    title.textContent = `${monthNames[month]} ${year}`;

    header.append(prevBtn, title, nextBtn);
    calendar.appendChild(header);

    // Days table
    const table = document.createElement("table");
    const daysRow = document.createElement("tr");
    ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(d => {
      const th = document.createElement("th");
      th.textContent = d;
      daysRow.appendChild(th);
    });
    table.appendChild(daysRow);

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let row = document.createElement("tr");
    for (let i = 0; i < firstDay; i++) row.appendChild(document.createElement("td"));

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("td");
      cell.textContent = day;

      const today = new Date();
      if (
        day === today.getDate() &&
        month === today.getMonth() &&
        year === today.getFullYear()
      ) {
        cell.classList.add("today");
      }

      const dateKey = `${year}-${month + 1}-${day}`;
      const task = tasks.find(t => t.date === dateKey);

      if (task) {
        cell.classList.add("has-task");
        cell.title = task.text;
      }

      cell.addEventListener("click", () => {
        openTaskModal(dateKey, task, (newTask) => {
          const updated = tasks.filter(t => t.date !== dateKey);
          updated.push(newTask);
          localStorage.setItem("calendarTasks", JSON.stringify(updated));
          buildCalendar(month, year);
        });
      });

      row.appendChild(cell);

      if ((day + firstDay) % 7 === 0) {
        table.appendChild(row);
        row = document.createElement("tr");
      }
    }

    if (row.children.length > 0) table.appendChild(row);
    calendar.appendChild(table);

    prevBtn.onclick = () => {
      const newMonth = month === 0 ? 11 : month - 1;
      const newYear = month === 0 ? year - 1 : year;
      buildCalendar(newMonth, newYear);
    };

    nextBtn.onclick = () => {
      const newMonth = month === 11 ? 0 : month + 1;
      const newYear = month === 11 ? year + 1 : year;
      buildCalendar(newMonth, newYear);
    };
  }

  // -------------------------------------------------------
  // INITIALIZE
  // -------------------------------------------------------
  const now = new Date();
  buildCalendar(now.getMonth(), now.getFullYear());
}
