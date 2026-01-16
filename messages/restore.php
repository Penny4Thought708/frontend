<?php
/**
 * Restore hidden message
 */

require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";
require_once __DIR__ . "/../../core/utils.php";

$message_id = int_or_zero($_POST["id"] ?? 0);

$stmt = $pdo->prepare("
    DELETE FROM user_deleted_messages
    WHERE user_id = ? AND message_id = ?
");
$stmt->execute([$user_id, $message_id]);

return_json(["success" => true]);
