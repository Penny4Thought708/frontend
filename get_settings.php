<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_OFF);

function fail($code, $msg) {
    http_response_code($code);
    error_log("[get_settings.php] $msg");
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

// Fetch settings
$stmt = $conn->prepare("SELECT * FROM user_settings WHERE user_id = ?");
if (!$stmt) fail(500, "Prepare failed: ".$conn->error);
$stmt->bind_param("i", $user_id);
if (!$stmt->execute()) fail(500, "Execute failed: ".$stmt->error);
$result = $stmt->get_result();

if ($row = $result->fetch_assoc()) {
    // Return settings as JSON
echo json_encode([
    "success" => true,
    "settings" => [
        "theme"             => $row['theme'],
        "accent_color"      => $row['accent_color'],
        "font_size"         => (int)$row['font_size'],
        "camera"            => $row['camera'],
        "resolution"        => $row['resolution'],
        "background_blur"   => (bool)$row['background_blur'],
        "mirror_video"      => (bool)$row['mirror_video'],
        "microphone"        => $row['microphone'],
        "speaker"           => $row['speaker'],
        "noise_suppression" => (bool)$row['noise_suppression'],
        "echo_cancellation" => (bool)$row['echo_cancellation'],
        "auto_gain"         => (bool)$row['auto_gain'],
        "call_alerts"       => (bool)$row['call_alerts'],
        "message_alerts"    => (bool)$row['message_alerts'],
        "sound_effects"     => (bool)$row['sound_effects'],
        "high_contrast"     => (bool)$row['high_contrast'],
        "keyboard_shortcuts"=> (bool)$row['keyboard_shortcuts'],
        "screen_reader"     => (bool)$row['screen_reader']
    ]
]);

} else {
    // No settings saved yet, return defaults
    echo json_encode([
        "success" => true,
        "settings" => [
            "theme"             => "system",
      "accent_color"      => "#4CAF50",
"font_size"         => 16,
"background_blur"   => false,
"mirror_video"      => false,
"noise_suppression" => false,
"echo_cancellation" => false,
"auto_gain"         => false,
"call_alerts"       => true,
"message_alerts"    => true,
"sound_effects"     => true,
"high_contrast"     => false,
"keyboard_shortcuts"=> true,
"screen_reader"     => false
        ]
    ]);
}

$stmt->close();
$conn->close();
