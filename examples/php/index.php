<?php
// The site's one page. The build renders it once (php index.php > php.html) and S3 serves the result;
// on a PHP server the same file works as it is.
$gateway = getenv('UCP_GATEWAY');
$widget = getenv('UCP_WIDGET_ID');
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Built with PHP (sample)</title>
<link rel="stylesheet" href="site.css">
</head>
<body>
<p class="sample">Sample page. It is not a customer website.</p>
<main>
<h1>Built with PHP</h1>
<p>PHP wrote this page when the site was built, and S3 serves it as plain HTML. The one script tag at the end adds the assistant: open it from the button in the corner.</p>
<p class="made">Made by <code>php index.php</code> on PHP <?= PHP_VERSION ?>.</p>
<p><a href="index.html">The same page in other languages</a></p>
</main>
<script async src="<?= htmlspecialchars($gateway) ?>/loader.js" data-widget-id="<?= htmlspecialchars($widget) ?>"></script>
</body>
</html>
