<?php



session_start(); // if you're using sessions

$host = "localhost";
$db = "scrubbers_db";
$user = "root";
$pass = ""; // default for XAMPP

$conn = new mysqli($host, $user, $pass, $db);
if ($conn->connect_error) {
  die("Connection failed: " . $conn->connect_error);
}

// Get user ID from session or POST
$user_id = $_SESSION['user_id'] ?? $_POST['user_id'];
$query = $_POST['query'];

if ($user_id && $query) {
  $stmt = $conn->prepare("INSERT INTO search_logs (user_id, query) VALUES (?, ?)");
  $stmt->bind_param("is", $user_id, $query);
  $stmt->execute();
  $stmt->close();
  echo "Search logged.";
} else {
  echo "Missing user ID or query.";
}
var_dump($_POST); // Add this temporarily
$conn->close();
?>
