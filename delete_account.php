<?php
session_start();
require "db.php";

$user_id = $_SESSION['user_id'];

$stmt = $pdo->prepare("DELETE FROM users WHERE user_id = ?");
$stmt->execute([$user_id]);

session_destroy();

echo "success";
