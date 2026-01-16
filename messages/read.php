<?php
/**
 * Mark message as read
 */

require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";
require_once __DIR__ . "/../../core/utils.php";

$from = int_or_zero($_POST["from"] ?? 0);
$to   = int_or_zero($_POST["to"] ?? 0);
$id   = int_or_zero($_POST["messageId"] ?? 0);

if ($from === 0 || $to === 0 || $id === 0) {
    jsonError("Missing parameters");
}

$stmt = $pdo->prepare("
    UPDATE private_messages
    SET is_read = 1
    WHERE id = ? 
      AND receiver_id = ? 
      AND sender_id = ?
");
$stmt->execute([$id, $to, $from]);

jsonResponse(["success" => true]);
