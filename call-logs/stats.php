<?php
require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";

global $pdo;

$userId = requireAuth();

/*
    Using SUM(CASE WHEN ... THEN 1 ELSE 0 END)
    ensures consistent behavior across MySQL/MariaDB versions.
*/

$sql = "
SELECT 
    COUNT(*) AS total,

    SUM(CASE WHEN status = 'missed'   THEN 1 ELSE 0 END) AS missed,
    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,

    SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS incoming,
    SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing,

    COALESCE(SUM(duration), 0) AS total_seconds
FROM call_logs
WHERE caller_id = :uid OR receiver_id = :uid
";

$stmt = $pdo->prepare($sql);
$stmt->execute([":uid" => $userId]);

$stats = $stmt->fetch(PDO::FETCH_ASSOC);

// Ensure numeric fields are integers
$stats = array_map(fn($v) => is_numeric($v) ? intval($v) : $v, $stats);

jsonResponse([
    "success" => true,
    "stats"   => $stats
]);
