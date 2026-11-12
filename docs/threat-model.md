# Threat Model

Status: first version, 12 November 2026. This is the output of plan task M0-T7. Module M12 maintains it (M12-T1), maps it to OWASP ASVS level 2, and keeps it in the form Secure by Design asks for (`government-readiness.md` section 2.4).

Method: STRIDE over the data flow below. Each threat has a rating, the controls that answer it, the module that builds them, and the test that proves them. The rating is likelihood and impact taken together: **High** means a likely attack with serious harm, or any route to PF credentials, transcripts or another user's data; **Medium** means real but limited or harder to reach; **Low** means unlikely and contained.

## 1. What we protect

| Asset | Why it matters |
|---|---|
| PF credentials and PF tokens | Full use of the customer's agent, and its cost, by anyone who holds them |
| PF identifiers: address, tenant, workspace, agent and conversation IDs | R13: none may reach the browser, including the network tab and the console |
| Transcripts | Users type personal and sometimes sensitive information. Every transcript is treated as sensitive. |
| Session tokens, widget shared secrets, our signing keys | Whoever holds them can act as a user or mint users |
| Widget configuration and the admin accounts that change it | Control over what every visitor sees and which agent answers them |
| PF capacity and cost | Every message costs money, including those sent by a script |
| The customer's page | Our loader runs on it and must never break it or open a hole in it |
| Availability of the assistant | The customer's users rely on it |

## 2. Who might attack

- An anonymous visitor, or a script posing as one, calling our public API directly.
- A logged-in user trying to reach another user's or another tenant's data.
- Another website that frames or copies a customer's widget.
- Content that steers the agent: a user message, or a document the agent reads, that makes the answer carry a script or a link that leaks data.
- A compromised or careless host page: its scripts share the page with our loader.
- A tenant administrator reaching beyond their own tenant.
- A compromised dependency, build step or static-file host.
- Our own mistakes: a PF field forwarded by accident, a secret written to a log, an identifier committed to this public repository.

## 3. Data flow and trust boundaries

```
 Visitor's browser
 ┌──────────────────────────────────────────────────────────────┐
 │ Host page (customer's site; we do not trust it)             │
 │   loader.js (our code, running on their page)               │
 │        │  postMessage, origin pinned both ways        [B1]  │
 │        ▼                                                    │
 │ Chat iframe (our origin; framing allowed per widget)  [B2]  │
 └────────┼─────────────────────────────────────────────────────┘
          │ HTTPS, short-lived session token                [B3]
          ▼
     Gateway ── HTTPS, service credentials ──▶ PF          [B4]
          │
          ▼
     PostgreSQL (tenant and user on every query)            [B5]

 Host backend or identity provider ── signed identity token ──▶ loader ──▶ iframe ──▶ gateway   [B6]
 Admin's browser ── console ── HTTPS, company sign-in ──▶ control plane ──▶ PostgreSQL, secret store   [B7]
 Content delivery network ── loader.js, chat files ──▶ visitor's browser   [B8]
```

## 4. Threats

