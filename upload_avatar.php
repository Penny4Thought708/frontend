<?php
session_start();
require "db.php"; // your PDO connection

if (!isset($_FILES['profileImage'])) {
    die("No file uploaded");
}

$file = $_FILES['profileImage'];

// Validate
if ($file['error'] !== UPLOAD_ERR_OK) die("Upload error");
if ($file['size'] > 3 * 1024 * 1024) die("File too large");

$allowed = ['image/jpeg', 'image/png', 'image/webp'];
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
if (!in_array($mime, $allowed)) die("Invalid file type");

// Generate filename
$ext = pathinfo($file['name'], PATHINFO_EXTENSION);
$filename = uniqid("avatar_") . "." . $ext;

// Move file
$path = "uploads/avatars/" . $filename;
move_uploaded_file($file['tmp_name'], $path);

// Update DB
$stmt = $pdo->prepare("UPDATE users SET avatar = ? WHERE user_id = ?");
$stmt->execute([$filename, $_SESSION['user_id']]);

// Update session
$_SESSION['avatar'] = $filename;

echo "Avatar updated";
