<?php
session_start();
header("Content-Type: application/json");

$conn = new mysqli("localhost", "root", "", "scrubbers_db");
if ($conn->connect_error) {
    echo json_encode(["error" => "DB connection failed"]);
    exit;
}

$currentUserId = isset($_SESSION['user_id']) ? intval($_SESSION['user_id']) : 0;
$contactId     = isset($_GET['contact_id']) ? intval($_GET['contact_id']) : 0;

if ($currentUserId <= 0 || $contactId <= 0) {
    echo json_encode(["error" => "Missing user_id or contact_id"]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, sender_id, receiver_id, message, created_at
    FROM private_messages
    WHERE (sender_id = ? AND receiver_id = ?)
       OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
");
$stmt->bind_param("iiii", $currentUserId, $contactId, $contactId, $currentUserId);
$stmt->execute();
$result = $stmt->get_result();

$messages = [];

while ($row = $result->fetch_assoc()) {
    $messages[] = [
        "id"         => (int)$row["id"],
        "text"       => $row["message"],
        "timestamp"  => date("c", strtotime($row["created_at"])),
        "isFromSelf" => ($row["sender_id"] == $currentUserId)
    ];
}

echo json_encode(["messages" => $messages]);

$stmt->close();
$conn->close();
