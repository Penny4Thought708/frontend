<?php
require 'db.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $sender_id   = $_POST['sender_id'];   // from session or hidden input
    $receiver_id = $_POST['receiver_id']; // target user
    $message     = trim($_POST['message']);

    if (!empty($message)) {
        $stmt = $pdo->prepare("INSERT INTO private_messages (sender_id, receiver_id, message, created_at) VALUES (?, ?, ?, NOW())");
        $stmt->execute([$sender_id, $receiver_id, $message]);

        echo json_encode(["status" => "success"]);
    } else {
        echo json_encode(["status" => "error", "msg" => "Message empty"]);
    }
}
?>


