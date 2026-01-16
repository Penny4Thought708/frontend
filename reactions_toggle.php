<?php
require "db.php";

$data = json_decode(file_get_contents("php://input"), true);

$message_id = intval($data["message_id"]);
$user_id    = intval($data["user_id"]);
$emoji      = $data["emoji"] ?? "";

$stmt = $pdo->prepare("SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?");
$stmt->execute([$message_id, $user_id, $emoji]);
$existing = $stmt->fetch(PDO::FETCH_ASSOC);

if ($existing) {
    $del = $pdo->prepare("DELETE FROM message_reactions WHERE id = ?");
    $del->execute([$existing["id"]]);
} else {
    $ins = $pdo->prepare("INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)");
    $ins->execute([$message_id, $user_id, $emoji]);
}

$react_stmt = $pdo->prepare("
    SELECT emoji, COUNT(*) AS count
    FROM message_reactions
    WHERE message_id = ?
    GROUP BY emoji
");
$react_stmt->execute([$message_id]);
$reactions = $react_stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode([
    "message_id" => $message_id,
    "reactions"  => $reactions
]);
?>
