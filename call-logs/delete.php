<?php
require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";

global $pdo;

$userId = requireAuth();

/*
    INPUT
    ----------------------------------------------------
    logId → the call log entry to delete
*/

$logId = intval($_POST['logId'] ?? 0);

if ($logId <= 0) {
    jsonError("Missing or invalid logId");
}

/*
    DELETE ONLY IF:
    - the log belongs to the authenticated user
      (either caller or receiver)
*/

$sql = "
DELETE FROM call_logs
WHERE id = :id
  AND (caller_id = :uid OR receiver_id = :uid)
";

$stmt = $pdo->prepare($sql);
$stmt->execute([
    ":id"  => $logId,
    ":uid" => $userId
]);

/*
    If no rows were affected, the log either:
    - doesn't exist
    - doesn't belong to this user
*/

if ($stmt->rowCount() === 0) {
    jsonResponse([
        "success" => false,
        "message" => "Call log not found or not authorized"
    ]);
}

/*
    SUCCESS
*/

jsonResponse([
    "success" => true,
    "deleted" => $logId
]);
