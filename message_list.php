<?php
require 'db.php';
header('Content-Type: application/json; charset=utf-8');

$user_id = (int)($_GET['user_id'] ?? 0);
if ($user_id <= 0) {
    echo json_encode(["error" => "Missing user_id"]);
    exit;
}

$stmt = $pdo->prepare("
    SELECT 
        pm.id AS message_id,
        pm.message,
        pm.created_at,
        pm.sender_id,
        pm.receiver_id,

        u.user_id AS other_id,
        u.fullname AS other_name,
        u.avatar AS other_avatar,

        (
            SELECT COUNT(*) 
            FROM private_messages 
            WHERE receiver_id = ? 
              AND sender_id = u.user_id 
              AND is_read = 0
        ) AS unread_count

    FROM private_messages pm
    JOIN users u 
      ON u.user_id = 
         CASE 
            WHEN pm.sender_id = ? THEN pm.receiver_id
            ELSE pm.sender_id
         END

    WHERE pm.id IN (
        SELECT MAX(id)
        FROM private_messages
        WHERE sender_id = ? OR receiver_id = ?
        GROUP BY 
            CASE 
                WHEN sender_id = ? THEN receiver_id
                ELSE sender_id
            END
    )

    ORDER BY pm.created_at DESC
");

$stmt->execute([
    $user_id,
    $user_id,
    $user_id,
    $user_id,
    $user_id
]);

$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$output = [];

foreach ($rows as $row) {
    $output[] = [
        "id" => (int)$row["other_id"],
        "name" => $row["other_name"],
     "avatar" => $row["other_avatar"]
    ? "/NewApp/uploads/avatars/" . $row["other_avatar"]
    : null,


        "lastMessage" => [
            "id" => (int)$row["message_id"],
            "text" => $row["message"],
            "timestamp" => date("c", strtotime($row["created_at"])),
            "isFromSelf" => $row["sender_id"] == $user_id
        ],

        "unread" => (int)$row["unread_count"]
    ];
}

echo json_encode([
    "conversations" => $output
]);
