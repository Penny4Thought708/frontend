<?php
require 'db.php';

header('Content-Type: application/json; charset=utf-8');

$sender_id   = isset($_GET['sender_id']) ? (int)$_GET['sender_id'] : 0;
$receiver_id = isset($_GET['receiver_id']) ? (int)$_GET['receiver_id'] : 0;

if ($sender_id <= 0 || $receiver_id <= 0) {
    echo json_encode(["error" => "Missing sender_id or receiver_id"]);
    exit;
}

$stmt = $pdo->prepare("
    SELECT 
        pm.id,
        pm.message,
        pm.sender_id,
        pm.receiver_id,
        pm.created_at,
        u1.fullname AS sender_name,
        u2.fullname AS receiver_name
    FROM private_messages pm
    JOIN users u1 ON pm.sender_id = u1.user_id
    JOIN users u2 ON pm.receiver_id = u2.user_id
    WHERE 
        (pm.sender_id = ? AND pm.receiver_id = ?)
        OR
        (pm.sender_id = ? AND pm.receiver_id = ?)
    ORDER BY pm.created_at ASC
");

$stmt->execute([$sender_id, $receiver_id, $receiver_id, $sender_id]);

echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));

