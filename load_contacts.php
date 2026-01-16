<?php
session_start();
header("Content-Type: application/json");

$conn = new mysqli("localhost", "root", "", "scrubbers_db");
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(["error" => "Database connection failed"]);
    exit;
}

$currentUserId = isset($_SESSION['user_id']) ? intval($_SESSION['user_id']) : 0;

if ($currentUserId === 0) {
    echo json_encode(["contacts" => [], "blocked" => []]);
    exit;
}

// Saved contacts
$stmt = $conn->prepare("
  SELECT u.user_id AS contact_id,
         u.getMyFullname AS contact_name,
         u.email AS contact_email
  FROM contacts c
  JOIN users u ON c.contact_id = u.user_id
  WHERE c.user_id = ? AND (c.blocked IS NULL OR c.blocked = 0)
  ORDER BY u.getMyFullname ASC
");
$stmt->bind_param("i", $currentUserId);
$stmt->execute();
$result = $stmt->get_result();
$contacts = $result->fetch_all(MYSQLI_ASSOC);
$stmt->close();

// Blocked contacts
$stmt = $conn->prepare("
  SELECT u.user_id AS contact_id,
         u.getMyFullname AS contact_name,
         u.email AS contact_email
  FROM contacts c
  JOIN users u ON c.contact_id = u.user_id
  WHERE c.user_id = ? AND c.blocked = 1
  ORDER BY u.getMyFullname ASC
");
$stmt->bind_param("i", $currentUserId);
$stmt->execute();
$result = $stmt->get_result();
$blocked = $result->fetch_all(MYSQLI_ASSOC);
$stmt->close();

$conn->close();

echo json_encode(["contacts" => $contacts, "blocked" => $blocked]);
?>




