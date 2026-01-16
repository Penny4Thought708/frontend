<?php
require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";

global $pdo;

$userId = requireAuth();

/*
    INPUTS
---------------------------------------------------- */
$caller_id   = intval($_POST['caller_id']   ?? 0);
$receiver_id = intval($_POST['receiver_id'] ?? 0);
$call_type   = trim($_POST['call_type']     ?? '');
$direction   = trim($_POST['direction']     ?? '');
$status      = trim($_POST['status']        ?? '');
$duration    = intval($_POST['duration']    ?? 0);

/*
    VALIDATION
---------------------------------------------------- */
$validTypes      = ['voice', 'video'];
$validDirections = ['incoming', 'outgoing'];
$validStatuses   = ['missed', 'ended', 'rejected', 'connected'];

if (!$caller_id || !$receiver_id) jsonError("Missing caller_id or receiver_id");
if (!in_array($call_type, $validTypes, true)) jsonError("Invalid call_type");
if (!in_array($direction, $validDirections, true)) jsonError("Invalid direction");
if (!in_array($status, $validStatuses, true)) jsonError("Invalid status");

/*
    INSERT CALL LOG
---------------------------------------------------- */
$sql = "
INSERT INTO call_logs 
    (caller_id, receiver_id, call_type, direction, status, duration)
VALUES 
    (:caller, :receiver, :type, :direction, :status, :duration)
";

$stmt = $pdo->prepare($sql);
$stmt->execute([
    ":caller"    => $caller_id,
    ":receiver"  => $receiver_id,
    ":type"      => $call_type,
    ":direction" => $direction,
    ":status"    => $status,
    ":duration"  => $duration
]);

$insertId = $pdo->lastInsertId();

/*
    FETCH ENRICHED ROW (same shape as load.php)
---------------------------------------------------- */

$sql2 = "
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
LIMIT 1
";

$stmt2 = $pdo->prepare($sql2);
$stmt2->execute([
    ":uid" => $userId,
    ":id"  => $insertId
]);

$log = $stmt2->fetch(PDO::FETCH_ASSOC);

/*
    RESPONSE (full enriched row)
---------------------------------------------------- */

jsonResponse([
    "success" => true,
    "log"     => $log
]);
// Notify Node server
$ch = curl_init("http://localhost:3001/call-log/new");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
    "id" => $insertId,
    "userId" => $userId
]));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_exec($ch);

