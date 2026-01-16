<?php
session_start();
header("Content-Type: application/json");

$conn = new mysqli("localhost", "root", "", "scrubbers_db");
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(["error" => "DB connection failed"]);
    exit;
}

$currentUserId = isset($_SESSION['user_id']) ? intval($_SESSION['user_id']) : 1;
$contactId     = isset($_GET['contact_id']) ? intval($_GET['contact_id']) : 0;

if ($contactId <= 0) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid contact ID"]);
    exit;
}

$stmt = $conn->prepare("
    SELECT sender_id, receiver_id, message, created_at
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
    $messages[] = $row;
}

echo json_encode($messages);

$stmt->close();
$conn->close();
?>
