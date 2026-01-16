<?php
if (!isset($_GET['url'])) {
  http_response_code(400);
  echo json_encode(["error" => "Missing URL"]);
  exit;
}
$url = $_GET['url'];
$response = file_get_contents($url);
header('Content-Type: application/json');
echo $response;
?>
