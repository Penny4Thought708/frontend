// public/js/dashboard/NavigationUI.js

export function initNavigationUI() {

  // Toggle contacts/messages panel
  $("#calling").on("click", () => {
    $("#contact_msg_container").toggle();
    $(".tab_nav").addClass("active");
  });
 
  // Open messages
  $("#rec_tabs").on("click", () => {
    $("#contact_msg_container").show();
  });

  // Home button hides everything
  $("#home_btn").on("click", () => {
    $(".section").hide();
    $("#contact_msg_container").hide();
  });

  // Back button closes message panel + tab bar
  $("#back_btn").on("click", () => {
    $("#contact_msg_container").hide();
    $(".tab_nav").removeClass("active");
  });

  // Auto-slide tab bar after 2 seconds
  setTimeout(() => {
    $(".tab_nav").addClass("active");
  }, 2000);
}
