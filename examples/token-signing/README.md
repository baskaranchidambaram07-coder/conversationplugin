# Signing in your users

If your site has signed-in users and you want the assistant to know them (so each person gets their own history
back), your backend signs a short token for the user, and your page hands it to the widget.

## 1. Add one endpoint to your backend

Copy the snippet for your language. Each one is about 30 lines and needs nothing beyond the language's own library:
[Python](python/sign.py), [Node](node/sign.mjs), [Java](java/Sign.java), [.NET](dotnet/Program.cs),
[PHP](php/sign.php), [Go](go/sign.go).

Expose it as an endpoint that only a signed-in user can call, for example `GET /widget-token`, returning the token
as text. It reads three settings from your environment:

| Setting | Value |
|---|---|
| `UCP_WIDGET_SECRET` | The widget's shared secret, from the console. Keep it on your server only. |
| `UCP_ISSUER` | Your issuer name, exactly as set on the widget. |
| `UCP_WIDGET_ID` | The widget ID. |
| `UCP_SECRET_ID` | Optional: the secret's ID, while you replace an old secret with a new one. |

The user ID you pass must be your own stable ID for the user. Never use an email address or a name: those change, and
they would be personal data in a place that does not need it.

## 2. Hand the token to the widget

```html
<script>
  window.UCP = window.UCP || function () { (UCP.q = UCP.q || []).push(arguments) };
  UCP("mount", {
    widgetId: "w_your_widget",
    getToken: () => fetch("/widget-token", { credentials: "same-origin" }).then((reply) => reply.text()),
  });
</script>
<script async src="https://your-assistant-address/loader.js"></script>
```

The widget asks for a token when the chat starts, and again whenever its session needs renewing (every 15 minutes
while the chat is in use). When the user signs out of your site, call `UCP("unmount")` to remove the chat and its
session.

## What the token holds

HS256, signed with the widget's secret:

| Claim | Value |
|---|---|
| `iss` | your issuer name |
| `aud` | the widget ID |
| `sub` | your stable ID for the user |
| `iat`, `exp` | when it was made, and at most 10 minutes later (the snippets use 5) |
| `jti` | random; each token works once only |

The assistant refuses a token that is expired, used before, made for another widget, or signed with anything but the
widget's secret. It never sends your user ID to the browser.

## If your users sign in with an identity provider

If your site already uses Entra ID, Okta, Keycloak or another OpenID Connect provider, you need no endpoint at all:
register the provider's issuer and your application's client ID on the widget, and have `getToken` return the user's ID
token from that provider.

## Checking the snippets

`cd backend && uv run python ../examples/token-signing/check.py` runs each snippet your machine can run with the
settings in `test-settings.json`, and checks every token exactly as the assistant does. The pipeline runs all six.
