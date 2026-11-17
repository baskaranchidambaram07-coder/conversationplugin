// The site's one page, written out when the site is built (g++ site.cpp -o site && ./site > cpp.html). S3 serves it.
#include <iostream>

int main() {
    std::cout << R"(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Built with C++ (sample)</title>
<link rel="stylesheet" href="site.css">
</head>
<body>
<p class="sample">Sample page. It is not a customer website.</p>
<main>
<h1>Built with C++</h1>
<p>A C++ program wrote this page when the site was built, and S3 serves it as plain HTML. It has no assistant yet. To add one, put the script tag from the admin console at the end of the page.</p>
<p class="made">Made by <code>g++ site.cpp</code> on GCC )" __VERSION__ R"(.</p>
</main>
<!-- The assistant's script tag from the admin console goes here. -->
</body>
</html>
)";
}
