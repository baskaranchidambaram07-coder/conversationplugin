// The site's one page, written out when the site is built (dotnet run > dotnet.html). S3 serves the result.
var gateway = Environment.GetEnvironmentVariable("UCP_GATEWAY");
var widget = Environment.GetEnvironmentVariable("UCP_WIDGET_ID");

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
    <p>C# on .NET wrote this page when the site was built, and S3 serves it as plain HTML. The one script tag at the end adds the assistant: open it from the button in the corner.</p>
    <p class="made">Made by <code>dotnet run</code> on .NET {{Environment.Version}}.</p>
    <p><a href="index.html">The same page in other languages</a></p>
    </main>
    <script async src="{{gateway}}/loader.js" data-widget-id="{{widget}}"></script>
    </body>
    </html>
    """);
