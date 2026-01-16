<?php

require 'db.php';
session_start();
$user_id = $_SESSION['user_id'] ?? null;
$contact_id = $_POST['contact_id'] ?? null;

if (!$user_id || !$contact_id) {
  echo json_encode(["success"=>false,"error"=>"Missing user or contact"]);
  exit;
}

try {
  $stmt = $pdo->prepare("DELETE FROM contacts WHERE user_id=? AND contact_id=?");
  $stmt->execute([$user_id, $contact_id]);
  echo json_encode(["success"=>true]);
} catch (PDOException $e) {
  echo json_encode(["success"=>false,"error"=>$e->getMessage()]);
}

?>

