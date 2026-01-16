<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
mysqli_report(MYSQLI_REPORT_OFF);

function fail($code, $msg) {
    http_response_code($code);
    error_log("[save_settings.php] $msg");
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

// Read JSON body
$input = json_decode(file_get_contents("php://input"), true);
if (!$input) fail(400, "Invalid JSON input");

// Prepare upsert
$stmt = $conn->prepare("
    INSERT INTO user_settings (
        user_id, theme, accent_color, font_size, camera, resolution,
        background_blur, mirror_video, microphone, speaker,
        noise_suppression, echo_cancellation, auto_gain,
        call_alerts, message_alerts, sound_effects,
        high_contrast, keyboard_shortcuts, screen_reader
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
        theme=VALUES(theme),
        accent_color=VALUES(accent_color),
        font_size=VALUES(font_size),
        camera=VALUES(camera),
        resolution=VALUES(resolution),
        background_blur=VALUES(background_blur),
        mirror_video=VALUES(mirror_video),
        microphone=VALUES(microphone),
        speaker=VALUES(speaker),
        noise_suppression=VALUES(noise_suppression),
        echo_cancellation=VALUES(echo_cancellation),
        auto_gain=VALUES(auto_gain),
        call_alerts=VALUES(call_alerts),
        message_alerts=VALUES(message_alerts),
        sound_effects=VALUES(sound_effects),
        high_contrast=VALUES(high_contrast),
        keyboard_shortcuts=VALUES(keyboard_shortcuts),
        screen_reader=VALUES(screen_reader)
");

if (!$stmt) fail(500, "Prepare failed: ".$conn->error);

// Bind parameters: i = int, s = string
$stmt->bind_param(
    "ississiiiiiiiiiiiiii",
    $user_id,
    $input['theme'],
    $input['accent_color'],
    $input['font_size'],
    $input['camera'],
    $input['resolution'],
    $input['background_blur'],
    $input['mirror_video'],
    $input['microphone'],
    $input['speaker'],
    $input['noise_suppression'],
    $input['echo_cancellation'],
    $input['auto_gain'],
    $input['call_alerts'],
    $input['message_alerts'],
    $input['sound_effects'],
    $input['high_contrast'],
    $input['keyboard_shortcuts'],
    $input['screen_reader']
);

if (!$stmt->execute()) fail(500, "Execute failed: ".$stmt->error);

echo json_encode(["success" => true, "message" => "Settings saved"]);
$stmt->close();
$conn->close();
