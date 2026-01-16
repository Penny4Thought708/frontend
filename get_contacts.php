<?php
session_start();
header('Content-Type: application/json');
require 'db.php'; // PDO connection

$user_id = $_SESSION['user_id'] ?? null;
if (!$user_id) {
    echo json_encode([
        "contacts" => [],
        "blocked"  => [],
        "error"    => "Not logged in"
    ]);
    exit;
}

try {
    // Fetch contacts + metadata + bio + banner
    $stmt = $pdo->prepare("
        SELECT 
            u.user_id      AS contact_id,
            u.fullname     AS contact_name,
            u.email        AS contact_email,
            u.avatar       AS avatar_filename,
            u.phone        AS contact_phone,
            u.bio          AS contact_bio,
            u.banner       AS contact_banner,
            c.blocked,
            c.is_favorite,
            c.created_at   AS added_on
        FROM contacts c
        JOIN users u ON c.contact_id = u.user_id
        WHERE c.user_id = ?
        ORDER BY u.fullname ASC
    ");
    $stmt->execute([$user_id]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $contacts = [];
    $blocked  = [];

    // Prepare last message + unread count query
    $msgStmt = $pdo->prepare("
        SELECT 
            m.message,
            m.created_at,
            m.sender_id,
            m.receiver_id,
            (SELECT COUNT(*) FROM messages 
             WHERE receiver_id = :uid AND sender_id = :cid AND seen = 0) AS unread_count
        FROM messages m
        WHERE 
            (m.sender_id = :cid AND m.receiver_id = :uid)
            OR
            (m.sender_id = :uid AND m.receiver_id = :cid)
        ORDER BY m.created_at DESC
        LIMIT 1
    ");

    foreach ($rows as $row) {
        $contactId = (int)$row['contact_id'];

        // Avatar URL
        $avatarUrl = $row['avatar_filename']
            ? "/NewApp/uploads/avatars/" . $row['avatar_filename']
            : "/NewApp/img/defaultUser.png";

        // Banner URL
        $bannerUrl = $row['contact_banner']
            ? "/NewApp/uploads/banners/" . $row['contact_banner']
            : "/NewApp/img/profile-banner.jpg";

        // Fetch last message + unread count
        $msgStmt->execute([
            ":uid" => $user_id,
            ":cid" => $contactId
        ]);
        $msg = $msgStmt->fetch(PDO::FETCH_ASSOC);

        $contact = [
            "contact_id"     => $contactId,
            "contact_name"   => $row['contact_name'],
            "contact_email"  => $row['contact_email'],
            "contact_avatar" => $avatarUrl,
            "contact_phone"  => $row['contact_phone'] ?? null,
            "contact_bio"    => $row['contact_bio'] ?? null,
            "contact_banner" => $bannerUrl,
            "is_favorite"    => !empty($row['is_favorite']),
            "added_on"       => $row['added_on'],
            "online"         => false,

            "last_message"   => $msg['message'] ?? null,
            "last_message_at"=> $msg['created_at'] ?? null,
            "unread_count"   => isset($msg['unread_count']) ? (int)$msg['unread_count'] : 0,
        ];

        if (!empty($row['blocked'])) {
            $blocked[] = $contact;
        } else {
            $contacts[] = $contact;
        }
    }

    echo json_encode([
        "contacts" => $contacts,
        "blocked"  => $blocked,
        "error"    => null
    ]);

} catch (PDOException $e) {
    echo json_encode([
        "contacts" => [],
        "blocked"  => [],
        "error"    => $e->getMessage()
    ]);
}
?>

