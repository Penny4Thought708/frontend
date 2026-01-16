<?php
require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";

global $pdo;

$userId = requireAuth();

$offset = intval($_GET['offset'] ?? 0);
$limit  = intval($_GET['limit'] ?? 30);

/*
    FINAL VERSION — FULLY CORRECTED FOR TWO‑ROW LOGGING

    ✔ direction computed relative to logged‑in user
    ✔ other_party_id computed correctly
    ✔ caller/receiver avatars included
    ✔ last message pulled from private_messages
    ✔ supports Node two‑row logging (incoming + outgoing)
    ✔ consistent with frontend normalizeCallLog()
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

    -- Direction relative to logged‑in user
    CASE
        WHEN cl.caller_id = :uid THEN 'outgoing'
        ELSE 'incoming'
    END AS direction,

    -- Other party relative to logged‑in user
    CASE
        WHEN cl.caller_id = :uid THEN cl.receiver_id
        ELSE cl.caller_id
    END AS other_party_id,

    -- Last message text
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

    -- Last message timestamp
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

    -- Last message sender
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

WHERE cl.caller_id = :uid OR cl.receiver_id = :uid
ORDER BY cl.timestamp DESC
LIMIT :offset, :limit
";

$stmt = $pdo->prepare($sql);
$stmt->bindValue(":uid", $userId, PDO::PARAM_INT);
$stmt->bindValue(":offset", $offset, PDO::PARAM_INT);
$stmt->bindValue(":limit", $limit, PDO::PARAM_INT);
$stmt->execute();

$logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

jsonResponse([
    "success" => true,
    "userId"  => $userId,
    "data"    => $logs,
    "hasMore" => count($logs) === $limit
]);

