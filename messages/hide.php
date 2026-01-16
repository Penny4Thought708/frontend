<?php
/**
 * Hide Message (Delete‑For‑Me)
 */

require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";
require_once __DIR__ . "/../../core/utils.php";

$message_id = int_or_zero($_POST['id'] ?? 0);

if ($message_id <= 0) {
    jsonError("Invalid message ID");
}

$stmt = $pdo->prepare("
    INSERT IGNORE INTO user_deleted_messages (user_id, message_id)
    VALUES (?, ?)
");
$stmt->execute([$user_id, $message_id]);

jsonResponse(["success" => true]);
