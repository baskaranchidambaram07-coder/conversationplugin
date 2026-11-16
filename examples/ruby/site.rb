# The site's one page, written out when the site is built (ruby site.rb > ruby.html). S3 serves the result.
gateway = ENV.fetch("UCP_GATEWAY")
widget = ENV.fetch("UCP_WIDGET_ID")

puts <<~HTML
  <!doctype html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Built with Ruby (sample)</title>
  <link rel="stylesheet" href="site.css">
  </head>
  <body>
  <p class="sample">Sample page. It is not a customer website.</p>
  <main>
  <h1>Built with Ruby</h1>
  <p>Ruby wrote this page when the site was built, and S3 serves it as plain HTML. The one script tag at the end adds the assistant: open it from the button in the corner.</p>
  <p class="made">Made by <code>ruby site.rb</code> on Ruby #{RUBY_VERSION}.</p>
  <p><a href="index.html">The same page in other languages</a></p>
  </main>
  <script async src="#{gateway}/loader.js" data-widget-id="#{widget}"></script>
  </body>
  </html>
HTML
