<?php
require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";

global $pdo;

$userId = requireAuth();

$id = intval($_GET['id'] ?? 0);
if (!$id) {
    jsonError("Missing id");
}

/*
    Same shape and logic as load.php, but for a single call_logs.id
*/

$sql = "
SELECT 
    cl.id,
    cl.caller_id,
    cl.receiver_id,
    cl.call_type,
    cl.status,
    cl.duration,
    cl.timestamp,

    uc.fullname AS caller_name,
    uc.avatar   AS caller_avatar,

    ur.fullname AS receiver_name,
    ur.avatar   AS receiver_avatar,

    CASE
        WHEN cl.caller_id = :uid THEN 'outgoing'
        ELSE 'incoming'
    END AS direction,

    CASE
        WHEN cl.caller_id = :uid THEN cl.receiver_id
        ELSE cl.caller_id
    END AS other_party_id,

    (
        SELECT pm.message
        FROM private_messages pm
        WHERE 
            (
                pm.sender_id = :uid 
                AND pm.receiver_id = 
                    CASE WHEN cl.caller_id = :uid THEN cl.receiver_id ELSE cl.caller_id END
            )
            OR
            (
                pm.sender_id = 
                    CASE WHEN cl.caller_id = :uid THEN cl.receiver_id ELSE cl.caller_id END
                AND pm.receiver_id = :uid
            )
        ORDER BY pm.created_at DESC
        LIMIT 1
    ) AS last_message,

    (
        SELECT pm.created_at
        FROM private_messages pm
        WHERE 
            (
                pm.sender_id = :uid 
                AND pm.receiver_id = 
                    CASE WHEN cl.caller_id = :uid THEN cl.receiver_id ELSE cl.caller_id END
            )
            OR
            (
                pm.sender_id = 
                    CASE WHEN cl.caller_id = :uid THEN cl.receiver_id ELSE cl.caller_id END
                AND pm.receiver_id = :uid
            )
        ORDER BY pm.created_at DESC
        LIMIT 1
    ) AS last_message_time,

    (
        SELECT pm.sender_id
        FROM private_messages pm
        WHERE 
            (
                pm.sender_id = :uid 
                AND pm.receiver_id = 
                    CASE WHEN cl.caller_id = :uid THEN cl.receiver_id ELSE cl.caller_id END
            )
            OR
            (
                pm.sender_id = 
                    CASE WHEN cl.caller_id = :uid THEN cl.receiver_id ELSE cl.caller_id END
                AND pm.receiver_id = :uid
            )
        ORDER BY pm.created_at DESC
        LIMIT 1
    ) AS last_message_sender_id

FROM call_logs cl
LEFT JOIN users uc ON cl.caller_id = uc.user_id
LEFT JOIN users ur ON cl.receiver_id = ur.user_id

WHERE cl.id = :id
  AND (cl.caller_id = :uid OR cl.receiver_id = :uid)
LIMIT 1
";

$stmt = $pdo->prepare($sql);
$stmt->bindValue(":uid", $userId, PDO::PARAM_INT);
$stmt->bindValue(":id", $id, PDO::PARAM_INT);
$stmt->execute();

$log = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$log) {
    jsonError("Not found");
}

jsonResponse([
    "success" => true,
    "userId"  => $userId,
    "log"     => $log
]);
