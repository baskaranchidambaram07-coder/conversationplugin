// Signs a widget token for your signed-in user. Node 18 or later, no packages.
//
//   UCP_WIDGET_SECRET=... UCP_ISSUER=https://portal.example.org UCP_WIDGET_ID=w_... node sign.mjs <user id>
//
// Call widgetToken(userId) from the endpoint your page's getToken fetches, after checking the user is signed in.
// The user ID must be your stable ID for the user, never an email address or a name.
import { createHmac, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const part = (data) => Buffer.from(data).toString("base64url");

export function widgetToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  if (process.env.UCP_SECRET_ID) header.kid = process.env.UCP_SECRET_ID; // which secret signed it, while two are in use
  const claims = {
    iss: process.env.UCP_ISSUER,
    aud: process.env.UCP_WIDGET_ID,
    sub: userId,
    iat: now,
    exp: now + 300, // five minutes; the chat asks again when it needs a new one
    jti: randomBytes(16).toString("base64url"), // used once only
  };
  const signed = `${part(JSON.stringify(header))}.${part(JSON.stringify(claims))}`;
  const signature = createHmac("sha256", process.env.UCP_WIDGET_SECRET).update(signed).digest("base64url");
  return `${signed}.${signature}`;
}

// Run directly, it prints a token; imported, it only exports widgetToken.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) console.log(widgetToken(process.argv[2]));
