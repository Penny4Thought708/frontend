<?php
session_start();
require "db.php";

$stmt = $pdo->prepare("SELECT avatar FROM users WHERE user_id = ?");
$stmt->execute([$_SESSION['user_id']]);
$avatar = $stmt->fetchColumn();

if ($avatar && file_exists("uploads/avatars/" . $avatar)) {
    unlink("uploads/avatars/" . $avatar);
}

$stmt = $pdo->prepare("UPDATE users SET avatar = NULL WHERE user_id = ?");
$stmt->execute([$_SESSION['user_id']]);

$_SESSION['avatar'] = null;

echo "success";
