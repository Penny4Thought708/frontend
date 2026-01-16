<?php
// Database connection
$servername = "localhost";
$username   = "root";
$password   = ""; // your root password if set
$dbname     = "scrubbers_db";

$conn = new mysqli($servername, $username, $password, $dbname);

if ($conn->connect_error) {
  die("<div class='alert error'>Connection failed: " . htmlspecialchars($conn->connect_error) . "</div>");
}

$name    = $_POST['name'] ?? '';
$email   = $_POST['email'] ?? '';
$subject = $_POST['subject'] ?? '';
$message = $_POST['message'] ?? '';

$stmt = $conn->prepare("INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)");
$stmt->bind_param("ssss", $name, $email, $subject, $message);

if ($stmt->execute()) {
  echo "<div class='alert success'>✔ Message saved successfully!</div>";
} else {
  echo "<div class='alert error'>✖ Error: " . htmlspecialchars($stmt->error) . "</div>";
}


$stmt->close();
$conn->close();
?>

