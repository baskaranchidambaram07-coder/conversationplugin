// The site's one page, written out when the site is built (node site.mjs > node.html). S3 serves the result.
const { UCP_GATEWAY: gateway, UCP_WIDGET_ID: widget } = process.env;

process.stdout.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Built with Node (sample)</title>
<link rel="stylesheet" href="site.css">
</head>
<body>
<p class="sample">Sample page. It is not a customer website.</p>
<main>
<h1>Built with Node</h1>
<p>JavaScript on Node wrote this page when the site was built, and S3 serves it as plain HTML. The one script tag at the end adds the assistant: open it from the button in the corner.</p>
<p class="made">Made by <code>node site.mjs</code> on Node ${process.version}.</p>
<p><a href="index.html">The same page in other languages</a></p>
</main>
<script async src="${gateway}/loader.js" data-widget-id="${widget}"></script>
</body>
</html>
`);
