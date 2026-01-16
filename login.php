<?php
session_start();
header('Content-Type: application/json');

$conn = new mysqli("localhost", "root", "", "scrubbers_db");
if ($conn->connect_error) {
  echo json_encode(["success" => false, "error" => "DB connection failed"]);
  exit();
}

$email = $_POST['email'] ?? '';
$password = $_POST['password'] ?? '';

$sql = "SELECT * FROM users WHERE email = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param("s", $email);
$stmt->execute();
$result = $stmt->get_result();

if ($result && $result->num_rows > 0) {
  $user = $result->fetch_assoc();

  if (password_verify($password, $user['password'])) {
    session_regenerate_id(true);

    $_SESSION['user_id']  = $user['user_id'];
    $_SESSION['fullname'] = $user['fullname'];
    $_SESSION['email']    = $user['email'];   // ⭐ REQUIRED
    $_SESSION['avatar']   = $user['avatar'] ?? null;

    echo json_encode([
      "success" => true,
      "redirect" => "dashboard.php"
    ]);
    exit();
  } else {
    echo json_encode([
      "success" => false,
      "error" => "Password Incorrect"
    ]);
    exit();
  }
} else {
  echo json_encode([
    "success" => false,
    "error" => "Email address not registered"
  ]);
  exit();
}
