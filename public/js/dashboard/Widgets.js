// public/js/dashboard/Widgets.js

export function initDraggableWidgets() {
  $("#message_hme_icon").draggable({
    containment: "#shared-space",
    handle: ".text-icon",
    grid: [25, 25],
    snap: ".snap-target",
    snapTolerance: 15
  });
  $("#calling").draggable({
    containment: "#shared-space",
    handle: ".calling_widget",
    grid: [25, 25],
    snap: ".snap-target",
    snapTolerance: 15
  });

  
  $("#contact_widget").draggable({
    containment: "#shared-space",
    handle: ".contact_icon",
    grid: [25, 25],
    snap: ".snap-target",
    snapTolerance: 15
  });



  $("#calendar_icon").draggable({
    containment: "#shared-space",
    handle: ".cal_icon",
    grid: [25, 25],
    snap: ".snap-target",
    snapTolerance: 15
  });

$("#calendar_icon").on("click", () => {
  document.querySelector("calendar-overlay").open();
});


}
