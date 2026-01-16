<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_OFF);

function fail($code, $msg) {
    http_response_code($code);
    error_log("[reset_settings.php] $msg");
    echo json_encode(["success" => false, "error" => $msg]);
    exit();
}

$conn = new mysqli("localhost", "root", "", "scrubbers_db");
if ($conn->connect_error) fail(500, "DB connect error: ".$conn->connect_error);
$conn->set_charset("utf8mb4");

// Session check
if (!isset($_SESSION['user_id']) || !is_numeric($_SESSION['user_id'])) {
    fail(401, "Not authenticated: missing session user_id");
}
$user_id = (int)$_SESSION['user_id'];

// Delete settings row for this user
$stmt = $conn->prepare("DELETE FROM user_settings WHERE user_id = ?");
if (!$stmt) fail(500, "Prepare failed: ".$conn->error);
$stmt->bind_param("i", $user_id);
if (!$stmt->execute()) fail(500, "Execute failed: ".$stmt->error);

echo json_encode([
    "success" => true,
    "message" => "Settings reset to default"
]);

$stmt->close();
$conn->close();
