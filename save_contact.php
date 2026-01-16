<?php
/**
 * save_contacts.php
 * ------------------
 * Creates a new contact relationship between the logged‑in user
 * and another user in the system.
 */

session_start();
header("Content-Type: application/json");

// ------------------------------------------------------------
// 1. Validate session
// ------------------------------------------------------------
if (!isset($_SESSION['user_id'])) {
    echo json_encode([
        "success" => false,
        "error"   => "User not authenticated"
    ]);
    exit;
}

$userId = (int) $_SESSION['user_id'];

// ------------------------------------------------------------
// 2. Validate POST input
// ------------------------------------------------------------
$contactId = isset($_POST['contact_id']) ? (int) $_POST['contact_id'] : null;

if (!$contactId) {
    echo json_encode([
        "success" => false,
        "error"   => "Missing contact_id"
    ]);
    exit;
}

// Prevent adding yourself
if ($contactId === $userId) {
    echo json_encode([
        "success" => false,
        "error"   => "You cannot add yourself as a contact"
    ]);
    exit;
}

require 'db.php';

// ------------------------------------------------------------
// 3. Check if contact already exists
// ------------------------------------------------------------
try {
    $check = $pdo->prepare("
        SELECT id 
        FROM contacts 
        WHERE user_id = ? AND contact_id = ?
        LIMIT 1
    ");
    $check->execute([$userId, $contactId]);

    if ($check->fetch()) {
        echo json_encode([
            "success" => true,
            "message" => "Contact already exists"
        ]);
        exit;
    }

    // ------------------------------------------------------------
    // 4. Insert new contact
    // ------------------------------------------------------------
    $insert = $pdo->prepare("
        INSERT INTO contacts (user_id, contact_id, blocked, is_favorite)
        VALUES (?, ?, 0, 0)
    ");

    $insert->execute([$userId, $contactId]);

    echo json_encode([
        "success" => true,
        "message" => "Contact saved successfully",
        "contact" => [
            "user_id"     => $userId,
            "contact_id"  => $contactId,
            "blocked"     => 0,
            "is_favorite" => 0
        ]
    ]);

} catch (PDOException $e) {
    echo json_encode([
        "success" => false,
        "error"   => "Database error: " . $e->getMessage()
    ]);
}
