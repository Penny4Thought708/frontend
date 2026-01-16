<?php
require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/response.php";
require_once __DIR__ . "/../../core/auth.php";

global $pdo;

$userId = requireAuth();

$messageId = intval($_POST['id'] ?? 0);
$emoji     = $_POST['emoji'] ?? '';

if ($messageId <= 0 || !$emoji) {
    jsonError("Invalid reaction");
}

// Check if user already reacted
$check = $pdo->prepare("
    SELECT COUNT(*) FROM message_reactions
    WHERE message_id = :mid AND user_id = :uid
");
$check->execute([
    ":mid" => $messageId,
    ":uid" => $userId
]);

if ($check->fetchColumn() > 0) {
    // Update existing reaction
    $update = $pdo->prepare("
        UPDATE message_reactions
        SET emoji = :emoji
        WHERE message_id = :mid AND user_id = :uid
    ");
    $update->execute([
        ":emoji" => $emoji,
        ":mid"   => $messageId,
        ":uid"   => $userId
    ]);
} else {
    // Insert new reaction
    $insert = $pdo->prepare("
        INSERT INTO message_reactions (message_id, user_id, emoji)
        VALUES (:mid, :uid, :emoji)
    ");
    $insert->execute([
        ":mid"   => $messageId,
        ":uid"   => $userId,
        ":emoji" => $emoji
    ]);
}

// Fetch updated reaction list
$list = $pdo->prepare("
    SELECT user_id, emoji
    FROM message_reactions
    WHERE message_id = :mid
");
$list->execute([":mid" => $messageId]);

$reactions = $list->fetchAll(PDO::FETCH_ASSOC);

jsonResponse([
    "success"   => true,
    "reactions" => $reactions
]);

