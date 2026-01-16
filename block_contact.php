<?php
require 'db.php';

session_start();
$user_id = $_SESSION['user_id'] ?? null;
$contact_id = $_POST['contact_id'] ?? null;

if (!$user_id || !$contact_id) {
  echo json_encode(["success" => false, "error" => "Missing user or contact"]);
  exit;
}

try {
  // 1. Update contacts table (UI)
  $stmt = $pdo->prepare("UPDATE contacts SET blocked = 1 WHERE user_id = ? AND contact_id = ?");
  $stmt->execute([$user_id, $contact_id]);

  // 2. Insert into backend block table (backend enforcement)
  $stmt2 = $pdo->prepare("
      INSERT INTO blocked_contacts (user_id, blocked_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE blocked_id = blocked_id
  ");
  $stmt2->execute([$user_id, $contact_id]);

  echo json_encode([
    "success" => true,
    "user" => $user_id,
    "contact" => $contact_id
  ]);

} catch (PDOException $e) {
  echo json_encode(["success" => false, "error" => $e->getMessage()]);
}
