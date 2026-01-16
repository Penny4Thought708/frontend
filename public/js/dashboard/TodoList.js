// public/js/dashboard/TodoList.js

export function initTodoList() {
  const chalkColors = ["#000", "#000", "#000", "#000", "#000"];

  function saveTasks() {
    const tasks = [];
    $(".todo_list li").each(function () {
      tasks.push({
        text: $(this).find(".task").text(),
        completed: $(this).hasClass("completed"),
        color: $(this).css("color")
      });
    });
    localStorage.setItem("tasks", JSON.stringify(tasks));
  }

  // Load saved tasks
  const saved = JSON.parse(localStorage.getItem("tasks")) || [];
  saved.forEach(task => {
    $(".todo_list").append(`
      <li class="${task.completed ? "completed" : ""}" style="color:${task.color}">
        <span class="task">${task.text}</span>
        <button class="remove">✖</button>
      </li>
    `);
  });

  // Add task
  $("#addTask").on("click", () => {
    const text = $("#newTask").val().trim();
    if (!text) return;

    const color = chalkColors[Math.floor(Math.random() * chalkColors.length)];
    $(".todo_list").append(`
      <li style="color:${color}">
        <span class="task">${text}</span>
        <button class="remove">✖</button>
      </li>
    `);

    $("#newTask").val("");
    saveTasks();
  });

  // Add task with Enter key
  $("#newTask").on("keypress", function (e) {
    if (e.which === 13) {
      $("#addTask").click();
      e.preventDefault();
    }
  });

  // Auto-focus input
  $("#newTask").focus();

  // Toggle completed
  $(".todo_list").on("click", ".task", function () {
    $(this).parent().toggleClass("completed");
    saveTasks();
  });

  // Remove task with animation
  $(".todo_list").on("click", ".remove", function () {
    const li = $(this).parent()[0];
    $(li).addClass("removing");
    setTimeout(() => {
      $(li).remove();
      saveTasks();
    }, 600);
  });

  // Make list sortable
  $(".todo_list").sortable({
    update: saveTasks
  });
}
