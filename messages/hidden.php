<?php
/**
 * Hidden Messages List
 */

require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";

$stmt = $pdo->prepare("
    SELECT 
        pm.id,
        pm.message,
        pm.sender_id,
        u.getMyFullname AS sender_name
    FROM user_deleted_messages udm
    JOIN private_messages pm ON udm.message_id = pm.id
    JOIN users u ON pm.sender_id = u.user_id
    WHERE udm.user_id = ?
    ORDER BY pm.created_at DESC
");

$stmt->execute([$user_id]);

jsonResponse($stmt->fetchAll());
