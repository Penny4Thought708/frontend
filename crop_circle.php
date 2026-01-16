function cropToCircle($srcPath, $destPath) {
    $src = imagecreatefromstring(file_get_contents($srcPath));
    $w = imagesx($src);
    $h = imagesy($src);
    $size = min($w, $h);

    $dst = imagecreatetruecolor($size, $size);
    imagesavealpha($dst, true);
    $trans = imagecolorallocatealpha($dst, 0, 0, 0, 127);
    imagefill($dst, 0, 0, $trans);

    $mask = imagecreatetruecolor($size, $size);
    $maskColor = imagecolorallocate($mask, 0, 0, 0);
    imagefill($mask, 0, 0, $maskColor);

    $white = imagecolorallocate($mask, 255, 255, 255);
    imagefilledellipse($mask, $size/2, $size/2, $size, $size, $white);

    imagecopyresampled($dst, $src, 0, 0, ($w-$size)/2, ($h-$size)/2, $size, $size, $size, $size);

    for ($x = 0; $x < $size; $x++) {
        for ($y = 0; $y < $size; $y++) {
            $maskPixel = imagecolorat($mask, $x, $y);
            if ($maskPixel == $maskColor) {
                imagesetpixel($dst, $x, $y, $trans);
            }
        }
    }

    imagepng($dst, $destPath);
    imagedestroy($src);
    imagedestroy($dst);
    imagedestroy($mask);
}
