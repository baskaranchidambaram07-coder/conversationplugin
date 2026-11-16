/* The site's one page, written out when the site is built (gcc site.c -o site && ./site > c.html). S3 serves it. */
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    const char *gateway = getenv("UCP_GATEWAY"), *widget = getenv("UCP_WIDGET_ID");
    if (!gateway || !widget) {
        fputs("Set UCP_GATEWAY and UCP_WIDGET_ID first.\n", stderr);
        return 1;
    }
    printf("<!doctype html>\n"
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
           "<p>A C program wrote this page when the site was built, and S3 serves it as plain HTML. The one script tag "
           "at the end adds the assistant: open it from the button in the corner.</p>\n"
           "<p class=\"made\">Made by <code>gcc site.c</code> on GCC " __VERSION__ ".</p>\n"
           "<p><a href=\"index.html\">The same page in other languages</a></p>\n"
           "</main>\n"
           "<script async src=\"%s/loader.js\" data-widget-id=\"%s\"></script>\n"
           "</body>\n"
           "</html>\n",
           gateway, widget);
    return 0;
}
