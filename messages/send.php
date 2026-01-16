<?php
require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/auth.php";
require_once __DIR__ . "/../../core/response.php";
require_once __DIR__ . "/../../core/utils.php";

global $pdo;

$userId = requireAuth();

$receiver = int_or_zero($_POST["receiver_id"] ?? 0);
$message  = trim($_POST["message"] ?? "");
$fileFlag = isset($_POST["file"]) ? (int)$_POST["file"] : 0;
$fileUrl  = trim($_POST["file_url"] ?? "");
$filename = $_POST["filename"] ?? null;
$comment  = $_POST["comment"] ?? null;

if ($receiver === 0) {
    jsonError("Invalid receiver");
}

/* -------------------------------------------------------
   GIF / FILE MESSAGE
------------------------------------------------------- */
if ($fileFlag === 1 && $fileUrl !== "") {

    $stmt = $pdo->prepare("
        INSERT INTO private_messages 
            (sender_id, receiver_id, message, file, filename, file_url, comment, created_at, transport)
        VALUES (?, ?, '', 1, ?, ?, ?, NOW(), 'http')
    ");
    $stmt->execute([
        $userId,
        $receiver,
        $filename,
        $fileUrl,
        $comment
    ]);

    $id = $pdo->lastInsertId();

    jsonResponse([
        "success"      => true,
        "id"           => (int)$id,
        "sender_id"    => $userId,
        "receiver_id"  => $receiver,
        "message"      => "",
        "file"         => 1,
        "filename"     => $filename,
        "file_url"     => $fileUrl,
        "comment"      => $comment,
        "created_at"   => date("Y-m-d H:i:s"),
        "transport"    => "http",
        "is_me"        => true,
        "type"         => "gif",
        "reactions"    => []
    ]);
    exit;
}

/* -------------------------------------------------------
   TEXT MESSAGE
------------------------------------------------------- */
$message = sanitize_text($message);
if ($message === "") {
    jsonError("Invalid message");
}

$stmt = $pdo->prepare("
    INSERT INTO private_messages 
        (sender_id, receiver_id, message, file, created_at, transport)
    VALUES (?, ?, ?, 0, NOW(), 'http')
");
$stmt->execute([$userId, $receiver, $message]);

$id = $pdo->lastInsertId();

jsonResponse([
    "success"      => true,
    "id"           => (int)$id,
    "sender_id"    => $userId,
    "receiver_id"  => $receiver,
    "message"      => $message,
    "file"         => 0,
    "filename"     => null,
    "file_url"     => null,
    "comment"      => null,
    "created_at"   => date("Y-m-d H:i:s"),
    "transport"    => "http",
    "is_me"        => true,
    "type"         => "text",
    "reactions"    => []
]);