| # | Threat | STRIDE | Where | Rating | Controls | Module | Proved by | Status |
|---|---|---|---|---|---|---|---|---|
| T1 | A PF identifier, token, cost figure or raw error reaches the browser | Information disclosure | B3 | High | Every browser payload is built from an allow-list (D15). The message format refuses unknown fields, so the gateway cannot forward a PF field by accident. PF errors become our own error codes and wording. | M0, M4, M6 | Example files that carry PF fields fail validation (`protocol/examples`); the browser leak test records traffic, console, storage and built files and finds zero matches (M12-T11) | Partly in place: the format refuses unknown fields; the gateway builds every event and reply through it, and the PF connector passes on only answer text and usage (tests check the streamed bytes hold no PF ID). The browser leak test (M12-T11) is planned |
| T2 | PF credentials leak through configuration, logs, images or error text | Information disclosure | B4 | High | Credentials only in the secret store, read at start; redaction in logs; nothing secret in the image | M6, M12-T5, M13-T1 | A planted fake secret appears in no log, trace or error (M12); image scan | Planned |
| T3 | Another site frames a customer's widget to borrow its assistant or to trick users | Spoofing | B2 | Medium | `frame-ancestors` built per widget from its allowed domains. The Origin header cannot do this job (plan section 3, finding 3). | M4-T3, M12-T2 | The widget refuses to appear on a site not on its list; look-alike and sub-domain tricks are refused (M8) | In place: the chat page's `frame-ancestors` comes from the widget's allowed sites, which are checked so nothing can be slipped into the policy (`backend/tests/test_public.py`); a browser journey shows the chat refused on a site not on the list (`e2e/gateway/journey.spec.ts`) |
| T4 | A script drives an anonymous widget to run up PF cost or crowd out real users | Denial of service | B3, B4 | High | Limits per IP address, session, widget and tenant; daily quotas; message size cap; concurrent stream cap; web application firewall rate rules (D11) | M4-T2, M12-T3, M12-T4 | Limits and quotas checked at their boundaries and under load (M4, M12) | Partly in place: limits per address and per session, and a cap on a tenant's running turns, in memory on each instance (`ucp/sessions.py`, `ucp/turns.py`). The firewall rules and daily quotas are planned |
| T5 | A user opens another user's or another tenant's conversation by guessing or reusing its ID | Elevation of privilege | B3, B5 | High | Tenant and user come from the session, never from the request; every query is scoped by both; row-level security as a second barrier; another user's ID answers "not found" | M4, M5-T5, M7-T4 | The cross-tenant suite on every build (M12); "user A's history is invisible to user B" end to end (M2) | Partly in place: tenant, widget and user come from the session, every query is scoped by them, and another visitor's IDs answer "not found" on every route (`backend/tests/test_turns.py`). Row-level security is planned (M7-T4) |
| T6 | A forged, altered, replayed or misdirected identity token signs someone in as another user | Spoofing | B6 | High | Signature checked with a pinned algorithm; issuer, audience, expiry, not-before, maximum lifetime and one-time use checked; a token for one widget is refused on another | M5-T3, M5-T4 | The token test matrix: expired, wrong audience, bad signature, unsigned, algorithm substitution, replay, unknown key (M5) | Planned |
| T7 | A script in the iframe steals the session token | Information disclosure | B2, B3 | High | Token kept in memory only, never in storage, a URL or the page; strict content policy; no raw HTML rendered | M2-T9, M12-T2 | The token never appears in a URL, the DOM or storage (M1); zero content-policy violations (M3, M12) | Partly in place: the chat keeps the session token in memory only (`web/widget/src/chat/api.ts`), and the gateway serves the chat page with the strict content policy (`ucp/gateway/public.py`) |
| T8 | An agent answer carries a script, a scripted diagram or an image link that sends data out | Tampering, information disclosure | B2 | High | Markdown with raw HTML off; allowed link protocols; images only from allowed hosts; Mermaid in strict mode with sanitised output; charts from data only, never code; unknown block types shown as plain text | M3-T1 to M3-T8 | The injection corpus executes nothing and loads nothing (M3, M12) | In place for Markdown and code: raw HTML is skipped, links pass `safeHref`, no image is ever fetched; the corpus (`web/widget/src/render/gallery/injection.json`) runs, loads and styles nothing in the unit tests and on every engine under the content policy. Diagrams and charts are not built, so their fences show as code |
| T9 | A host-page script forges bridge messages or listens in on them | Spoofing, tampering | B1 | Medium | Origins pinned in both directions; versioned messages; unknown messages ignored; the token passes only through the bridge. The host can always see its own user's token, because it issued it. | M1-T5, M1-T7 | Foreign-origin and unknown messages ignored; the token is absent from URL, DOM and storage (M1) | In place: `e2e/tests/bridge.spec.ts` and the loader unit tests |
| T10 | A tampered `loader.js` is served to customers' visitors | Tampering | B8 | Medium | Static files reachable only through the content delivery network; versioned files never change; integrity hash for customers who pin; signed releases | M1-T11, M14-T6, M12-T6 | The integrity hash matches the release; storage is not publicly reachable (M14) | Planned |
| T11 | A tenant administrator reads or changes another tenant's widgets or credentials | Elevation of privilege | B7 | High | Company sign-in; roles; every action scoped to a tenant; secrets are write-only; the admin API is not reachable from the public widget domain | M8-T4, M8-T8 | The role-by-operation-by-tenant matrix (M8) | Planned |
| T12 | A configuration change cannot be traced to a person | Repudiation | B7 | Medium | Append-only audit log of who changed what and when, readable by the tenant's own administrators | M8-T9, M12-T8 | An audit entry for every change; the log cannot be edited (M8) | Planned |
| T13 | Transcripts leak through logs, telemetry, backups or a stolen disk | Information disclosure | B5 | High | Message content kept out of logs and telemetry by default; encryption at rest and in transit; a database role that cannot change the schema | M7-T7, M13-T1, M13-T3 | Message content is absent from logs (M13); encryption verified (M7) | Planned |
| T14 | Slow readers, many open streams or a slow PF exhaust the gateway | Denial of service | B3, B4 | Medium | Time limits; heartbeats; a circuit breaker per PF connection; a cap on concurrent turns per tenant; retries only before the first word | M4-T9 | Soak and slow-reader tests; injected PF delay (M4) | Partly in place: 60 s to the first word and 5 minutes in all, a heartbeat every 15 s, a circuit breaker per PF connection and a cap on running turns per tenant (`ucp/turns.py`). Soak and slow-reader tests are planned |
| T15 | The public configuration endpoint reveals private settings | Information disclosure | B3 | Medium | The public configuration is a closed allow-list of display settings | M0, M4-T3 | Example files carrying `workspace_id` or `allowed_domains` fail validation | In place: the format's `WidgetConfig` example files, and the gateway sends only that public part (`backend/tests/test_public.py`) |
| T16 | A compromised dependency or build step ships malicious code | Tampering | B8 | Medium | Lock files and pinned versions; dependency, code, secret and container scanning; a bill of materials per release; signed images | M12-T6 | Scans on every pull request, blocking on serious findings (M12) | Partly in place: lock files and secret scanning |
| T17 | A credential or PF identifier is committed to this public repository | Information disclosure | Repository | High | `.gitignore` excludes `.env`, `.tools/` and the raw PF captures; a Claude Code hook runs the publish scan before every push made from an agent session, and people run it by hand (`CLAUDE.md`); gitleaks runs over the whole history in the pipeline, whoever pushed; the fake PF's recordings hold only stand-in IDs | M0 | `scripts/scan-tracked-files.py`; the gitleaks job; a test that the recordings hold no real identifier (`backend/tests/test_fakepf.py`) | In place |
| T18 | A forged request changes configuration through a signed-in administrator's browser | Spoofing | B7 | Medium | Request-forgery protection on the admin API; the console refuses all framing | M8, M12-T2 | Middleware tests (M8); the console refuses framing (M12) | Planned |
| T19 | Personal data from UK users is processed outside the UK | Information disclosure | B4 | Medium | UK customers are served only by PF production in London; PF staging takes test data only; one deployment per region with no data crossing | M14-T4 | Process control, not a test. Open point below. | Agreed |
| T20 | Very large or deeply nested content hangs the browser | Denial of service | B2 | Low | Size limits per renderer; work bounded in time and memory | M3 | Large-content performance and security tests (M3) | In place for Markdown: past 20,000 characters, 2,000 emphasis marks or 32 containers on one line an answer is plain text, measured in `web/widget/src/render/gallery.test.tsx` |

