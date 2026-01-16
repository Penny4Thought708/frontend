<?php
header('Content-Type: application/json');
require 'db.php';

session_start();
$my_id = $_SESSION['user_id'] ?? 0;

$query = trim($_GET['query'] ?? '');

if ($query === '') {
    echo json_encode([]);
    exit;
}

$stmt = $pdo->prepare("
  SELECT 
    user_id AS contact_id,
    fullname AS contact_name,
    email AS contact_email,
    phone AS contact_phone,
    avatar AS contact_avatar,
    banner AS contact_banner,
    bio AS contact_bio,
    website AS contact_website,
    twitter AS contact_twitter,
    instagram AS contact_instagram,
    show_online AS contact_show_online,
    allow_messages AS contact_allow_messages,
    theme AS contact_theme
FROM users

    WHERE user_id != ?
      AND (
            fullname LIKE ?
         OR fullname SOUNDS LIKE ?
         OR email LIKE ?
      )
    ORDER BY fullname ASC
    LIMIT 20
");


$like = "%$query%";

$stmt->execute([$my_id, $like, $query, $like]);

echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
?>






