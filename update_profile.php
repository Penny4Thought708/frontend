<?php
session_start();
require "db.php";

header("Content-Type: application/json");
ob_clean(); // prevent accidental output

// Ensure user is logged in
$user_id = $_SESSION['user_id'] ?? 0;
if (!$user_id) {
    echo json_encode(["success" => false, "error" => "No session"]);
    exit();
}

$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Collect POST data
$fullname        = trim($_POST['fullname'] ?? '');
$email           = trim($_POST['email'] ?? '');
$bio             = ($_POST['bio'] !== '') ? trim($_POST['bio']) : null;
$website         = trim($_POST['website'] ?? '');
$twitter         = trim($_POST['twitter'] ?? '');
$instagram       = trim($_POST['instagram'] ?? '');
$show_online     = isset($_POST['show_online']) ? (int)$_POST['show_online'] : 0;
$allow_messages  = isset($_POST['allow_messages']) ? (int)$_POST['allow_messages'] : 0;

// Validate email
if ($email === "") {
    echo json_encode(["success" => false, "error" => "Email cannot be empty"]);
    exit();
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    echo json_encode(["success" => false, "error" => "Invalid email format"]);
    exit();
}

// Check if email is already used by another user
$check = $pdo->prepare("SELECT user_id FROM users WHERE email = :email AND user_id != :uid");
$check->execute([
    ":email" => $email,
    ":uid"   => $user_id
]);

if ($check->rowCount() > 0) {
    echo json_encode(["success" => false, "error" => "Email already in use"]);
    exit();
}

// Update user profile
$sql = "UPDATE users SET 
            fullname = :fullname,
            email = :email,
            bio = :bio,
            website = :website,
            twitter = :twitter,
            instagram = :instagram,
            show_online = :show_online,
            allow_messages = :allow_messages
        WHERE user_id = :user_id";

$stmt = $pdo->prepare($sql);

$stmt->execute([
    ":fullname"        => $fullname,
    ":email"           => $email,
    ":bio"             => $bio,
    ":website"         => $website,
    ":twitter"         => $twitter,
    ":instagram"       => $instagram,
    ":show_online"     => $show_online,
    ":allow_messages"  => $allow_messages,
    ":user_id"         => $user_id
]);

// Notify realtime server
$payload = json_encode([
    "user_id" => $user_id,
    "fullname" => $fullname,
    "email" => $email,
    "bio" => $bio,
    "website" => $website,
    "twitter" => $twitter,
    "instagram" => $instagram,
    "avatar" => $_SESSION['avatar'] ?? null,
    "show_online" => $show_online,
    "allow_messages" => $allow_messages
]);

$ch = curl_init("http://localhost:3001/profile-update");
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch); // DO NOT echo this

// Update session
$_SESSION['fullname'] = $fullname;
$_SESSION['email']    = $email;
$_SESSION['bio']      = $bio;
$_SESSION['website']  = $website;
$_SESSION['twitter']  = $twitter;
$_SESSION['instagram']= $instagram;
$_SESSION['show_online'] = $show_online;
$_SESSION['allow_messages'] = $allow_messages;

echo json_encode(["success" => true]);
