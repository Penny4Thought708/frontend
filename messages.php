<?php
/**
 * Private Messaging API
 * ---------------------
 * Handles:
 *   - POST: Insert a new message (text or file metadata)
 *   - GET:  Fetch conversation between two users
 */

require_once __DIR__ . "/core/db.php";
require_once __DIR__ . "/core/response.php";
require_once __DIR__ . "/core/auth.php";
require_once __DIR__ . "/core/utils.php";

global $pdo;

// Authenticate user
$userId = requireAuth();

header('Content-Type: application/json; charset=utf-8');

/* ============================================================
   POST — INSERT MESSAGE
   ============================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    $receiver_id = int_or_zero($_POST['receiver_id'] ?? 0);
    $message     = sanitize_text($_POST['message'] ?? '');
    $transport   = $_POST['transport'] ?? 'http';
    $file        = int_or_zero($_POST['file'] ?? 0);

    // Unified file metadata
    $filename = $_POST['filename'] ?? null;
    $file_url = $_POST['file_url'] ?? null;
    $comment  = $_POST['comment'] ?? null;

    // Validation
    if ($receiver_id <= 0) {
        jsonError("Invalid receiver");
    }
    if ($message === '') {
        jsonError("Message required");
    }

    // Verify both users exist
    $check = $pdo->prepare("
        SELECT COUNT(*) 
        FROM users 
        WHERE user_id IN (:me, :them)
    ");
    $check->execute([
        ":me"   => $userId,
        ":them" => $receiver_id
    ]);

    if ((int) $check->fetchColumn() !== 2) {
        jsonError("User not found");
    }

    // Insert message
    $stmt = $pdo->prepare("
        INSERT INTO private_messages
            (sender_id, receiver_id, message, transport, file, filename, file_url, comment)
        VALUES (:sender, :receiver, :msg, :transport, :file, :filename, :url, :comment)
    ");

    $stmt->execute([
        ":sender"    => $userId,
        ":receiver"  => $receiver_id,
        ":msg"       => $message,
        ":transport" => $transport,
        ":file"      => $file,
        ":filename"  => $filename,
        ":url"       => $file_url,
        ":comment"   => $comment
    ]);

    jsonResponse([
        "success"     => true,
        "id"          => $pdo->lastInsertId(),
        "sender_id"   => $userId,
        "receiver_id" => $receiver_id,
        "message"     => $message,
        "transport"   => $transport,
        "file"        => $file,
        "filename"    => $filename,
        "url"         => $file_url,
        "comment"     => $comment,
        "created_at"  => date("Y-m-d H:i:s"),
        "is_me"       => true
    ]);
}
/* ============================================================
   GET — FETCH CONVERSATION
   ============================================================ */

$contact_id = int_or_zero($_GET['contact_id'] ?? 0);

if ($contact_id <= 0) {
    jsonResponse([
        "success" => true,
        "messages" => []
    ]);
}

$sql = "
    SELECT 
        pm.id,
        pm.sender_id,
        pm.receiver_id,
        pm.message,
        pm.created_at,
        pm.transport,
        pm.file,
        pm.filename,
        pm.file_url,
        pm.comment,
        u1.getMyFullname AS sender_name,
        u2.getMyFullname AS receiver_name
    FROM private_messages pm
    JOIN users u1 ON pm.sender_id = u1.user_id
    JOIN users u2 ON pm.receiver_id = u2.user_id
    WHERE (
            (pm.sender_id = :me AND pm.receiver_id = :them)
         OR (pm.sender_id = :them AND pm.receiver_id = :me)
          )
      AND pm.id NOT IN (
            SELECT message_id
            FROM user_deleted_messages
            WHERE user_id = :me
      )
    ORDER BY pm.created_at ASC
    LIMIT 200
";

$stmt = $pdo->prepare($sql);
$stmt->execute([
    ":me"   => $userId,
    ":them" => $contact_id
]);

$rows = $stmt->fetchAll();
$out  = [];

/* ============================================================
   BUILD OUTPUT WITH TYPE DETECTION
   ============================================================ */
foreach ($rows as $row) {

    // Determine message type
    $type = "text";

    if ((int)$row['file'] === 1) {

        // Audio
        if (!empty($row['filename']) && preg_match('/\.webm$/i', $row['filename'])) {
            $type = "audio";

        // GIF
        } elseif (!empty($row['file_url']) && preg_match('/\.gif/i', $row['file_url'])) {
            $type = "gif";

        // Generic file / image
        } else {
            $type = "file";
        }
    }

    // Fetch reactions
    $rstmt = $pdo->prepare("
        SELECT user_id, emoji
        FROM message_reactions
        WHERE message_id = ?
    ");
    $rstmt->execute([$row['id']]);
    $reactions = $rstmt->fetchAll(PDO::FETCH_ASSOC);

    $out[] = [
        "id"            => (int)$row['id'],
        "sender_id"     => (int)$row['sender_id'],
        "receiver_id"   => (int)$row['receiver_id'],
        "sender_name"   => $row['sender_name'],
        "receiver_name" => $row['receiver_name'],

        // Text only for text messages
        "message"       => ($type === "text" ? sanitize_text($row['message']) : ""),

        "transport"     => $row['transport'],
        "file"          => (int)$row['file'],
        "filename"      => $row['filename'],

        // Correct unified URL
        "file_url"      => $row['file_url'],
        "url"           => $row['file_url'],

        "comment"       => $row['comment'],
        "created_at"    => $row['created_at'],
        "is_read"       => 0,
        "is_me"         => ($row['sender_id'] == $userId),

        // Correct message type
        "type"          => $type,

        // Reactions
        "reactions"     => $reactions
    ];
}

jsonResponse([
    "success" => true,
    "messages" => $out
]);
