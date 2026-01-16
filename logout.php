<?php
session_start();          // resume the session
session_unset();          // remove all session variables
session_destroy();        // destroy the session itself

// optionally clear the session cookie
if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000,
        $params["path"], $params["domain"],
        $params["secure"], $params["httponly"]
    );
}

// redirect back to login or home
header("Location: index.php");
exit();
?>
