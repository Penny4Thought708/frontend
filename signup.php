<?php
session_start();
$conn = new mysqli("localhost", "root", "", "scrubbers_db");

if ($conn->connect_error) {
  die("Connection failed: " . $conn->connect_error);
}

$getMyFullname = isset($_POST['getMyFullname']) ? trim($_POST['getMyFullname']) : "";
$email    = isset($_POST['email']) ? trim($_POST['email']) : "";
$password = isset($_POST['password']) ? $_POST['password'] : "";
$confirm  = isset($_POST['confirm-password']) ? $_POST['confirm-password'] : "";

if ($getMyFullname === "" || $email === "" || $password === "" || $confirm === "") {
  $_SESSION['signup_error'] = "All fields are required.";
  header("Location: index.php");
  exit();
}

if ($password !== $confirm) {
  $_SESSION['signup_error'] = "Passwords do not match.";
  header("Location: index.php");
  exit();
}

$hashedPassword = password_hash($password, PASSWORD_DEFAULT);

$sql = "INSERT INTO users (getMyFullname, email, password) VALUES (?, ?, ?)";
$stmt = $conn->prepare($sql);
$stmt->bind_param("sss", $getMyFullname, $email, $hashedPassword);

if ($stmt->execute()) {
  $_SESSION['signup_success'] = "Signup successful! Please log in.";
} else {
  $_SESSION['signup_error'] = "Error inserting: " . $stmt->error;
}

$stmt->close();
$conn->close();

header("Location: index.php");
exit();
?>


