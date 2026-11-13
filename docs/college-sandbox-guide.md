# Adding the assistant to the College's sandbox

This guide is for the College's web team. It covers two kinds of page. A public page is one anyone can visit. A
portal page is one only signed-in residents see, and there the assistant knows who each resident is, so their
earlier chats come back. You copy our samples into your sandbox, put in the values we send you, and send us your
sandbox's addresses.

The samples are in [examples/college](../examples/college). Each one is a whole page you can open as it is.

## Try it before you change anything

We host copies of both samples at a test address of our own, which we send you with your widget ID:

- `public.html`: the assistant as any visitor sees it;
- `portal.html`: sign in under any name you choose, ask something, sign out, and sign in under the same name
  again to find your chat. Anyone can use any name there, so please do not type anything private.

The assistant answers only while our test environment is awake. While it sleeps, the pages open but the chat button
does not appear. Tell us when you plan to test and we will have it awake.

## What we send you, and what we need from you

| We send you | It looks like | It goes |
|---|---|---|
| The assistant's address | `https://` and a host name | wherever a sample says `{{GATEWAY}}` |
| Your widget ID | `w_` and 22 more characters | wherever a sample says `{{WIDGET}}` |
| Your shared secret, separately | a short ID, a colon, then 43 characters | your portal's backend only, never a page: the part after the colon is the secret, the part before it the secret's ID |
| Your issuer name | `college-sandbox` | your portal's backend, beside the secret |

From you, we need the address of each sandbox site that will show the assistant, written as `https://` and the host
name, with the port if it is not 443. The assistant appears only on the sites we list for your widget. Browsers are
told to refuse it anywhere else.

## 1. A public page

Add one script tag, anywhere in the page:

```html
<script async src="{{GATEWAY}}/loader.js" data-widget-id="{{WIDGET}}"></script>
```

That is all. The chat button appears in a bottom corner of the page, and the chat opens in its own frame, so it does not
touch your page's styles or scripts.

If your pages set a content security policy, add the assistant's address to three directives, and to nothing else:
`script-src`, `frame-src` and `connect-src`. The samples carry such a policy, so you can see it in place. The
assistant needs no inline scripts or styles, and works with Trusted Types enforced.

## 2. A portal page

A signed-in resident needs a short token from your portal, so that the assistant knows who they are.

**On your portal's backend**, add an endpoint that only a signed-in resident can call, at `/widget-token` in the
sample. It returns a token, as text, for the resident who is signed in. The code is about 30 lines, in
[Python, Node, Java, .NET, PHP or Go](../examples/token-signing/README.md), and needs nothing beyond the language's
own library. It reads your shared secret and its ID, your issuer name and your widget ID. The resident's ID
you pass in must be your portal's stable ID for them. Never pass an email address or a name.

**On the page**, add [portal.js](../examples/college/portal.js) and the script tag. Put `portal.js` first:

```html
<script src="portal.js"></script>
<script async src="{{GATEWAY}}/loader.js"></script>
```

`portal.js` asks your endpoint for a token when the chat starts, and again every 15 minutes while it is in use:

```js
UCP("mount", {
  widgetId: "{{WIDGET}}",
  getToken: () =>
    fetch("/widget-token", { credentials: "same-origin" }).then((reply) =>
      reply.ok ? reply.text() : Promise.reject(new Error(`no token: ${reply.status}`)),
    ),
});
```

When a resident signs out and your portal stays on the same page, call `UCP("unmount")`. It removes the chat and
its session. If signing out loads a new page, there is nothing to do.

Your widget accepts both kinds of visitor. If your endpoint refuses someone, for example because their portal
session has ended, the assistant still answers them, as it would any public visitor, but without their earlier
chats.

## 3. Check that it works

Add `data-debug` to the loader's script tag while you test. The browser's console then shows a line for each step,
each starting `UCP:`:

| Line | Meaning |
|---|---|
| `✓ configuration loaded` | The address and widget ID are right. |
| `✓ chat connected` | The chat opened on this site. |
| `✓ token supplied` | Your endpoint gave a token. |
| `✗ configuration not loaded from …` | Check the address and the widget ID, or our test environment is asleep. |
| `✗ chat did not connect within 10 s …` | This site is not yet on your widget's list (send us its address), or your content policy is missing the assistant's address in `frame-src`. |
| `✗ getToken failed (no token: 401)` | Your endpoint refused: is the resident signed in, and does the request carry their portal cookie? |

Take `data-debug` out again before the pages go live.

## If something goes wrong

Send us the time, the page's address, and the `UCP:` lines from the console. If the chat showed an error, it also
shows a reference starting `r_`; send that too. It lets us find the request without you sending anything personal.
