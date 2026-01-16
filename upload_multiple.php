<?php
require "db.php";

$sender   = intval($_POST["sender_id"]);
$receiver = intval($_POST["receiver_id"]);
$comment  = $_POST["comment"] ?? "";

if (!isset($_FILES["attachments"])) {
    echo json_encode(["error" => "No files uploaded"]);
    exit;
}

$uploadDir = "uploads/";
if (!is_dir($uploadDir)) mkdir($uploadDir, 0777, true);

$files   = $_FILES["attachments"];
$count   = count($files["name"]);
$results = [];

for ($i = 0; $i < $count; $i++) {
    if ($files["error"][$i] !== UPLOAD_ERR_OK) continue;

    $origName = basename($files["name"][$i]);
    $tmpPath  = $files["tmp_name"][$i];
    $newPath  = $uploadDir . time() . "_" . $origName;

    move_uploaded_file($tmpPath, $newPath);

    $stmt = $pdo->prepare("
        INSERT INTO private_messages
        (sender_id, receiver_id, file, filename, file_url, comment, created_at, transport)
        VALUES (?, ?, 1, ?, ?, ?, NOW(), 'http')
    ");
    $stmt->execute([$sender, $receiver, $origName, $newPath, $comment]);

    $id = $pdo->lastInsertId();

    $results[] = [
        "id"          => intval($id),
        "sender_id"   => $sender,
        "receiver_id" => $receiver,
        "message"     => null,
        "file"        => 1,
        "filename"    => $origName,
        "file_url"    => $newPath,
        "comment"     => $comment,
        "created_at"  => date("Y-m-d H:i:s"),
        "transport"   => "http",
        "is_me"       => true,
        "reactions"   => []
    ];
}

echo json_encode($results);
?>
