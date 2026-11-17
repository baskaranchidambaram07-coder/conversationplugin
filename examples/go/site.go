// The site's one page, written out when the site is built (go run site.go > go.html). S3 serves the result.
package main

import (
	"fmt"
	"runtime"
	"strings"
)

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Built with Go (sample)</title>
<link rel="stylesheet" href="site.css">
</head>
<body>
<p class="sample">Sample page. It is not a customer website.</p>
<main>
<h1>Built with Go</h1>
<p>Go wrote this page when the site was built, and S3 serves it as plain HTML. It has no assistant yet. To add one, put the script tag from the admin console at the end of the page.</p>
<p class="made">Made by <code>go run site.go</code> on Go %s.</p>
</main>
<!-- The assistant's script tag from the admin console goes here. -->
</body>
</html>
`

func main() {
	fmt.Printf(page, strings.TrimPrefix(runtime.Version(), "go"))
}
