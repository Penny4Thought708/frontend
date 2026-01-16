<?php
/**
 * Edit Private Message
 */

require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";
require_once __DIR__ . "/../../core/utils.php";

$data = json_decode(file_get_contents("php://input"), true);

$id   = int_or_zero($data["id"] ?? 0);
$text = sanitize_text($data["message"] ?? "");

// Validate sender ownership
$check = $pdo->prepare("SELECT sender_id FROM private_messages WHERE id = ?");
$check->execute([$id]);
$row = $check->fetch();

if (!$row || (int)$row["sender_id"] !== $user_id) {
   jsonError("Not allowed", 403);
}

// Update message
$upd = $pdo->prepare("UPDATE private_messages SET message = ? WHERE id = ?");
$upd->execute([$text, $id]);
jsonResponse([
    "success" => true,
    "id"      => $id,
    "message" => $text
]);
