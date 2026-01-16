<?php
header('Content-Type: application/json');

session_start();
require_once __DIR__ . '/db.php';

if (empty($_SESSION['user_id'])) {
    echo json_encode(["status" => "error", "message" => "Not authenticated"]);
    exit;
}

try {
    $stmt = $pdo->prepare("SELECT avatar FROM users WHERE user_id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    $avatar = $stmt->fetchColumn();
} catch (Exception $e) {
    echo json_encode(["status" => "error", "message" => "Database error"]);
    exit;
}

if (!$avatar) {
    echo json_encode(["status" => "error", "message" => "No avatar to enhance"]);
    exit;
}

$avatar = basename($avatar);
$uploadsDir = __DIR__ . '/uploads/avatars';
$srcPath = $uploadsDir . '/' . $avatar;
$enhancedFilename = 'enhanced_' . $avatar;
$enhancedPath = $uploadsDir . '/' . $enhancedFilename;

if (!is_dir($uploadsDir) || !is_readable($srcPath)) {
    echo json_encode(["status" => "error", "message" => "Source avatar not found"]);
    exit;
}

// Here you plug in your AI enhancement logic, writing to $enhancedPath.
// For now, copy as a placeholder:
if (!copy($srcPath, $enhancedPath)) {
    echo json_encode(["status" => "error", "message" => "Failed to enhance avatar"]);
    exit;
}

try {
    $stmt = $pdo->prepare("UPDATE users SET avatar = ? WHERE user_id = ?");
    $stmt->execute([basename($enhancedPath), $_SESSION['user_id']]);
    $_SESSION['avatar'] = basename($enhancedPath);
} catch (Exception $e) {
    if (file_exists($enhancedPath)) {
        @unlink($enhancedPath);
    }
    echo json_encode(["status" => "error", "message" => "Failed to update avatar in database"]);
    exit;
}

$avatarUrl = 'uploads/avatars/' . rawurlencode($enhancedFilename);

echo json_encode([
  "status" => "ok",
  "avatarUrl" => $avatarUrl
]);
