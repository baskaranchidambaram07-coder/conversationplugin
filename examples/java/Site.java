// The site's one page, written out when the site is built (java Site.java > java.html). S3 serves the result.
public class Site {
    public static void main(String[] args) {
        System.out.print("""
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Built with Java (sample)</title>
            <link rel="stylesheet" href="site.css">
            </head>
            <body>
            <p class="sample">Sample page. It is not a customer website.</p>
            <main>
            <h1>Built with Java</h1>
            <p>Java wrote this page when the site was built, and S3 serves it as plain HTML. It has no assistant yet. To add one, put the script tag from the admin console at the end of the page.</p>
            <p class="made">Made by <code>java Site.java</code> on Java %s.</p>
            </main>
            <!-- The assistant's script tag from the admin console goes here. -->
            </body>
            </html>
            """.formatted(System.getProperty("java.version")));
    }
}
