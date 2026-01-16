<?php
/**
 * Delete Private Message
 * ----------------------
 * Supports:
 *   - Delete for everyone (hard delete) → only sender allowed
 *   - Delete for me (handled in hide.php)
 */

require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";
require_once __DIR__ . "/../../core/utils.php";

header('Content-Type: application/json; charset=utf-8');

// ⭐ REQUIRED — you forgot this
$user_id = requireAuth();

/* --------------------------------------------------------
   Input Validation
-------------------------------------------------------- */
$id       = int_or_zero($_POST['id'] ?? 0);
$everyone = int_or_zero($_POST['everyone'] ?? 0);

if ($id <= 0) {
    jsonError("Invalid message ID");
}

/* --------------------------------------------------------
   Delete for Everyone (Hard Delete)
-------------------------------------------------------- */
if ($everyone === 1) {

    // Verify sender owns the message
    $check = $pdo->prepare("SELECT sender_id FROM private_messages WHERE id = ?");
    $check->execute([$id]);
    $row = $check->fetch();

    if (!$row) {
       jsonError("Message not found");
    }

    if ((int) $row['sender_id'] !== $user_id) {
        jsonError("Not allowed");
    }

    // Delete message
    $del = $pdo->prepare("DELETE FROM private_messages WHERE id = ?");
    $del->execute([$id]);

    // Remove any per-user hides
    $cleanup = $pdo->prepare("DELETE FROM user_deleted_messages WHERE message_id = ?");
    $cleanup->execute([$id]);

    jsonResponse(["success" => true]);
}

/* --------------------------------------------------------
   Fallback (Delete-for-me handled in hide.php)
-------------------------------------------------------- */
jsonResponse(["success" => true]);
