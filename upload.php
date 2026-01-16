<?php
/**
 * File Upload Endpoint
 * --------------------
 * Handles file uploads and inserts a file-type message
 * into private_messages.
 */

require_once __DIR__ . "/core/db.php";
require_once __DIR__ . "/core/auth.php";
require_once __DIR__ . "/core/response.php";
require_once __DIR__ . "/core/utils.php";

// --------------------------------------------------------
// Validate sender/receiver
// --------------------------------------------------------
$sender   = int_or_zero($_POST["sender_id"] ?? 0);
$receiver = int_or_zero($_POST["receiver_id"] ?? 0);

if ($sender === 0 || $receiver === 0) {
    error_json("Invalid sender or receiver", 400);
}

// --------------------------------------------------------
// Validate file upload
// --------------------------------------------------------
if (!isset($_FILES["attachment"]) || $_FILES["attachment"]["error"] !== UPLOAD_ERR_OK) {
    error_json("File upload failed", 400);
}

$file = $_FILES["attachment"];
$name = basename($file["name"]);

// --------------------------------------------------------
// Ensure uploads directory exists
// --------------------------------------------------------
$uploadDir = __DIR__ . "/uploads/";
$publicPath = "uploads/"; // path exposed to frontend

if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0777, true);
}

// --------------------------------------------------------
// Build final file path
// --------------------------------------------------------
$finalName = time() . "_" . $name;
$fullPath  = $uploadDir . $finalName;
$urlPath   = $publicPath . $finalName;

// --------------------------------------------------------
// Move file to uploads/
// --------------------------------------------------------
if (!move_uploaded_file($file["tmp_name"], $fullPath)) {
    error_json("Failed to save file", 500);
}

// --------------------------------------------------------
// Insert message into DB
// --------------------------------------------------------
$stmt = $pdo->prepare("
    INSERT INTO private_messages 
        (sender_id, receiver_id, file, filename, file_url, created_at, transport)
    VALUES (?, ?, 1, ?, ?, NOW(), 'http')
");

$stmt->execute([$sender, $receiver, $name, $urlPath]);

$id = $pdo->lastInsertId();

// --------------------------------------------------------
// Response
// --------------------------------------------------------
return_json([
    "id"          => (int) $id,
    "sender_id"   => $sender,
    "receiver_id" => $receiver,
    "message"     => null,
    "file"        => 1,
    "filename"    => $name,
    "file_url"    => $urlPath,
    "comment"     => null,
    "created_at"  => date("Y-m-d H:i:s"),
    "transport"   => "http",
    "is_me"       => true,
    "reactions"   => []
]);
