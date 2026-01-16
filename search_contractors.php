<?php
session_start();
header('Content-Type: application/json');
require 'db.php'; // $pdo (PDO)

$q        = trim($_GET['q'] ?? '');
$category = trim($_GET['category'] ?? '');
$page     = max(1, (int)($_GET['page'] ?? 1));
$perPage  = 10;
$offset   = ($page - 1) * $perPage;

$lat = isset($_GET['lat']) ? floatval($_GET['lat']) : null;
$lng = isset($_GET['lng']) ? floatval($_GET['lng']) : null;

try {

    /* -----------------------------------------
       Build SELECT with optional distance
    ----------------------------------------- */

    $distanceSelect = "";
    $distanceOrder  = "";

    if ($lat && $lng) {
        // Haversine formula (distance in km)
        $distanceSelect = ",
            (6371 * acos(
                cos(radians(:lat)) *
                cos(radians(latitude)) *
                cos(radians(longitude) - radians(:lng)) +
                sin(radians(:lat)) *
                sin(radians(latitude))
            )) AS distance";

        $distanceOrder = " ORDER BY distance ASC, rating DESC";
    } else {
        $distanceOrder = " ORDER BY rating DESC";
    }

    /* -----------------------------------------
       Base SQL
    ----------------------------------------- */

    $sql = "
        SELECT 
            id, name, description, phone, website, rating, 
            city, state, category, latitude, longitude
            $distanceSelect
        FROM contractors
        WHERE 1=1
    ";

    $params = [];

    /* -----------------------------------------
       Search filter
    ----------------------------------------- */

    if ($q !== '') {
        $sql .= " AND (name LIKE :q OR description LIKE :q OR city LIKE :q)";
        $params[':q'] = '%' . $q . '%';
    }

    /* -----------------------------------------
       Category filter
    ----------------------------------------- */

    if ($category !== '' && $category !== 'all') {
        $sql .= " AND category = :category";
        $params[':category'] = $category;
    }

    /* -----------------------------------------
       Ordering + Pagination
    ----------------------------------------- */

    $sql .= $distanceOrder . " LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);

    /* -----------------------------------------
       Bind dynamic params
    ----------------------------------------- */

    foreach ($params as $key => $val) {
        $stmt->bindValue($key, $val, PDO::PARAM_STR);
    }

    if ($lat && $lng) {
        $stmt->bindValue(':lat', $lat);
        $stmt->bindValue(':lng', $lng);
    }

    $stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);

    /* -----------------------------------------
       Execute + Return JSON
    ----------------------------------------- */

    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'results' => $rows,
        'page'    => $page,
        'hasMore' => count($rows) === $perPage
    ]);

} catch (PDOException $e) {

    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error'   => 'Database error',
        'details' => $e->getMessage()
    ]);
}
