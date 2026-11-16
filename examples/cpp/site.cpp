// The site's one page, written out when the site is built (g++ site.cpp -o site && ./site > cpp.html). S3 serves it.
#include <cstdlib>
#include <iostream>

int main() {
    const char *gateway = std::getenv("UCP_GATEWAY"), *widget = std::getenv("UCP_WIDGET_ID");
    if (!gateway || !widget) {
        std::cerr << "Set UCP_GATEWAY and UCP_WIDGET_ID first.\n";
        return 1;
    }
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
<p>A C++ program wrote this page when the site was built, and S3 serves it as plain HTML. The one script tag at the end adds the assistant: open it from the button in the corner.</p>
<p class="made">Made by <code>g++ site.cpp</code> on GCC )" __VERSION__ R"(.</p>
<p><a href="index.html">The same page in other languages</a></p>
</main>
<script async src=")" << gateway << R"(/loader.js" data-widget-id=")" << widget << R"("></script>
</body>
</html>
)";
}
