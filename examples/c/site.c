/* The site's one page, written out when the site is built (gcc site.c -o site && ./site > c.html). S3 serves it. */
#include <stdio.h>

int main(void) {
    fputs("<!doctype html>\n"
           "<html lang=\"en\">\n"
           "<head>\n"
           "<meta charset=\"utf-8\">\n"
           "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
           "<title>Built with C (sample)</title>\n"
           "<link rel=\"stylesheet\" href=\"site.css\">\n"
           "</head>\n"
           "<body>\n"
           "<p class=\"sample\">Sample page. It is not a customer website.</p>\n"
           "<main>\n"
           "<h1>Built with C</h1>\n"
           "<p>A C program wrote this page when the site was built, and S3 serves it as plain HTML. It has no assistant "
           "yet. To add one, put the script tag from the admin console at the end of the page.</p>\n"
           "<p class=\"made\">Made by <code>gcc site.c</code> on GCC " __VERSION__ ".</p>\n"
           "<p><a href=\"index.html\">The same page in other languages</a></p>\n"
           "</main>\n"
           "<!-- The assistant's script tag from the admin console goes here. -->\n"
           "</body>\n"
           "</html>\n",
           stdout);
    return 0;
}
