// The hosted samples' sign-in (examples/college/hosted/portal.js). "Signing in" there is choosing a name, and this
// signs a five-minute token for it, as a portal's backend would (examples/token-signing). The secret signs for the
// demo widget only, whose identity settings name this issuer and audience (backend/deploy/widgets.dev.json).
// CloudFront runs it (cloudfront-js-2.0); Terraform fills in the secret, so the file has no JavaScript ${} of its own.
var crypto = require("crypto");

var part = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

var reply = (status, description, text) => ({
  statusCode: status,
  statusDescription: description,
  headers: { "content-type": { value: "text/plain; charset=utf-8" }, "cache-control": { value: "no-store" } },
  body: { encoding: "text", data: text },
});

function handler(event) {
  var user = event.request.querystring.user;
  if (!user || !/^[A-Za-z0-9_-]{1,40}$/.test(user.value)) {
    return reply(400, "Bad Request", "Choose a name of up to 40 letters, digits, hyphens or underscores.");
  }
  var now = Math.floor(Date.now() / 1000);
  var claims = {
    iss: "https://demo.ucp.invalid",
    aud: "ucp-demo",
    sub: user.value,
    iat: now,
    exp: now + 300,
    jti: event.context.requestId, // a different one for every request, so each token works once
  };
  var signed = part({ alg: "HS256", typ: "JWT" }) + "." + part(claims);
  return reply(200, "OK", signed + "." + crypto.createHmac("sha256", "${secret}").update(signed).digest("base64url"));
}
