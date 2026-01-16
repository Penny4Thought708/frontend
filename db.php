<?php
$host = "localhost";
$user = "root";
$pass = "";
$dbname = "scrubbers_db";

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    header('Content-Type: application/json');
    echo json_encode(["db_error" => $e->getMessage()]);
    exit;
}
?>


