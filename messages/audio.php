<?php
require_once __DIR__ . "/../../core/db.php";
require_once __DIR__ . "/../../core/response.php";

if (!isset($_FILES['audio'])) {
    jsonError("No audio uploaded");
}

$from = intval($_POST['from'] ?? 0);
$to   = intval($_POST['to'] ?? 0);

if (!$from || !$to) {
    jsonError("Missing sender or receiver");
}

$uploadDir = __DIR__ . "/../../uploads/audio/";
$publicDir = "uploads/audio/";

if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0777, true);
}

$filename = "audio_" . time() . "_" . rand(1000, 9999) . ".webm";
$fullPath = $uploadDir . $filename;
$urlPath  = $publicDir . $filename;

if (!move_uploaded_file($_FILES['audio']['tmp_name'], $fullPath)) {
    jsonError("Failed to save audio", 500);
}

// Insert into DB
$stmt = $pdo->prepare("
    INSERT INTO private_messages 
    (sender_id, receiver_id, message, file, filename, file_url, created_at, transport)
    VALUES (?, ?, '', 1, ?, ?, NOW(), 'http')
");

$stmt->execute([$from, $to, $filename, $urlPath]);

$id = $pdo->lastInsertId();

jsonResponse([
    "success" => true,
    "id"      => intval($id),
    "url"     => $urlPath,
    "filename"=> $filename
]);
