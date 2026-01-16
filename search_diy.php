<?php
require 'db.php'; // your PDO connection

// Get search term safely
$query = $_GET['query'] ?? '';
$query = trim($query);

if ($query === '') {
    echo json_encode([]);
    exit;
}

try {
    // Simple search against title/description
    $stmt = $pdo->prepare("
        SELECT id, title, description
        FROM diy_guides
        WHERE title LIKE ? OR description LIKE ?
        ORDER BY id DESC
        LIMIT 20
    ");
    $like = "%$query%";
    $stmt->execute([$like, $like]);

    $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

    header('Content-Type: application/json');
    echo json_encode($results);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["error" => "Database error: " . $e->getMessage()]);
}
?>
