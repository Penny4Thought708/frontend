<?php
/**
 *  load.php
 * Load Messages (API)
 * -------------------
 * Returns conversation between authenticated user and contact_id.
 */

require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/response.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/utils.php";

global $pdo;

// Authenticate user
$userId = requireAuth();

// Validate contact_id
$contact_id = int_or_zero($_GET['contact_id'] ?? 0);
if ($contact_id <= 0) {
    jsonResponse([
        "success" => true,
        "messages" => []
    ]);
}

// Fetch messages
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
        pm.is_read,
        u1.fullname AS sender_name,
        u2.fullname AS receiver_name
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

// Build output
foreach ($rows as $row) {

    // Determine message type
    $type = "text";

    if ((int)$row['file'] === 1) {

        // Audio detection
        if (!empty($row['filename']) && preg_match('/\.webm$/i', $row['filename'])) {
            $type = "audio";

        // GIF detection
        } elseif (!empty($row['file_url']) && preg_match('/\.gif$/i', $row['file_url'])) {
            $type = "gif";

        // Generic file
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
    $reactions = $rstmt->fetchAll();

    $out[] = [
        "id"            => (int)$row['id'],
        "sender_id"     => (int)$row['sender_id'],
        "receiver_id"   => (int)$row['receiver_id'],
        "sender_name"   => $row['sender_name'],
        "receiver_name" => $row['receiver_name'],

        "message"       => ($type === "text" ? sanitize_text($row['message']) : ""),

        "transport"     => $row['transport'],
        "file"          => (int)$row['file'],
        "filename"      => $row['filename'],

        "file_url"      => $row['file_url'],
        "url"           => $row['file_url'],

        "comment"       => $row['comment'],
        "created_at"    => $row['created_at'],
        "is_read"       => (int)$row['is_read'],
        "is_me"         => ($row['sender_id'] == $userId),

        "type"          => $type,
        "reactions"     => $reactions
    ];
}

// Return JSON
jsonResponse([
    "success" => true,
    "messages" => $out
]);