The fake PF's control call, `POST /_fake/expire-tokens`, is not a threat in production: the fake lives in `backend/fakepf/`, outside the package the container image copies.

## 5. Accepted or outside our control

| Point | Why it stays | Who holds it |
|---|---|---|
| A user persuades the agent to answer outside its purpose, or to repeat its instructions | The agent and its instructions live in PF. We give the agent no tools, secrets or user data beyond the conversation itself, and the widget shows a permanent AI notice. | The PF agent's owner |
| Pressing stop does not stop PF's work or cost | PF has no cancel call. The answer is stored and marked as stopped, so our transcript matches what the agent remembers. | PF team |
| Erasure cannot reach PF's copy of a conversation | PF has no delete call, and conversations are not deleted for now by decision | Your team, with the purge policy |
| An anonymous user's history may vanish early | Browsers partition and may clear storage inside third-party iframes | Accepted by design (plan section 3, finding 5) |

## 6. Open points

1. Where the language model behind PF production runs, and which company serves it (`government-readiness.md` section 5).
2. How PF's refresh token is meant to be used, and whether a stolen refresh token can be revoked (capability sheet section 10).
3. PF's production rate limit and whether it is counted per API key. It sets the floor under T4.
4. The browser leak test (M12-T11) is the main proof for R13 and does not exist yet. Until it does, R13 rests on the closed message format and on review.
