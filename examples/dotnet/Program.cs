// The site's one page, written out when the site is built (dotnet run > dotnet.html). S3 serves the result.
Console.WriteLine($$"""
    <!doctype html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Built with .NET (sample)</title>
    <link rel="stylesheet" href="site.css">
    </head>
    <body>
    <p class="sample">Sample page. It is not a customer website.</p>
    <main>
    <h1>Built with .NET</h1>
    <p>C# on .NET wrote this page when the site was built, and S3 serves it as plain HTML. It has no assistant yet. To add one, put the script tag from the admin console at the end of the page.</p>
    <p class="made">Made by <code>dotnet run</code> on .NET {{Environment.Version}}.</p>
    <p><a href="index.html">The same page in other languages</a></p>
    </main>
    <!-- The assistant's script tag from the admin console goes here. -->
    </body>
    </html>
    """);
