# Universal Conversation Platform — Requirements Exploration and Module Breakdown

Status: draft for discussion, 12 November 2026. Updated the same day with your answers and the PF integration snippet; section 12 lists what is now settled. No code has been written.

Companion document: `government-readiness.md` (UK first).

Sources: `universal_conversation_platform_internal_discussion.docx` (v0.1), `Universal Conversational Embed SDK Architecture.png`, the product brief given in chat, and the public Purple Fabric documentation.

"UCP" below means the Universal Conversation Platform. "PF" means Purple Fabric.

## Contents

1. What we are building
2. Requirements and what each one implies
3. Findings from the source material
4. Recommended solution shape
5. The 60-minute integration budget
6. Module map
7. Testing approach shared by all modules
8. Module breakdown (M0 to M15)
9. System-level test suites
10. Build order
11. Path to Azure and GCP
12. Decisions: settled and still open
13. Repository and branching
14. Base version for 22 November 2026

---

## 1. What we are building

A chat assistant that any website can add with one script tag, powered by a Purple Fabric agent. The customer's page loads a very small script. The script shows a launcher button and, when the user opens it, loads our hosted chat interface inside an iframe. The chat interface talks to our server-side gateway, which holds the PF credentials, calls PF, streams the answer back, and stores conversation history. An administrator sets up branding, the PF agent, allowed domains and features in a console, with no code.

The customer never handles PF tokens, never builds a chat UI and never runs our backend. That is what makes a one-hour integration possible.

## 2. Requirements and what each one implies

| # | Requirement (from the brief and the document) | What it implies for the design |
|---|---|---|
| R1 | Any website integrates in at most 60 minutes | We host everything. The customer adds a script tag, and for logged-in portals one small backend endpoint. A console and copy-paste snippets replace engineering work. See section 5. |
| R2 | Works with any host technology | The piece on the host page is plain JavaScript with no framework. The chat UI lives in an iframe, so host CSS and scripts cannot break it and it cannot break them. |
| R3 | Lightweight | The host page pays for a loader of about 6 KB plus a 1 KB config file. The chat UI loads only when the user opens it. Heavy renderers (charts, diagrams) load only when a message needs them. |
| R4 | Every screen: phone, tablet, foldable, laptop | Fluid layout from 280 px wide upward, based on the iframe's own width. Full-screen on phones. Tested on real devices, including a foldable in both states. |
| R5 | Enterprise and government grade | WCAG 2.2 AA accessibility, tenant isolation, audit trail, data residency by region, no third-party trackers, strict browser security policy, penetration test before general availability. |
| R6 | Python and React | FastAPI backend. React for the chat UI and the admin console. The loader is plain TypeScript, because shipping React onto every host page would break R3. |
| R7 | AWS first, Azure and GCP later | The backend is one container plus PostgreSQL. Both run unchanged on all three clouds. Only secrets and file storage need a per-cloud adapter. See section 11. |
| R8 | Powered by Purple Fabric | A PF connector behind a small interface. A fake PF server lets every other module be built and tested before the real PF details are confirmed. |
| R9 | Rich answers: Markdown, tables, charts, diagrams, media, code, files | A versioned content format and a registry of safe renderers. Unknown content falls back to plain text. |
| R10 | Anonymous and logged-in users, with history | Short-lived session tokens issued by the gateway. Logged-in identity is proven by a token signed by the host's backend or its identity provider. History is scoped to tenant and user on every query. |
| R11 | Attachments and voice | Optional modules switched on by configuration. Planned for the second release. |
| R12 | Detailed testing per module | Every module below lists its tests by category: UI, backend, middleware, integration, end-to-end, deployment, and other (security, performance, accessibility, compatibility). |
| R13 | Nothing about the PF agent or connection is visible in the browser, including the network tab and the console | Every payload sent to the browser is built from an explicit allow-list. PF addresses, the workspace and agent IDs, PF conversation IDs, tokens and PF error text stay on the server. An automated leak test checks this on every build. See D15 and M12-T11. |

## 3. Findings from the source material

These are the points where the diagram, the document and the brief disagree or leave a gap. Each one affects the breakdown.

1. **The diagram places secrets in the browser; the document does not.** The diagram shows "SDK Core Services" (PF connector, storage adapter) inside the frontend component and a `data-config` attribute carrying PF login, API key and database credentials. Anything in the browser is readable by anyone. The document's model is the correct one: the browser holds only a public widget ID, and the PF connector, storage and policy run in our server-side gateway. This breakdown follows the document. A consequence: a backend cannot be avoided, so "minimal infrastructure for the customer" is achieved by us hosting it. You have since set a stricter rule (R13): identifiers stay hidden too, not only secrets. The document's own example of "non-secret" configuration puts the workspace ID and agent ID in the browser payload. That example is not followed.

2. **The public PF documentation does not describe the conversation API.** I checked the public PF help sites. They confirm:
   - Authentication is `GET /accesstoken/<tenant>` with `apikey`, `username` and `password` headers. It returns `access_token`, `expires_in`, `refresh_token` and `refresh_expires_in`.
   - Agents are created, updated and listed through a GraphQL endpoint at `/magicplatform/v1/assets`.
   - Automation and extraction agents are invoked asynchronously: the call returns a `trace_id` and the result is fetched by polling.

   They do not document how to send a message to a conversation agent. The integration snippet you supplied fills that gap: it shows the calls to create a conversation, send a message with a streamed reply, and fetch the finished answer. M6 lists what is now known and what a live capture against staging still has to confirm, mainly the format of the stream. History, attachments and voice for conversation agents are still unknown. Everything except the PF connector proceeds against a fake PF in the meantime.

3. **Allowed-domain checks cannot use the request's Origin header.** API calls come from our own iframe, so their Origin is always our domain, never the customer's. The correct enforcement is a `frame-ancestors` browser policy on the iframe document, set per widget from its allowed-domain list. The browser then refuses to display the widget on any other site. This stops other websites from embedding a customer's widget. It does not stop a script from calling our API directly, which is why finding 4 matters.

4. **Anonymous widgets expose PF cost to abuse.** A public widget on a public site can be driven by a script, and every message costs PF capacity. The document mentions rate limits; this needs to be a first-class control: limits per IP address, per session, per widget and per tenant, plus a daily quota, from the first release.

5. **Browsers now isolate storage inside third-party iframes.** Cookies and local storage inside our iframe are partitioned per host site and may be cleared early in Safari. Sessions therefore cannot rely on cookies. The session token lives in memory inside the iframe. Anonymous users keep their conversation across page loads only on a best-effort basis. Logged-in users always get it back, because the host supplies their identity again.

6. **Requirements missing from the document that government customers will ask for.**
   - A stated accessibility level. Proposed: WCAG 2.2 AA. UK public-sector rules require it; India's GIGW 3.0 requires WCAG 2.1 AA, which 2.2 AA covers.
   - Languages and right-to-left layout. UMANG serves many Indian languages. Proposed: build the UI with a string catalogue and direction-neutral CSS from day one, ship English first.
   - Data residency. Proposed: one complete deployment per region (for example Mumbai and London), with no data crossing between them.
   - A browser and device support list, performance budgets, availability targets and a disaster-recovery target. Proposals are in M0.
   - A privacy notice and consent slot in the widget, plus retention, export and deletion for personal data.
   - Loader update policy. Regulated customers may need a pinned version under change control; others want automatic updates. Proposed: offer both URLs.
   - Native mobile apps. UMANG is mainly a mobile app. Proposed: no native SDK; a native app opens our full-page chat URL in a WebView. We test that path.

7. **SAML needs no code.** A SAML assertion does not travel well through a browser widget. A host that uses SAML already has its own backend session, so it signs a short-lived token for the widget like any other logged-in host. This is documentation, not a module.

## 4. Recommended solution shape

Each decision takes the smallest design that fully meets the requirements. Alternatives are noted where they were close.

| # | Decision | Reason |
|---|---|---|
| D1 | Small plain-TypeScript loader on the host page; React chat UI in a hosted iframe. The loader draws the launcher button and creates the iframe on first open. | Isolation from host CSS and scripts, one place to update, and the host's browser security policy needs only our one origin, in three directives. A Web Component inside the host page was the alternative; it is deferred because host styles and scripts can interfere and the host page could read the session token. |
| D2 | Sending a message returns the streamed reply on the same HTTP response (server-sent events over `fetch`). A plain JSON reply is available as a fallback. | The gateway instance that calls PF is the one streaming to the browser, so no shared message bus is needed. The fallback covers corporate proxies that buffer streams. WebSockets are not needed for text chat. |
| D3 | One Python codebase (FastAPI), one container image, started in one of two roles: `gateway` (public runtime) or `admin` (control plane). | The document asks for control plane and runtime to be separate. Separate packages and separate network exposure give that without two codebases. |
| D4 | Interfaces only where something will really be swapped: agent connector, conversation repository, secret store, object store. | These are the four points that differ by agent runtime, database or cloud. Each also needs a fake for testing, so the interface pays for itself immediately. |
| D5 | PostgreSQL through SQLAlchemy, with Alembic migrations. | PostgreSQL is a managed service on AWS, Azure and GCP. SQLAlchemy also reaches MySQL, SQL Server and Oracle, so "other relational databases" becomes certification work per database instead of a new adapter each time. DynamoDB is a separate adapter in the second release. |
| D6 | Session tokens are short-lived signed tokens issued by the gateway, held in memory in the iframe. No cookies, no server-side session store. | Required by finding 5, and it keeps the gateway stateless. |
| D7 | One identity check with two key sources: a shared secret per widget (the host backend signs), or the public keys of the host's identity provider (the host passes the token it already has). | The second path means a portal using Entra ID, Cognito, Okta or Keycloak needs no backend change at all. |
| D8 | The content format is defined once as Python models. JSON Schema and TypeScript types are generated from it. Both sides test against the same example files. | Frontend and backend cannot drift, and the two teams can work in parallel from day one. |
| D9 | Rich content arrives either as typed blocks or as fenced code blocks inside Markdown (for example a block tagged `chart` or `mermaid`). Both go through the same renderer registry. | An agent that only returns text can still produce charts and diagrams by following a prompt convention. No change to PF is needed. To be validated against what PF agents actually return. |
| D10 | We keep our own copy of each transcript in PostgreSQL and store the PF conversation ID alongside it. A user either starts a new conversation or reopens an earlier one. Nothing is hidden or deleted automatically for now; the purge policy is with your team. Agreed. | PF sees every conversation as belonging to one service account, so only our copy can tell users apart. We also need retention and deletion under our control. |
| D11 | No Redis in the first release. Rate limits use the AWS web application firewall at the edge, an in-process limiter, and daily quotas counted in PostgreSQL. | One less service to run and to port. Upgrade when the gateway runs on many instances or when resuming a broken stream mid-answer becomes a requirement. |
| D12 | A thin admin console is part of the first release. Agreed. | Without it, onboarding needs our engineers, and the 60-minute claim cannot be demonstrated. |
| D13 | Terraform for infrastructure. | The same tool and module layout carries to Azure and GCP, and customer infrastructure teams accept it for self-hosting. AWS CDK in Python is the alternative if the team prefers staying in Python and accepts rewriting for other clouds. |
| D14 | Reuse maintained libraries for rendering: react-markdown with sanitising, Recharts, Mermaid in strict mode, Radix primitives for accessible dialogs and menus. | Writing a Markdown parser, a chart library or accessible focus handling ourselves would be months of work and a security risk. |
| D15 | Everything sent to the browser is built from an allow-list of fields. Nothing from PF is forwarded as received except answer text and approved content blocks. The session token carries only opaque identifiers, because a user can decode it. | Required by R13. An allow-list fails safe: a new PF field stays hidden until someone decides to show it. |
| D16 | We host on AWS, first in the London region. A government customer that requires a particular provider gets a dedicated deployment on AWS, Azure or GCP. Private data centres are out of scope. Agreed. | The first customer is in the UK. Keeping to public clouds keeps the deployment to one container image and managed PostgreSQL. |

### Runtime flow

1. The host page loads `loader.js` with a widget ID. The loader fetches the widget's public configuration and draws the launcher.
2. The user opens the chat. The loader creates the iframe pointing at our embed page. The browser checks `frame-ancestors` and refuses to render if the site is not on the widget's allowed list.
3. The chat UI asks the gateway for a session. For a logged-in host, the loader first calls the host's `getToken` function and passes the result to the iframe; the gateway verifies it.
4. The user sends a message. The gateway stores it, calls PF through the connector, converts PF's output into our event format, streams it to the browser and stores the finished answer.
5. The chat UI renders each content block through the renderer registry as it arrives.

### Proposed repository layout

```
protocol/      content and event models, generated schema and types, example files
backend/       Python: gateway, identity, connectors, history, control plane, cloud adapters
web/loader/    plain TypeScript loader
web/widget/    React chat UI and renderers
web/console/   React admin console
infra/aws/     Terraform
examples/      sample host sites and token-signing snippets
e2e/           Playwright suites
docs/          integration guides and decision records
```

## 5. The 60-minute integration budget

The clock starts when the customer has a published PF conversation agent and its credentials. It stops when a real user message is answered on the customer's own page.

| Step | Public site (anonymous) | Logged-in portal |
|---|---|---|
| Create the widget in the console: PF agent, allowed domains, theme | 10 min | 10 min |
| Paste the script tag | 2 min | 2 min |
| Add our one origin to the site's browser security policy, if it has one | 5 min | 5 min |
| Identity: paste a token-signing snippet into the host backend, or register the identity provider in the console | not needed | 10 to 30 min |
| Verify with the built-in installation check | 3 min | 5 min |
| **Total** | **about 20 min** | **about 30 to 50 min** |

What can still break the hour, and what we do about it:

- **The site's own change-control process.** No technology fixes this. The script-free iframe embed is the lowest-friction option to offer.
- **Strict browser security policy on the host.** One origin serves the loader, the chat page and the API, so the host adds that one origin to `script-src`, `frame-src` and `connect-src` (the loader fetches the widget configuration). Decided at the start of M1.
- **Debugging a failed setup.** The loader has a debug mode that prints a checklist: configuration loaded, site allowed, iframe connected, token accepted, PF reachable.
- **Writing the token endpoint.** Tested snippets in Python, Node, Java, .NET, PHP and Go.
- **Self-hosted deployments.** The hour covers integrating a widget, not installing the platform in a customer's cloud account.

A timed onboarding test with an engineer who has never seen the product is part of every release (M15).

## 6. Module map

| Module | Layer | Stack | Release | Depends on |
|---|---|---|---|---|
| M0 Foundations and contracts | cross-cutting | — | 1 | — |
| M1 Embed loader | browser, host page | TypeScript | 1 | M0 |
| M2 Conversation UI | browser, iframe | React | 1 | M0, M1 |
| M3 Response rendering engine | browser, iframe | React | 1 (Draw.io, Excalidraw, custom blocks later) | M0 |
| M4 Conversation gateway | runtime | Python | 1 | M0 |
| M5 Identity and session | runtime | Python | 1 (single sign-on set-up screens later) | M0 |
| M6 PF connector | runtime | Python | 1 | M0, PF specification |
| M7 History and persistence | runtime | Python, PostgreSQL | 1 (DynamoDB, other databases later) | M0 |
| M8 Control plane API | control plane | Python | 1 | M0, M7 |
| M9 Admin console | control plane | React | 1 thin, 2 full | M8 |
| M10 Attachments | capability | Python, React | 2 | M4, M6, M14 |
| M11 Voice | capability | Python, React | 2 | M4, M6 |
| M12 Security and compliance | cross-cutting | — | 1, continuous | all |
| M13 Observability and analytics | cross-cutting | Python, React | 1, continuous | M4 |
| M14 Cloud platform and deployment | cross-cutting | Terraform | 1 on AWS | M0 |
| M15 Developer experience and onboarding | cross-cutting | docs, samples | 1 | M1, M5, M9 |

How the nine "SDK Core Services" in the diagram map onto modules: Configuration Manager is M8; Purple Fabric Connector is M6; Auth and Identity Handler is M5; Conversation Manager is M4; History and Storage Adapter is M7; Attachments and File Manager is M10; Voice is M11; Security and Policy Enforcement is M12 plus the gateway's request pipeline in M4; Telemetry and Analytics is M13.

Feedback (thumbs up and down) is a small task inside M2 and M4. Human hand-off is third-release backlog and has no module yet.

## 7. Testing approach shared by all modules

### Test categories

Each module lists its tests under the same headings. A heading is omitted where it does not apply to that module.

- **Unit**: pure logic, no network or database.
- **UI**: components and screens in a browser or browser-like environment.
- **Backend**: API endpoints and services, called directly.
- **Middleware**: the layers between caller and business logic. On the server this is the request pipeline (site check, session, tenant, rate limit, logging). In the browser it is the message bridge between loader and iframe.
- **Integration**: the module wired to its real neighbours (database, fake or sandbox PF, other modules).
- **End-to-end**: a full user journey through the deployed stack.
- **Deployment**: what must be true of the built artefact and the running environment.
- **Other**: security, performance, accessibility, compatibility.

### Proposed tooling

| Purpose | Tool |
|---|---|
| Python unit and API tests | pytest, httpx, respx |
| Database and cloud integration | testcontainers with PostgreSQL; LocalStack or moto for AWS services |
| Frontend unit and component tests | Vitest, Testing Library, Mock Service Worker |
| End-to-end and cross-browser | Playwright (Chromium, Firefox, WebKit, device emulation) |
| Real devices | BrowserStack or AWS Device Farm |
| Accessibility | axe-core inside Playwright, plus manual screen-reader passes |
| Visual regression | Playwright screenshots |
| API contract | shared example files; schemathesis against the generated OpenAPI document |
| Load and soak | Locust |
| Security scanning | Semgrep, Bandit, pip-audit, npm audit, gitleaks, Trivy, OWASP ZAP |
| Infrastructure code | terraform validate, tflint, checkov |
| Bundle size limits | size-limit |

### When tests run

- **Every pull request**: unit, UI component, contract, lint, type checks, security scans, bundle-size limits.
- **Every merge**: integration tests with containers, end-to-end on Chromium, deployment to the development environment, smoke test.
- **Nightly**: full browser and device-emulation matrix, live contract test against the PF sandbox, ZAP scan of staging, short load test.
- **Every release**: full regression, real-device pass, manual accessibility pass, timed onboarding test.
- **Quarterly**: restore-from-backup drill, failover drill, key-rotation drill. Penetration test before general availability and yearly after.

---

## 8. Module breakdown

### M0 — Foundations and contracts

**Purpose.** Everything the other modules need in order to start in parallel.

**Tasks**

- M0-T1 PF discovery. Done on 12 November 2026 against staging. The capture script (`spikes/pf_capture.py`) recorded login, conversation creation, streaming, the fetch call, hang-up behaviour and error shapes. Output: `pf-capability-sheet.md` and the recorded samples. Remaining: the questions for the PF team listed under M6.
- M0-T2 Repository, coding standards, and a build pipeline that lints, type-checks, tests and builds every package. Done on 12 November 2026; see `tech-stack.md`.
- M0-T3 Protocol version 1: content blocks, stream events (`message.started`, `content_block.started`, `content_block.delta`, `content_block.completed`, `message.completed`, `message.failed`), the event envelope (schema version, conversation ID, message ID, sequence number, correlation ID), the error format, conversation and message records, and the public widget configuration. Defined as Python models; JSON Schema and TypeScript types generated. Done on 12 November 2026 in `backend/ucp/protocol.py`, with the generated files in `protocol/`. Version 1 has three block types: `text` (what the user typed), `markdown` (every answer, with tables, code and diagram fences inside it, per D9) and a fallback that accepts any type it does not know and shows that block's plain-text stand-in. Table, code, chart, diagram, image, file and sources blocks were left out: PF returns only Markdown, and the shapes of the others are not yet known. Each can be added later as a new block type.
- M0-T4 Example files for every block and event, valid and invalid. These are the shared test data for all modules. Done on 12 November 2026: `protocol/examples/v1/<type>/{valid,invalid}/`, read by both `backend/tests/test_protocol.py` and `protocol/src/examples.test.ts`. Each invalid file was checked to fail for the reason its name gives, in both languages.
- M0-T5 Fake PF server with scripted behaviours: normal stream, slow reply, error mid-stream, expired token, rate limit. Done on 12 November 2026 in `backend/fakepf/`, outside the gateway package so it never ships in the image. It replays two cleaned recordings (a short answer and the long HTTPS answer) with every real identifier replaced. The message text picks the behaviour (`[long]`, `[slow]`, `[error]`); wrong credentials give PF's failed login; a test-only call expires every token. Rate limiting is not faked, because PF's rate-limit response was never observed.
- M0-T6 Local environment: one command starts PostgreSQL, the gateway and the fake PF.
- M0-T7 Written decisions for D1 to D14, a first threat model, the supported browser and device list, and performance budgets. Proposed budgets: loader at most 6 KB compressed; chat UI first load at most 100 KB compressed; gateway adds at most 150 ms to time-to-first-token at the 95th percentile. The threat model and the support list were written on 12 November 2026: `threat-model.md` and `supported-browsers.md`. The decisions are recorded in section 4 of this plan, and the budgets stay as proposed here.

**Tests**

- Unit: every example file validates or fails as labelled; generated schema and types are up to date (build fails on drift); a new protocol version must still accept every version 1 example.
- Integration: the same example files parse identically in Python and TypeScript; fake PF scenarios are deterministic.
- Deployment: the pipeline passes from a clean clone; secret scanning runs on every push.

**Done when** a new engineer can clone, start the local environment and run all tests in under 15 minutes, and the PF capability sheet is agreed.

---

### M1 — Embed loader

**Purpose.** The only code that runs on the customer's page. It must be tiny and must never break the host.

**Tasks**

- M1-T1 Script-tag start-up: read `data-widget-id` and optional attributes; work with `async` and `defer`; loading twice is harmless; calls made before load are queued.
- M1-T2 Fetch the public configuration (cached at the content delivery network).
- M1-T3 Launcher button drawn in a Shadow DOM so host CSS cannot restyle it: position, colour, icon, accessible name, keyboard focus.
- M1-T4 Iframe manager: created on first open; floating, inline (into a target element) and full-page modes; panel on desktop, full-screen on phones using dynamic viewport height and safe-area insets; lock and restore host page scroll on phones; focus moves into the chat on open and back to the launcher on close; Escape closes; reduced-motion respected; iframe has a title and the permissions it needs (microphone, clipboard).
- M1-T5 Message bridge between loader and iframe: versioned messages, origin pinned in both directions, start-up handshake, request and reply matching.
- M1-T6 Public API: `mount`, `unmount`, `open`, `close`, `toggle`, `on`, `off`, and a `getToken` option. Events: ready, open, close, conversation-started, message-complete, error. TypeScript typings.
- M1-T7 Token hand-off: call the host's `getToken` at start and on expiry; pass the token only through the bridge; never store it. The loader stores nothing on the visitor's device.
- M1-T8 Single-page-app support: survives route changes; `unmount` removes every element and listener; safe to import during server-side rendering.
- M1-T9 Script-free embed: a documented `<iframe>` snippet for inline and full-page anonymous use, also used by native apps in a WebView.
- M1-T10 Fail-safe behaviour and debug mode: no error ever reaches the host page; the debug checklist from section 5.
- M1-T11 Build and release: one file, no dependencies; a versioned URL that never changes (with an integrity hash for customers who pin) and a major-version URL that receives updates.

Later: Web Component; React, Angular and Vue wrappers; unread-message badge.

State on 12 November 2026 (pull requests 12 to 15 into `module/m01-embed-loader`):

- Built for the base version: T1, T2, T3, T4 (floating and inline; full-page mode deferred), T5, T7, T10, the `mount`, `unmount`, `open`, `close` and `toggle` part of T6, and the `unmount` part of T8. The loader is under 4 KB compressed.
- Deferred: `on`/`off` events and host typings (rest of T6); route-change tests and import during server rendering (rest of T8); the script-free iframe snippet (T9, needs M2's page); versioned and updating URLs with an integrity hash (T11, with M14); full-page mode; the microphone permission (voice is release 2); two widgets on one page; a host that is itself framed; framework host pages (M15's samples); real devices.
- Visual world: "Warm Consumer App", chosen by you through the impeccable skill. `PRODUCT.md` and `DESIGN.md` at the repository root hold the product truth and the design system; M2 inherits both. One small "Powered by Purple Fabric" note belongs inside the open chat (M2).
- One origin serves the loader, the chat page and the API (`GET /v1/widgets/{id}/config` and `/embed/{id}`). A host's content policy needs that origin in `script-src`, `frame-src` and `connect-src`, and nothing else: the loader uses no inline style or markup, so it works under a strict policy with Trusted Types.
- For M4: the configuration response must allow any origin (`Access-Control-Allow-Origin: *`) and needs no cookies; the chat page lives at `/embed/{id}`.
- For M2: the chat must speak the chat's half of `protocol/src/bridge.ts` (send `ready`; pin the parent's origin from `init`; ask `get-token` when `signedIn`; focus its input on `shown`); post `close` from a close button in its own header (the launcher is covered when the chat is full screen) and on Escape. In Playwright's WebKit on Windows a cross-origin chat's own `focus()` is ignored; check input focus on real Safari.

**Tests**

- Unit: attribute parsing; queue order; double-load; mount options cannot override server policy; message validation; wrong-origin messages ignored; viewport-to-layout rules; `unmount` leaves nothing behind.
- UI: launcher in each corner; open and close; inline and full-page; focus in and out; Escape; reduced motion; right-to-left host page; phone full-screen with on-screen keyboard; rotation; 200% and 400% zoom.
- Middleware (bridge): handshake timeout raises an error event; foreign-origin and unknown messages ignored; the token never appears in a URL, the page DOM or storage; loader and iframe of different versions still connect.
- Integration (host matrix): plain HTML; React single-page app; Next.js with server rendering and route changes; Angular; Vue; installed through a tag manager; a host with a strict security policy containing only our documented entries; a host with hostile global CSS and very high z-index overlays; a host that is itself inside an iframe; two widgets on one page; a page that already defines a global with our name.
- End-to-end: script tag, open, send, streamed reply, on Chromium, Firefox, WebKit and phone emulation.
- Deployment: cache headers (permanent for versioned files, short for the updating URL); integrity hash matches; the updating URL can be rolled back within minutes; size limit enforced in the pipeline.
- Other: host-page performance before and after (no layout shift, no extra requests until open, negligible main-thread time); works with third-party cookies blocked and with storage blocked; adds exactly one global; no security-policy violations reported.

**Done when** all host-matrix pages pass on three browser engines and the loader is within its size limit.

---

### M2 — Conversation UI

**Purpose.** The chat experience inside the iframe.

**Tasks**

- M2-T1 Start-up: read the widget ID, connect to the loader, load configuration, obtain a session, show loading and failure states.
- M2-T2 Theming: configuration becomes CSS variables (colours, radius, font, logo); light and dark; warn or correct when brand colours fail contrast.
- M2-T3 Layout: fluid from 280 px; three layouts chosen by the iframe's own width (compact, regular, wide with history sidebar); foldables; safe areas; on-screen keyboard never covers the input.
- M2-T4 Message input: grows with text; Enter sends and Shift+Enter adds a line; safe with input-method editors; length limit; stop button during a reply; attachment and microphone buttons hidden unless enabled.
- M2-T5 Message list: user and assistant messages; pending, streaming, complete and failed states; retry; copy; welcome text and suggested prompts; feedback buttons.
- M2-T6 Streaming client: read the event stream, update only the block that is changing, cancel on stop, detect a stalled stream, recover a dropped stream by reloading the conversation, switch to the JSON fallback when streams are buffered.
- M2-T7 Scroll manager, implementing the document's five settings: flow direction, initial position, auto-scroll policy, position preservation, scroll-to-latest button. Handles tall blocks, older messages loading above, and resizing.
- M2-T8 History panel: paginated list, open, new chat. Shown only when history is enabled and the user is allowed. Deleting a conversation is deferred by decision.
- M2-T9 Session handling: token in memory; refresh through the loader; expiry in mid-conversation.
- M2-T10 Accessibility: landmarks; completed messages announced to screen readers (not every streamed word); focus management; full keyboard operation; labels; minimum target sizes; reduced motion; high-contrast mode.
- M2-T11 Languages: string catalogue; language from configuration or the host page; right-to-left through direction-neutral CSS; dates and numbers through the browser's `Intl`. English in the first release.
- M2-T12 Error states, each with a plain message and a reference ID: offline, assistant unavailable, too many requests, session expired, site not allowed.
- M2-T13 Privacy notice and consent slot, configurable per widget. A permanent notice that the user is talking to an AI assistant and what it cannot do. A configurable "other ways to get help" link to a person or another channel. Transcript download for the user.
- M2-T14 Performance: load renderers on demand; keep long conversations responsive.

State on 12 November 2026 (pull requests 17 to 20 into `module/m02-conversation-ui`):

- Built for the base version: T1, T2 (light only), T3, T4, T5 (without feedback buttons), T6, the base part of T7 (follow the newest message unless the visitor scrolled up; a jump back), T9, T10, T11 (English), T12, the base part of T13 (the AI notice and the "Powered by Purple Fabric" note), and T14's size limit (first load about 76 KB compressed against 100 KB, checked in the pipeline). Markdown shows as plain text until M3 renders it.
- T8, the history panel, was built with M7 on 13 November 2026; see M7's state.
- T2's dark scheme was built on 14 November 2026. `color_scheme` picks light, dark or the visitor's system. The gateway stamps it on the chat page, so the first paint is in it, and the loader's panel follows it. A near-black brand gives way to cream on the dark ground, and diagrams keep a light sheet (DESIGN.md, Dark scheme). Every accessibility scan runs in both schemes; `e2e/tests/scheme.spec.ts` covers the rest.
- Deferred: the five configurable scroll settings; feedback buttons; the privacy and consent slot, the help link and transcript download; automated visual-regression baselines; real devices.
- The API the chat calls is part of the message format (`SessionRequest`, `Session`, `SendMessage` in `backend/ucp/protocol.py`). Until M4 exists, browser tests run against a fake gateway in `e2e/server.mjs`; the plan's "real gateway, fake PF" integration tests move to M4.
- For M4: `POST /v1/sessions`, `POST /v1/conversations`, `POST /v1/conversations/{id}/messages` (a stream of `StreamEvent` lines with a `: ping` heartbeat at least every 15 s, since the chat treats 20 s of silence as a stalled stream; a repeated `client_message_id` returns the same reply), and `GET /v1/conversations/{id}/messages/{message_id}` (the chat polls it to recover a stalled or dropped stream). Every error is an `ApiError`; the chat shows its own wording, never the gateway's. Serve the built chat at `/embed/{id}` with `frame-ancestors` from the widget's allowed domains; it needs only its own origin for scripts, styles, fonts and calls, plus `https:` images for customer logos.
- For M5: an anonymous session cannot be renewed (the chat offers a new chat instead); a signed-in one is renewed with a fresh host token and the call replayed once.
- The bridge gained `hidden` (loader to chat, on closing), so the chat pauses its animations out of sight.

**Tests**

- Unit: stream state for every event order including duplicates, gaps and failure mid-block; stream parsing when chunks split an event or a multi-byte character; theme mapping and contrast check; scroll decisions as a pure function of position and policy; string lookup and fallback.
- UI: input behaviour (input-method editors, Shift+Enter, limit, disabled while sending); each message state; retry; suggested prompts; history pagination and delete confirmation; each error state; feature switches hide and show controls.
- Middleware (client side): expired session triggers one refresh and one replay; each server status maps to the right error state; stop cancels the request; stalled stream triggers recovery.
- Integration (real gateway, fake PF): full round trip; a dropped stream recovers the finished answer; a published configuration change (theme, features, flow direction) appears without a rebuild.
- End-to-end: scripted conversations in both flow directions; a tall table streams in while the user has scrolled up and the view does not jump; scroll-to-latest appears and works; a restored conversation opens at the configured position; user A's history is invisible to user B.
- Other, visual: key screens across themes, widths (280, 344, 360, 390, 600, 768, 1024, 1440 px) and both text directions.
- Other, accessibility: automated scan of every screen with no serious findings; the whole journey by keyboard only; scripted manual passes with NVDA, VoiceOver (desktop and phone) and TalkBack each release; 200% zoom; reflow at 320 px; high-contrast mode.
- Other, devices: real iPhone Safari, Android Chrome, Samsung Internet, one foldable folded and unfolded, a tablet in split view, and a native-app WebView; rotation during a streamed reply.
- Other, performance: first-load size limit; time to usable on a throttled connection and a low-end Android profile; a 500-message conversation stays responsive; no memory growth over a 30-minute streaming session.
- Deployment: hashed files cached permanently; the embed page carries the per-widget framing policy and a strict content policy; files from the previous release stay available during a rollout; rollback.

**Done when** the end-to-end and accessibility suites pass on the support list and the visual baseline is approved.

---

### M3 — Response rendering engine

**Purpose.** Turn content blocks into safe, consistent, responsive visuals.

**Tasks**

- M3-T1 Renderer registry: block type and version select a renderer loaded on demand; data is validated before rendering; each block is isolated so one failure cannot blank the message; unknown types fall back to safe text with a download option.
- M3-T2 Markdown: headings, lists, links, quotes, tables; raw HTML disabled; links open safely in a new tab with an allowed-protocol list; images only from allowed hosts (this blocks an agent being tricked into leaking data through an image address); tolerant of half-finished Markdown during streaming.
- M3-T3 Fenced-block routing: a code fence tagged with a known type (chart, mermaid) is sent to the registry; a placeholder shows while the fence is still arriving; invalid content falls back to a code block.
- M3-T4 Code: syntax highlighting loaded on demand, copy, horizontal scroll, download.
- M3-T5 Table: horizontal scroll with a fixed header, caption, copy as CSV, "show more" for long tables. Sorting later.
- M3-T6 Chart: bar, line, area, pie and scatter from validated data only, never executable configuration; text summary and "view as table"; follows the theme; download image or CSV; limits on series and points.
- M3-T7 Mermaid diagrams: loaded on demand, strict mode, output sanitised, zoom and full-screen, falls back to code on error.
- M3-T8 Media and files: images with enlarge view; audio and video from allowed sources; file card with name, size, type and download.
- M3-T9 A shared full-screen and zoom viewer for tables, charts and diagrams.

Later: Draw.io and Excalidraw previews (second release, after licensing and embedding checks); customer-specific blocks such as rich cards with a review process (third release).

State on 12 November 2026 (pull requests 22 to 24 into `module/m03-rendering-engine`):

- Built for the base version: T1 (by block type and by fence language; each block behind its own boundary; unknown types as plain text, without a download yet), T2 (stricter on images than planned: none is ever fetched, each becomes a link the visitor can follow; GFM task boxes are drawn as named marks, not controls), T3 (no fence language has its own renderer yet, so every fence is code and no placeholder is needed), T4 without highlighting or download, and T5 without a caption (Markdown tables have none, so each table's scroll region is named from its header row).
- Bounds: an answer over 20,000 characters, with over 2,000 emphasis marks, or opening 32 containers on one line is shown as plain text (`tooHeavy` in `web/widget/src/render/registry.tsx`). Past those the parser takes seconds, or overflows its stack. Just under them, the slowest shapes found, a 1,000-row table and a 50-block answer each draw in under 2 s in the unit tests.
- The example gallery is `web/widget/src/render/gallery/` (formatting, code, tables, and the injection corpus) together with the recorded PF answers. The unit tests draw every example whole and at every streamed prefix that ends beside Markdown syntax; the browser tests ask the fake gateway for each (`[gallery:name]`, `[injection]`) on all four targets, and the accessibility scan covers them.
- Diagrams and charts, built on 13 and 14 November 2026:
  - **Diagrams (T7, in part):** a finished draw.io or Excalidraw block is drawn as SVG, with "Copy for draw.io" and "Show code" (pull request 71). Mermaid is not drawn.
  - **Charts (T6):** a fence tagged `chart` holds plain JSON: `type` (bar, line, area, pie or scatter), `title`, `x`, `y`, `labels`, `data`. The format is at the top of `web/widget/src/render/plot.ts`. It is checked whole, so nothing executable reaches the drawing. A chart still arriving, invalid, or over the limits (8 series, 3 for a scatter, 1 for a pie, 5,000 points) shows as code. A pie folds its smallest slices past seven into "Other".
  - **What a chart offers:** a legend for two or more series. Values are read by pointer or arrow keys, in a tip over the chart and through a live region. Screen readers hear a summary of each series' range, and "Show as table" gives the same numbers as a table that copies as CSV.
  - **Colours:** the categorical palette from the data-visualisation method, in its fixed order, stepped for each scheme. It is validated for colour-blind readers against our light and dark cards; the light step's three sub-3:1 colours are why the table view exists.
  - **Against D14:** drawn as our own SVG (4 KB compressed, loaded only with a chart), not with Recharts. Recharts would have added over 100 KB to the chat and a large dependency tree, as Mermaid would have for diagrams.
  - **PF agent:** an agent must be told the chart format in its instructions. Without that it answers with Markdown tables, which still render.
- Deferred: T9 viewer, chart image download and stacked charts, Mermaid, T8 media and files, highlighting, downloads, screenshot comparison across themes and widths, the layout-jump check while streaming, and comparing an answer reloaded from history with its streamed version (needs M7).
- For M4: serve the embed page with the content policy the test server uses, `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' <the widget's logo origin>; base-uri 'none'; form-action 'none'`, plus `frame-ancestors`. The gallery and the injection corpus cause no violation under it. This replaces the `https:` images noted under M2.

**Tests**

- Unit: validation per block type (valid, invalid, malformed, oversized); registry lookup including unknown type and version; link and image address rules; fence detection across chunk boundaries; chart data preparation.
- UI: every example file renders; screenshot comparison per block across themes and widths; each example rendered at every streamed prefix without error or layout jump; a failing block leaves its neighbours intact.
- Integration: a mixed streamed message (text, table, chart, diagram) renders correctly from the gateway; a message reloaded from history looks identical to its live-streamed version.
- End-to-end: copy and download actions; full-screen viewer on a phone; a wide diagram in a narrow panel.
- Other, security: a corpus of script-injection attempts (script links, scripted SVG, diagram click handlers, embedded HTML, style injection) executes nothing; zero content-policy violations; image-based data leak blocked; very large or deeply nested content is bounded in time and memory.
- Other, accessibility: tables have headers and captions; charts expose a summary and a data table; diagrams have a text alternative; code blocks scroll by keyboard; chart colours pass contrast and never carry meaning alone.
- Other, performance: chart and diagram code is not downloaded until a message needs it; size limits per renderer; a 1,000-row table, a 5,000-point chart and a 50-block message render within budget.
- Deployment: renderer files cached permanently; a new renderer file works with the previous UI release.

**Done when** the example gallery passes on all engines and the security corpus is clean.

---

### M4 — Conversation gateway

**Purpose.** The public runtime API. It validates every request, runs each conversation turn and streams the result.

**Tasks**

- M4-T1 Service skeleton: application set-up, settings, health and readiness endpoints, generated API document, uniform error format, shutdown that lets open streams finish.
- M4-T2 Request pipeline: correlation ID; cross-origin rule that admits only our iframe domain; session check; tenant context; rate limits and quotas; body-size limits; security headers; access log with sensitive fields removed.
- M4-T3 Public configuration endpoint returning only display settings from an allow-list (no workspace, agent, PF or storage identifiers), cacheable; the embed page with its per-widget `frame-ancestors` policy. Server and framework headers are removed from every response.
- M4-T4 Session endpoint for anonymous and host-token sessions (logic in M5).
- M4-T5 Conversation endpoints: create or resume, list, read a page. Delete is deferred by decision.
- M4-T6 Message endpoint with streamed reply: one turn at a time per conversation; a repeat of the same request returns the same result; heartbeats; time limits; JSON variant.
- M4-T7 Turn handling: store the user message, call the connector, convert events, stream, store the answer as complete, failed or partial, record telemetry. Behaviour is defined for a failure at each step. If the browser disconnects, the gateway finishes reading the PF reply and stores it so the user finds it on return. The same applies when the user presses stop: PF finishes the answer and remembers it, so we store it and mark it as stopped.
- M4-T8 Configuration cache: read the published configuration by widget ID and refresh on a new version. The control plane is never called per message.
- M4-T9 Resilience: time limits; retries only before the first word is streamed; a circuit breaker per PF connection; a cap on concurrent turns per tenant.
- M4-T10 Feedback endpoint.

State on 12 November 2026 (pull requests 26 to 31 into `module/m04-conversation-gateway`):

- Built for the base version:
  - T1: the API description is exported to `protocol/openapi.json` with a drift check, never served.
  - T2: a correlation ID, a 64 KB body limit, security headers and an access log without secrets. API calls are accepted only from our own chat page. Limits per address, per session and per tenant are kept in memory.
  - T3: the public settings, the chat page with its content policy and per-widget `frame-ancestors`, and the loader and chat files, all from one origin.
  - T4 for anonymous visitors.
  - T5 without delete.
  - T6: streamed or as one JSON message; safe to repeat; one turn at a time; `: ping` every 15 s.
  - T7, and T9.
  - T8: widgets seeded from a file with `python -m ucp.widgets seed`, cached 30 s.
- Built here from M6 and M7, as agreed:
  - the agent-connector interface and the core of the PF connector (`ucp/connector.py`, `ucp/pf.py`);
  - the PostgreSQL storage core with Alembic migrations (`ucp/store.py`, `ucp/migrations/`).
- One command runs the whole stack locally: `backend/devstack.py` (gateway, fake PF and seeded widgets). It covers part of M0-T6.
- Deferred:
  - T10 feedback;
  - an explicit stop: an answer the visitor stopped is stored as complete;
  - daily quotas in PostgreSQL;
  - generated-request fuzzing;
  - the automated security scan (M12);
  - deployment tests (M14);
  - the one-hour soak, scale-out, rolling-deployment and failover tests;
  - recovering an answer whose gateway stopped mid-turn: it is marked failed after 6 minutes.
- Latency (`backend/loadtest.py`): with 10 visitors at once the gateway adds 36 ms at the median and 76 ms at the 95th percentile to the first word, within the 150 ms budget.
  - Beyond about 15 visitors, the build machine saturates its four processors. It runs the load generator, the fake PF, PostgreSQL and other work at the same time, so the figure then measures the machine, not the gateway.
  - On the pipeline's own runner, with 25 visitors at once, the gateway adds 20 to 33 ms at the median and 79 to 94 ms at the 95th percentile, over three runs on 12 November 2026. That meets the done condition's latency budget.
  - Correction, 13 November 2026: those three runs were a lucky sample. The pipeline's history shows the same code at 79 to 199 ms with 25 visitors (once 251 ms), because the shared runner carries the gateway, PostgreSQL, the fake PF and the load together. With your agreement, the pipeline now checks 10 visitors on the median of three runs. The budget at 25 or more visitors is to be certified in M14, against the deployed stack, from a separate machine.
  - An earlier version did not always meet it: one run reached 167 ms. A profile showed the gateway's code idle and waiting on the database, so a turn now starts in four statements instead of nine, and the connection pool is larger and steady.
  - A test against a deployed instance from a separate machine belongs with M14.
- For M5: sessions use `ucp.sessions.Keys` (HS256, rotating by `kid`) and `Session(user_id, tenant_id, widget_id, config_version, mode)`. `POST /v1/sessions` refuses a host token with `forbidden` until M5 verifies it. Each widget's `sign_in` is `anonymous`, `signed_in` or `both`.
- For M6: keep the four connector events, and end each `send` with exactly one `Final` or `Failed`. Profiles come from `UCP_AGENT_PROFILES`.
- For M7: the storage interface is `ucp.store.Store`, and every call takes an `Owner`.
- For M8: a widget's published document is `ucp.widgets.WidgetDocument`. Publishing writes a new version row to `widgets`.
- For M14:
  - settings come from the environment: `UCP_DATABASE_URL`, `UCP_SESSION_KEYS`, `UCP_AGENT_PROFILES`, and `UCP_WEB_DIR`, which the image sets;
  - run `python -m ucp.migrate` before each release;
  - build the image from the repository root;
  - health is at `/healthz` and readiness at `/readyz`;
  - the load balancer's idle timeout must exceed the 15 s heartbeat.

**Tests**

- Unit: event conversion; turn handling at each failure point; repeat-request logic; the public configuration contains only fields on an explicit allow-list; error mapping.
- Backend: every endpoint for success, invalid input and authorisation; another user's conversation ID returns "not found"; pagination; a repeated request returns the original result; generated-request fuzzing against the API document.
- Middleware: cross-origin rule and preflight; session missing, expired, altered or issued for another widget; rate-limit and quota boundaries with a retry hint; oversized body; the correlation ID reaches logs and PF calls; security headers present; logs contain no tokens or secrets.
- Integration (PostgreSQL, fake PF): a streamed turn is stored correctly; a PF error mid-stream produces `message.failed` and a stored failed message; a browser disconnect still stores the answer; a second send during an open turn is rejected; an expired PF token is refreshed without the user noticing; the circuit breaker opens and recovers; a newly published configuration is picked up.
- End-to-end: an API-level journey script, in addition to the UI journeys in M2.
- Deployment: container health checks; load-balancer idle timeout longer than the heartbeat interval; rolling deployment while streams are open; settings and secrets injected at start; smoke test after each deployment.
- Other, performance: concurrent streams per instance until degradation; added latency to first word; one-hour soak with no connection or memory leak; slow readers do not exhaust the server; scale-out triggers.
- Other, resilience: stop an instance mid-stream and the browser recovers; database failover; injected PF delay.
- Other, security: every resource ID tried as another user and another tenant; widget IDs reveal only public configuration; ZAP baseline scan.

**Done when** the integration suite passes and the load test meets the latency budget.

---

### M5 — Identity and session

**Purpose.** Decide who the user is and issue the session that every other call relies on.

**Tasks**

- M5-T1 Session tokens: issue and verify short-lived signed tokens carrying tenant, widget, configuration version, user and sign-in mode; signing-key rotation; small clock tolerance.
- M5-T2 Anonymous mode: random user ID; history for the session only unless policy says otherwise; tighter abuse limits.
- M5-T3 Host-token exchange: verify a token signed with the widget's shared secret or with keys published by the host's identity provider; check issuer, audience, expiry, not-before, maximum lifetime and one-time use.
- M5-T4 Identity-provider tokens: discover and cache the provider's public keys, handle key rotation, map the configured claim to the user ID.
- M5-T5 Identity mapping: tenant plus identity provider plus external user ID gives an internal user. Email addresses and display names are never the key.
- M5-T6 Refresh through the loader's `getToken`; a short deny-list to end a session early.
- M5-T7 Token-signing snippets for Python, Node, Java, .NET, PHP and Go, with shared test tokens.

Later: PF-level delegated identity, if PF supports it; console screens for single sign-on set-up.

State on 12 November 2026 (pull requests 33 to 37 into `module/m05-identity-session`, merged into `develop` with pull request 38; 37 fixed an M4 bug, the per-address session limit shared across widgets):

- Built for the base version:
  - T1: signed-in sessions last 15 minutes and are renewed through `getToken`; anonymous sessions last 60 minutes and cannot be renewed. The session token's clock tolerance is now 5 s, since gateway instances share a synced clock.
  - T2: each anonymous session is a new visitor, so their history lasts the session.
  - T3: host tokens signed with the widget's shared secret: a 10-minute maximum lifetime, a one-time `jti` kept in PostgreSQL, and both secrets accepted during a rotation.
  - T4: identity-provider tokens, by OpenID Connect discovery over https. Keys are kept an hour and fetched again at most once a minute for an unknown key. They stay usable for a day while the provider is down; after that, its visitors are refused as unavailable.
  - T5: the `identities` table.
  - T6: renewal through `getToken`.
  - T7: snippets in six languages, with a guide (`examples/token-signing`).
- Proven end to end:
  - the shared-secret path, in browser journeys on three engines. The stand-in portal backend signs with the Node snippet; a session that expires mid-conversation is renewed unseen; signing out removes the chat.
  - the identity-provider path, against a real Keycloak in the pipeline, including a signing-key rotation.
  - every snippet, run in the pipeline and checked by the gateway's own code.
- Deferred:
  - the deny-list to end a session early, which needs M8's admin action;
  - separate, tighter limits for anonymous visitors;
  - the single-sign-on setup screens (M9);
  - PF-level delegated identity;
  - showing history in the chat: the history panel (M2-T8) is not built, so "history is shown to its owner only" is proven through the API, not in the chat;
  - the key-rotation runbook (M14);
  - anonymous history across page loads (best effort, not built).
- For M8: a widget's `identity` settings hold:
  - `provider`;
  - `issuer`;
  - `audience`, optional, defaulting to the widget ID;
  - `secret`, a name in `UCP_HOST_SECRETS`, or none for an identity provider;
  - `user_claim`, defaulting to `sub`.

  Secrets go to the secret store, never into the widget document. A widget for signed-in visitors cannot be published without these settings.
- For M14: `UCP_HOST_SECRETS` (JSON, `{name: "id:secret,…"}`) and `UCP_SIGNED_IN_SECONDS` come from the environment. The gateway must be able to reach customers' identity providers over https.
- For M15: the integration guide for signed-in sites is `examples/token-signing/README.md`.

**Tests**

- Unit: expired; not yet valid; wrong audience; wrong issuer; bad signature; unsigned token; algorithm-substitution attack; missing claims; oversized token; unknown key ID; key rotation; replayed token; clock-tolerance boundaries.
- Backend: session endpoint in each mode; anonymous refused where policy forbids it; logged-in-only widgets refuse anonymous sessions.
- Middleware: the session supplies tenant and user to every handler; no request field can override them.
- Integration: end-to-end against a real identity provider running in a container (Keycloak); provider keys unavailable means cached keys are used and then requests are refused; signing-key rotation without downtime.
- End-to-end: sample logged-in portal shows history to its owner only; token expiry in mid-conversation is invisible to the user; logging out of the host clears the widget session.
- Deployment: signing keys come from the secret store; rotation procedure rehearsed.
- Other, security: a token for one widget is refused on another; attempt limits; no API ever returns a secret; every language snippet runs in the pipeline against the shared test tokens.

**Done when** the token test matrix is green and both identity paths work end to end.

---

### M6 — PF connector

**Purpose.** The only code that knows the PF API.

**PF calls, confirmed by a live capture against staging on 12 November 2026.** Full detail is in `pf-capability-sheet.md`.

| Step | Call | What we know |
|---|---|---|
| Token | `GET /accesstoken/<tenant>` with `apikey`, `username` and `password` headers | Returns an access token valid for 8 hours and a refresh token valid for 45 days. A failed login still returns HTTP 200, with the failure in the body. |
| Every later call | Headers `apikey`, `X-Platform-Workspaceid`, `Authorization: Bearer <token>` | The workspace travels as a header. |
| Create conversation | `POST /magicplatform/v1/genai/conversation/create` with `asset_version_id` and `conversation_name` | Returns `conversation_details.conversation_id`. The agent is addressed by its version ID. |
| Send message | `POST /magicplatform/v1/genai/conversation/addmessage/stream` with `conversation_id` and `query` | Server-sent events with HTTP 201. Order: two notices, `MESSAGE_DETAILS`, `LLM_RESPONSE_STREAM` (start, one event per few characters, end), `FINAL_RESPONSE`, `STREAM_END`. An error arrives as an `ERROR` event inside a 201 stream. |
| Fetch finished answer | `GET /magicplatform/v1/genai/conversation/response/<conversation_id>/<message_id>` | Returns the whole message record. It needs the `message_id` from `MESSAGE_DETAILS`; the ID carried on later events is a different one and returns HTTP 500. |
| Send without a stream | `POST /magicplatform/v1/genai/conversation/addmessage` with the same body | Returns at once with the message marked in progress. The answer is then read with the fetch call. |

What this tells us:

- Every conversation is created by one service account in one workspace, so PF cannot tell our end users apart. Separating users is entirely our job (D10).
- The agent is addressed by a version ID. If republishing the agent in PF changes that ID, the widget configuration needs a new published version each time.
- PF finishes an answer even when the caller hangs up, and the fetch call then returns it. Recovery after a dropped stream therefore works. It also means hanging up cancels nothing: a stopped answer still uses PF capacity and stays in the agent's memory of the conversation.
- A second login does not cancel the first token, so each gateway instance can log in on its own. No shared token store is needed.
- Every stream event carries the agent and conversation IDs, one carries the workspace ID, and the final event carries token counts and cost. This is exactly what R13 keeps out of the browser. The counts and cost feed usage metering (M13).
- A fenced diagram block and a Markdown table came through PF unchanged, which supports D9.
- Staging allows 5,000 calls a minute and reports the remaining allowance in response headers.
- The first word of an answer takes 2 to 5 seconds. Short answers then arrive at once; long answers stream steadily at about 20 small events a second. The chat must show a working state from PF's first notice.
- The conversation name is visible inside PF, so it carries our opaque conversation ID and no personal data.
- We take the calls and field names from the snippet and write the connector fresh. The snippet shares one token across the whole process, assumes the token lifetime, fixes the tenant name in the address and waits for the whole reply before returning. None of that suits a multi-tenant streaming gateway.

Answered by you on 12 November 2026: conversations are not deleted for now; PF has no call to cancel a reply; short answers arrive at once and longer answers stream. The last point was confirmed the same day with a second staging agent that answers at length.

Still to ask the PF team, because a capture cannot answer these:

- How the refresh token is used.
- The production rate limit, and whether it is counted per API key.
- Maximum message size, and how long a conversation can be resumed.
- Whether the agent version ID changes when the agent is republished.
- Passing per-user context to the agent.
- Attachments and voice for conversation agents. The message record has file-reference and generated-file fields, and each conversation gets its own knowledge-base ID, so attachments look supported.

**Tasks**

- M6-T1 The agent-connector interface: create or resume a conversation, send a message and receive a stream of events, cancel, health check.
- M6-T2 PF authentication: obtain a token with the API key and service account, cache it per connection profile, refresh ahead of the expiry PF reports instead of an assumed lifetime, ensure concurrent requests share one refresh.
- M6-T3 Conversation lifecycle: create a PF conversation on the first message, named with our opaque conversation ID; reuse it for later turns. Conversations are not deleted on PF for now, by decision.
- M6-T4 Stream adapter: read the PF stream as it arrives and convert it into our events. If a stream breaks, fetch the finished answer by message ID.
- M6-T5 Response conversion from an allow-list: answer text becomes a Markdown block; approved structured output becomes typed blocks; citations are carried through only after internal addresses are removed or replaced. PF identifiers, model and tool details and raw PF errors are never forwarded.
- M6-T6 Error translation into our error format with a "can retry" flag; time limits; one re-login on an authentication failure; back-off on rate limits.
- M6-T7 A "test connection" operation for the control plane.
- M6-T8 Recorded PF samples as tests, and the fake PF kept in line with them.

Later: file hand-off, voice endpoints, delegated identity.

**Tests**

- Unit: token cache at the expiry boundary; concurrent refresh; refresh failure followed by re-login; request mapping; stream parsing on recorded samples with split chunks, a malformed event and early end; error translation table; credentials removed from logs and error text.
- Integration: recorded PF responses replayed; a nightly run against the PF sandbox to catch API changes; gateway plus connector plus sandbox for a full turn, a resumed conversation after a gateway restart, an agent that runs longer than a minute, PF errors and rate limits, and a token forced to expire mid-stream.
- Deployment: outbound network path to PF from the private network; PF address per environment; secret rotation without restart.
- Other, performance: PF's own latency and concurrency limits measured per tenant; these set the gateway's limits.
- Other, security: credentials read only from the secret store and absent from configuration, logs, traces and errors; certificate checking on; one tenant's profile cannot be used for another; a PF response seeded with extra fields and internal addresses reaches the browser with none of them.

**Done when** the sandbox suite passes and the capability sheet matches observed behaviour.

State on 13 November 2026 (pull requests 39 to 43 into `module/m06-pf-connector`):

- Built with M4 and kept (`ucp/pf.py`):
  - the connector interface;
  - one login shared by concurrent callers, renewed five minutes before the expiry PF states;
  - a PF conversation created on the first message, named with our ID;
  - the stream adapter, and recovery of a broken stream by fetching the answer;
  - error translation with a "can retry" flag, and one quiet login again when PF refuses a token.
- Built here:
  - T2: refused credentials are tried again only after five minutes. Repeated wrong passwords can lock the service account that every widget on it shares.
  - T4: a damaged stream event is skipped, since the final event carries the whole answer. Before, it failed the turn.
  - T5, proved: the fake PF's `[seeded]` reply adds internal addresses, sources, citations, model and tool details to every event. The visitor's stream, the stored messages and the conversation list hold the answer text and none of these, and no raw PF error.
  - T8: the staging suite (`tests/test_pf_staging.py`) checks each claim in the capability sheet that is safe to test. It also compares the fake PF's recorded shapes with what PF sends today.
  - `devstack.py --pf staging`, and a browser journey on staging (`npm run e2e:staging`). The journey searches everything the browser received for PF's address, tenant, workspace, agent, credentials and IDs, and checks no source maps are served. This is the core of M12-T11.
  - Unit tests (`tests/test_pf_wire.py`):
    - request mapping and the token's refresh point;
    - a failed login, then a successful one;
    - events split across network reads;
    - damaged events and early ends;
    - the error table, with no secret in any error detail.
- Proven against PF staging on 13 November 2026:
  - the staging suite, 12 tests;
  - the API journey, 10 steps;
  - the browser leak search: zero matches, and a PF value planted in a gateway header is caught in 12 responses.
- Not built, as agreed:
  - T1 cancel: PF has no cancel call, so stopping an answer stops the display only;
  - sources and citations, left out of the chat until internal addresses can be removed; structured output as typed blocks;
  - backing off until PF's rate-limit reset time (the production limit is a question for the PF team);
  - T7 beyond `check()`, which only logs in; the screen belongs to M8 and M9;
  - deployment tests (M14), PF's latency and concurrency per tenant, delegated identity, file hand-off and voice.
- Not tried live: a wrong password, which could lock the shared service account, and the rate limit. The fake PF and the wire tests cover both.
- Staging runs happen on this machine only; the pipeline has no PF credentials.
  - Each staging-suite run leaves four conversations named `ucp-test-*` in the staging workspace, and each journey leaves one.
  - On this machine, read `.env` with `uv`, never with Node's parser, which reads one PF value differently.
- For M14: run the staging suite and the leak search every night from the AWS development account, with the PF credentials in Secrets Manager and the logs private.
- For M12: the leak search runs on every build against the deployed stack (M12-T11).

---

### M7 — History and persistence

**Purpose.** Store conversations safely and return them only to their owner.

**Tasks**

- M7-T1 Data model: tenant, widget, user identity, conversation (our ID and the PF ID), message (content blocks, status, sequence), feedback, audit; indexes for listing and paging.
- M7-T2 The conversation-repository interface and its PostgreSQL implementation: create, append (safe to repeat), read a page, list, delete, purge expired.
- M7-T3 Migrations, each tested forward and back.
- M7-T4 Tenant enforcement: every query carries tenant and user; PostgreSQL row-level security as a second barrier.
- M7-T5 Retention and deletion: two per-widget settings, how long a user can reopen a conversation and how long the record is kept. Both are off by default, so nothing is hidden or purged until your team sets a purge policy. Scheduled purge once a period is set; user-requested delete; export of a user's data. Each stored message records the agent version and configuration version that produced it.
- M7-T6 Anonymous history: session-scoped and purged.
- M7-T7 Encryption at rest, encrypted connections, a database role that cannot change the schema, bounded connection pool.
- M7-T8 A repository conformance suite that any future storage adapter must pass.

Later: DynamoDB adapter; certification of MySQL, SQL Server and Oracle; customer-managed databases over private connectivity; PF-held history if PF provides it.

**Tests**

- Unit: model validation; paging cursors; repeated append of the same message.
- Backend (conformance suite on real PostgreSQL): create, read, list, delete; ordering; paging through 10,000 messages; concurrent appends; delete removes everything dependent; purge removes only expired data; the wrong user or tenant gets nothing; a conversation older than the reopen window is not listed and cannot be opened by its ID.
- Middleware: with no tenant context set, row-level security returns no rows.
- Integration: history survives a gateway restart; a connection failure or failover gives retries and then a clean error with no duplicate messages; migration on a production-sized copy; backup and restore.
- End-to-end: list, open and delete through the UI; a deleted conversation cannot be fetched through the API.
- Deployment: migrations run as a separate step before the new version starts; rollback plan; database failover test; point-in-time restore test.
- Other, performance: list and read times at one million conversations and fifty million messages of synthetic data; query plans use the indexes; behaviour when the pool is exhausted.
- Other, security: injection attempts; the cross-tenant suite; encryption verified; credential rotation.

**Done when** the conformance and cross-tenant suites pass and restore has been rehearsed.

State on 13 November 2026 (pull requests 45 to 49 into `module/m07-history-persistence`):

- Built with M4 and kept (`ucp/store.py`): conversations and messages in PostgreSQL, every read through its owner; message and conversation pages; Alembic migrations.
- Built here:
  - T2:
    - **Concurrent questions:** the conversation is now locked in a statement of its own before its state is read. Two questions arriving together could otherwise both start and collide on a message number. A turn now starts in five statements.
    - **List cursor:** it carries the time and the ID, so conversations active at the same instant are neither skipped nor shown twice.
  - T3: each migration is tested down and up on its own.
  - T5, in part: each stored answer records the agent version that wrote it (migration `0003`), beside the widget version.
  - T8: the conformance and cross-tenant suite (`backend/tests/test_store.py`). Another user, the same user on another widget, or another tenant gets nothing from any storage call and changes nothing. It also pages through 10,000 messages, handles ties in the list, survives a gateway restart and refuses malformed cursors.
  - The history panel (M2-T8):
    - **Who sees it:** signed-in visitors on widgets with history turned on.
    - **The list:** their chats, titled and dated, older ones on demand.
    - **Reopening:** a chat reopens drawn exactly as it streamed and carries on in place; earlier messages load above it on demand.
    - **Layout:** on narrow frames the list replaces the conversation; from 720px it stands beside it.
    - **Everyone:** a "New chat" action.
    - **Anonymous visitors** see no list: their history lasts the session only.
- Proven:
  - the suites above on PostgreSQL;
  - browser journeys through the real gateway on three engines (`e2e/gateway/history.spec.ts`):
    - a resident's chat comes back on their next visit, reopens drawn the same as it streamed, and carries on;
    - another resident never sees it;
    - a new chat joins the list;
    - the wide layout works;
    - WCAG 2.2 AA scans pass on a phone, the floating panel and a wide frame.
  - The scan found Muted Umber on Soft Sand at 4.2:1, so the open chat's date is set in Warm Ink.
- The latency check, M4's budget, judged soundly:
  - On 13 November the pipeline's load test swung between 84 and 199 ms at the 95th percentile on unchanged code, and once failed both tries on this module branch.
  - A local A/B test showed the race fix adds nothing measurable: the medians were 40 to 54 ms either way. The same code's 95th percentile still ranged from 80 to 233 ms, so on a shared machine noise dominates one run's figure.
  - The pipeline's history shows the same spread back to M4 (79 to 199 ms, once 251 ms), so M4's recorded 79 to 94 ms was a lucky sample (corrected under M4).
  - Your decision on 13 November 2026: the pipeline checks 10 visitors at once, which the runner can carry without measuring itself. It judges the median of three runs' 95th percentiles against 150 ms. That replaces the M5 retry, which passed whenever either of two tries did and so could also let a real slowdown through.
  - At 25 visitors the median of three runs measured 152 ms on the runner.
- Deferred:
  - **By decision:** delete, purge, the reopen window and the record period, until the purge policy is set.
  - **With M14's AWS database:**
    - T4's row-level security and T7's restricted database role, encryption at rest and encrypted connections;
    - the restore rehearsal in the done condition;
    - the failover and production-sized migration tests.
  - **Also deferred:**
    - export of a user's data;
    - the feedback and audit tables (M4-T10, M8);
    - performance at a million conversations;
    - other databases.
- For M8:
  - a widget's `history_enabled` turns the list on for its signed-in visitors;
  - answers record the widget version (`config_version`) and the agent version (`agent_version`).
- For M14:
  - run `python -m ucp.migrate` before each release (migration `0003` adds a column);
  - create the database roles for row-level security there;
  - certify the latency budget (at most 150 ms added to the first word at the 95th percentile) with 25 or more visitors at once, against the deployed stack, from a separate machine.

---

### M8 — Control plane API

**Purpose.** Where widgets are created, configured, published and audited.

**Tasks**

- M8-T1 Tenant and widget records; public widget ID generation.
- M8-T2 Full configuration schema with each field marked public or private; server-side validation.
- M8-T3 Versions: draft, publish as an unchangeable version, roll back, compare two versions.
- M8-T4 PF connection profiles: address, tenant, workspace, agent ID; credentials written to the secret store and never returned; "test connection".
- M8-T5 Identity settings per widget: mode; shared-secret creation and rotation; identity-provider issuer and audience.
- M8-T6 Allowed domains, feature switches, quotas and rate limits, conversation layout settings, retention.
- M8-T7 Publishing: a validated snapshot is written where the gateway reads it, and the cached public configuration is refreshed.
- M8-T8 Administrator sign-in through the company identity provider; roles (platform administrator, tenant administrator, viewer); every action scoped to a tenant.
- M8-T9 Audit log of every change: who, what, when. Append-only. A tenant's administrators can read their own entries through the API.
- M8-T10 A command to create the first tenant and administrator; import and export of configuration as JSON.

Later: storage profiles, self-service sign-up, usage and billing data.

**Tests**

- Unit: validation of every field including bad colours, addresses and domain patterns; the public projection; published versions cannot be changed; version comparison.
- Backend: create, read, update, delete for each resource; a role-by-operation-by-tenant matrix; secrets are write-only; publish and roll back; two people editing one draft; an audit entry for every change.
- Middleware: sign-in required; request-forgery protection; rate limits on the admin API.
- Integration: a published change reaches the gateway; a rollback restores the earlier behaviour; "test connection" against the fake PF for success, wrong credentials and unreachable; secret store round trip locally and on AWS.
- End-to-end: create, configure, publish, embed on a sample page, chat. This is the automated onboarding journey.
- Deployment: the admin API is unreachable from the public widget domain; separate entry point and firewall rules; configuration backed up.
- Other, security: a tenant administrator cannot see or change another tenant; secret references cannot point outside the tenant's own area; the audit log cannot be edited; domain allow-list bypass attempts (look-alike domains, sub-domain tricks, internationalised names).

**Done when** the onboarding journey passes end to end and the role matrix is green.

State on 13 November 2026 (pull requests 51 to 54 into `module/m08-control-plane`). By your decision, M8 is configuration managed as code for the base version. The admin HTTP API comes with the console (M9) after 22 November.

- Built:
  - T2:
    - **Allowed sites:** a mistake could have widened who may show a customer's chat, so these are now refused: plain `http` other than localhost; wildcards over a shared suffix (`*.com`, `*.ac.uk`, `*.github.io`); and capitals, non-ASCII names, trailing dots, bad labels, user names, paths, queries and bad ports.
    - **Every fault at once:** a file of widgets reports every fault in one go, each naming the widget and the field, and publishes nothing.
    - The shared-suffix list is short, marked as a shortcut until customers outside the UK arrive.
  - T3, T7 and T9:
    - **Publishing:** every publish records who did it. A rollback publishes an earlier version again as a new one; a version that breaks today's rules is refused rather than served broken.
    - **Audit log:** it keeps who, what and when.
    - **Nothing can be edited:** a database trigger refuses any change, removal or truncation of the log and of published versions, whoever asks (migration `0004`).
  - T1, T4, T5 and T10, as commands:
    - **`python -m ucp.widgets`:** `seed`, `versions`, `rollback`, `audit`, `export` (publishing it again changes nothing), `new-id` and `new-secret` (32 random bytes, named by date for rotation);
    - **`python -m ucp.pf check`:** logs in with each connection profile and names the outcome, never an address or a credential. It was tried against PF staging.
  - **The onboarding journey, automated** (`e2e/gateway/onboarding.spec.ts`), on three engines:
    1. a new ID from the command;
    2. a configuration file;
    3. publish with the command;
    4. one script tag on a customer's page, honouring the configured title, colour and corner;
    5. a visitor's question answered;
    6. the version and the audit entry, read back with the command.
- Proven:
  - a published change and a rollback both reach visitors through the gateway (`backend/tests/test_versions.py`);
  - every refusal by the database, the command and the validation (`backend/tests/test_widgets.py`).
- Deferred to the admin API, with M9:
  - company sign-in, the three roles and the role-by-tenant matrix (so the done condition's role matrix moves with it);
  - request-forgery protection and admin rate limits;
  - drafts edited by two people, and version comparison;
  - credentials written to the secret store through the API;
  - tenants' administrators reading their audit entries through the API;
  - self-service sign-up.
- Known limits:
  - **Two publishes of the same widget at the same instant:** one is refused (it collides on the version number).
  - **Connection check:** it only logs in, so a wrong workspace or agent ID shows on the first question. PF has no cheap call to check them.
- For M14:
  - **Each release:** run `python -m ucp.migrate` (migration `0004`), publish the configuration file with `python -m ucp.widgets seed FILE --by <the pipeline>`, then check `python -m ucp.pf check`.
  - **Backups:** `export` the configuration after each change.
- For M15: the College's guide uses `new-id`, `new-secret` and `seed`.

State on 14 November 2026 (pull requests 87 to 90 into `module/m08-control-plane`). At your request M8 now has its admin API, ahead of the console. Two decisions are yours: secrets set through the API are sealed in PostgreSQL, and the API is hosted on AWS with M9.

- **Shape (D3):**
  - The admin API is its own app, `uvicorn ucp.admin.app:create_app --factory`, from the same image under `/admin/v1`. The gateway never mounts it.
  - Its description is exported to `protocol/admin-openapi.json` for M9.
- **T8, sign-in and roles:**
  - Administrators sign in with the company identity provider's token (`UCP_ADMIN_ISSUER`, `UCP_ADMIN_AUDIENCE`), checked by M5's provider code. Proven with Keycloak in the pipeline.
  - The `administrators` table gives each person one role: `platform` (everything), `tenant` (their tenant, including its administrators and viewers) or `viewer` (reads their tenant). Another tenant's things answer 404.
  - No cookies are used, browsers must come from `UCP_ADMIN_ORIGINS`, and requests are limited per address and per administrator.
- **T1, T2, T3 and T7:**
  - Tenants and widgets are records.
  - A widget is created and edited as a draft with a revision number: a save or a publish from a stale revision is refused (`conflict`, 409), so two editors cannot overwrite each other unseen.
  - Every fault is named at once, and a widget stays in its tenant.
  - Publishing makes an unchangeable version under the draft's row lock. Rollback is refused if the version breaks today's rules, and comparison lists each changed setting.
- **T4 and T5, secrets:**
  - PF connection profiles and customers' shared secrets are sealed with AES-GCM (`ucp.vault`, keys in `UCP_SECRETS_KEY` from the secret store), bound to their tenant and name, and never returned.
  - A new shared secret is shown once, and the one before it stays valid until the next.
  - "Test connection" signs in to PF and reports only the outcome.
  - The gateway opens a tenant's own secrets first, then the platform's settings.
  - A widget may point only at its tenant's own secrets. A platform-level profile is the platform administrators' to choose.
- **T9:** every change and its audit entry are written in one transaction. Entries may now name a tenant, an administrator or a secret instead of a widget version. A tenant's people read their own entries.
- **T10:** `python -m ucp.admin first-administrator SUBJECT`. Import and export stay `ucp.widgets seed` and `export`.
- **Tests:**
  - `backend/tests/test_admin.py` (22 tests): the role × operation × tenant matrix over 28 operations, sign-in refusals, the console-origin check, limits, gateway separation, two editors, every fault at once, rollback and comparison, secrets never returned or stored in clear, the shared-secret rotation through the gateway, tenant isolation of secrets, test connection against the fake PF, a tenant's own profile answering through the gateway, the vault, and the description file.
  - Plus admin sign-in with Keycloak (`test_keycloak.py`).
- **Done condition, met:** the onboarding journey through the API (`e2e/gateway/onboarding-api.spec.ts`) passes on three engines. The operator creates a tenant and its administrator; that administrator sets and tests the tenant's PF profile, then creates and publishes a widget; a visitor chats on the customer's page; and the audit log tells the story. The role matrix is green.
- **Deferred:**
  - hosting on AWS, with its own address and firewall rules (with M9);
  - feature switches and retention (they wait on the second release and the purge policy);
  - re-sealing secrets under a new key;
  - self-service sign-up, and usage and billing.
- **For M9:** the console calls `/admin/v1` with the provider's token as a bearer, from an address in `UCP_ADMIN_ORIGINS`. Cross-origin headers for that address come with the console.
- **For M14:** when the admin API is hosted, the gateway needs `UCP_SECRETS_KEY` too (`python -m ucp.vault new-key`), so it can open tenants' secrets. Run migration `0005` before the release.

---

### M9 — Admin console

**Purpose.** Let an administrator onboard a site without an engineer.

**Tasks (first release, thin)**

- M9-T1 Sign-in and tenant selection.
- M9-T2 Widget list and a create wizard: PF connection with a test button, allowed domains, identity mode.
- M9-T3 Appearance editor with a live preview that is the real widget, and contrast warnings.
- M9-T4 Feature and conversation-layout settings.
- M9-T5 Install page: script, inline and iframe snippets; the two security-policy entries; token-signing snippets per language; an installation checker.
- M9-T6 Versions: publish, history, compare, roll back.

Second release: usage view, audit-log viewer, storage and single sign-on set-up, retention controls.

**Tests**

- Unit and UI: form validation generated from the same schema as the server; wizard state; generated snippets compared with approved files.
- Integration: each screen against the real control plane API, including validation, conflict and permission errors.
- End-to-end: the full onboarding journey, timed; the rollback journey; screens hidden by role.
- Deployment: served behind sign-in; correct API address per environment; cache refresh on release.
- Other: accessibility scan and keyboard pass on every screen (administrators in government use it too); screenshot comparison; secrets never shown after saving; session timeout; the console cannot be framed by any site.

**Done when** a new administrator completes onboarding from the console alone.

---

### M10 — Attachments (second release)

**Tasks**

- M10-T1 Upload start endpoint returning a short-lived signed upload address; object-store interface with an S3 implementation.
- M10-T2 Validation: type checked from file content, size, count per message.
- M10-T3 Malware scanning before a file is usable (on AWS, GuardDuty Malware Protection for S3); states: pending, clean, rejected.
- M10-T4 Hand-off to PF in the form PF accepts, per the specification.
- M10-T5 UI: file picker, drag and drop, paste, progress, preview, remove; camera and files on phones.
- M10-T6 Download through short-lived addresses; retention and deletion with the conversation.

**Tests**

- Unit: validators; file state transitions.
- UI: picker on desktop and phone; progress; each rejection message.
- Backend: authorisation on upload and download; expired address; wrong type; oversize.
- Integration: a standard antivirus test file is quarantined and never reaches PF; a clean file reaches PF.
- End-to-end: upload a document, ask about it, receive an answer.
- Deployment: storage is private, encrypted, separated per tenant, with expiry rules and the right cross-origin settings.
- Other: hostile file names; files disguised as another type; compressed bombs; downloads cannot run in the browser; large file on a slow connection.

---

### M11 — Voice (second release)

**Tasks**

- M11-T1 Choose the provider path: PF's speech services if it exposes them, otherwise a cloud speech service behind an adapter. Speech-to-text and text-to-speech stay separate.
- M11-T2 Microphone permission and consent; record; transcribe into the input box so the user confirms before sending.
- M11-T3 Spoken replies with play, pause and stop.
- M11-T4 Language settings; audio is not stored unless configured.
- M11-T5 Document the iframe and host permission settings the microphone needs.

**Tests**

- Unit: recording and playback states.
- UI: permission granted, denied and withdrawn; no microphone; iPhone Safari behaviour; tab in background.
- Backend: audio size, length and format limits.
- Integration: sample audio per supported language transcribes acceptably; synthesised audio plays.
- End-to-end: speak, confirm, send, hear the reply, using simulated audio input.
- Deployment: provider region matches the data-residency region; provider quotas.
- Other: all voice controls work by keyboard and a text transcript is always present; no audio retained by default; consent recorded.

---

### M12 — Security and compliance (cross-cutting)

**Tasks**

- M12-T1 Maintain the threat model; adopt a written baseline (OWASP ASVS level 2 proposed).
- M12-T2 Browser security: strict content policy for the iframe app; per-widget framing policy; iframe sandbox and permissions; integrity hash for the loader.
- M12-T3 Edge protection: web application firewall rules, rate-based blocking, optional bot control for anonymous widgets, modern TLS only.
- M12-T4 Abuse and cost controls: limits per IP address, session, user, widget and tenant; daily quotas; message size cap; concurrent stream cap.
- M12-T5 Secrets: secret store only; rotation procedures; nothing sensitive in images, settings dumps or logs.
- M12-T6 Supply chain: pinned dependencies; dependency, code, secret and container scanning; a software bill of materials per release; signed images.
- M12-T7 Privacy: data inventory; retention, deletion and export; personal data removed from logs; consent slot; data stays in its region; no third-party trackers.
- M12-T8 Security events (failed sign-ins, policy refusals, configuration changes) to append-only storage.
- M12-T9 Evidence pack, UK first: accessibility conformance report; response to the NCSC cloud security principles; Secure by Design mapping; penetration-test report; data-protection pack (processor terms, sub-processor list, impact-assessment support, storage inventory); AI transparency information pack. Details and sources are in `government-readiness.md`.
- M12-T10 Independent penetration test and fixes before general availability.
- M12-T11 Browser leak test for R13. An end-to-end run records all network traffic, console output, browser storage and the built script files, then searches them for the PF address, tenant, workspace ID, agent ID, API key, PF tokens and PF conversation IDs used in that run. Production builds publish no source maps and write nothing to the console.

**Tests**

- Scans on every pull request, blocking on serious findings.
- The cross-tenant suite on every build: every API call repeated with another user's and another tenant's identifiers.
- The browser leak test (M12-T11) on every build: zero matches.
- The injection corpus from M3.
- Content policy run in report-only mode until clean, then enforced.
- Framing: the widget refuses to appear on a site not on its list; the console refuses all framing.
- Limits and quotas verified under load.
- A planted fake secret must not appear in any log, trace or error.
- External TLS scan; ZAP scan of staging nightly.
- Key-rotation, backup and restore drills.

---

### M13 — Observability and analytics (cross-cutting)

**Tasks**

- M13-T1 Structured logs with correlation ID and sensitive fields removed.
- M13-T2 Traces and metrics through OpenTelemetry: time to first word, turn duration, stream completion rate, PF errors, token refreshes, database latency, open streams, rate-limit hits, renderer failures.
- M13-T3 Browser telemetry sent to our own endpoint in batches, sampled, with no message content and no personal data.
- M13-T4 Dashboards and alerts against agreed targets for availability, speed and error rate.
- M13-T5 Usage counts per tenant (conversations, messages, PF calls) for quotas, billing and the console.
- M13-T6 A scripted conversation run every few minutes per region as an early warning.
- M13-T7 Operating guides for each alert.

**Tests**

- Unit: redaction filters; metrics emitted.
- Integration: one turn appears as one trace across gateway, database and PF, with the same reference ID the user sees in an error.
- Deployment: log retention set as required; a deliberately broken staging release is caught by the scripted conversation.
- Other: an induced PF failure raises an alert within the agreed time; the telemetry endpoint resists abuse; message content is absent from logs by default.

---

### M14 — Cloud platform and deployment (AWS first)

**Tasks**

- M14-T1 Cloud interfaces in code: secret store and object store, each with an AWS implementation and a local one. Cloud libraries are imported only inside the adapters folder, enforced by a build rule.
- M14-T2 Container image: small, non-root, scanned and signed.
- M14-T3 Terraform for AWS: network, load balancer, container services for the gateway and admin roles, PostgreSQL across two zones, storage and content delivery for the loader, widget and console, firewall, secrets, encryption keys, DNS and certificates, monitoring, least-privilege access, scaling rules.
- M14-T4 Environments: development in a US AWS account first; production in the London AWS accounts. A second region or a dedicated customer deployment is a second run of the same code with different parameters.
- M14-T5 Delivery pipeline: build, test, scan, deploy to development, integration and end-to-end tests, staging, smoke test, production on approval, migrations, automatic rollback.
- M14-T6 Static file releases: versioned loader plus promotion of the updating URL; widget releases that keep the previous files available.
- M14-T7 Capacity: scale on open streams and processor use; limits taken from load tests.
- M14-T8 Backup and recovery: point-in-time restore, agreed recovery targets, rehearsed procedure.
- M14-T9 Cost tags and budget alerts.

**Tests**

- Unit: one conformance suite for the secret-store and object-store interfaces, run against the local and AWS implementations.
- Integration: after every deployment, a smoke suite covering health, configuration fetch, an anonymous turn and a logged-in turn.
- Deployment: infrastructure code validated and policy-checked (no public storage, encryption on, no open inbound rules beyond the public entry points); a brand-new AWS account built from nothing, timed; deployment while streams are open; rollback of both application and loader; migration forward and back; secret rotation; certificate renewal.
- Other, performance: staging load test at the agreed concurrency with scaling; cache hit rate; time to add capacity.
- Other, resilience: loss of one zone; database failover; container stopped; PF unreachable shows a clear message.
- Other, security: access policies, network rules and firewall rules reviewed and tested; storage reachable only through the content delivery network; account activity logging on.
- Other, portability: the full backend test suite passes with local adapters and no AWS credentials. This proves on every build that the core does not depend on AWS.

**Done when** a new region can be created from the code alone and passes the smoke suite.

State on 13 November 2026 (pull requests 56 to 62 into `module/m14-cloud-deployment`). By your decisions: you saw the plan first; the environment runs on demand, not always on; the gateway uses a public subnet with no NAT; the PF staging credentials are held in AWS Secrets Manager.

- Built, in the US development account, `us-east-1` (`infra/aws`; the runbook is `infra/aws/README.md`):
  - **Way in:** CloudFront on its own HTTPS address. It stays while the environment sleeps, answering "This test environment is asleep", so a customer's script tag keeps working.
  - **Load balancer:** only CloudFront's addresses carrying its secret header can reach it.
  - **Gateway:** one Fargate task with 1 vCPU and 2 GB, in a public subnet, reachable only from the load balancer.
  - **Database:** PostgreSQL 17, private, encrypted, with 7 days of point-in-time backups.
  - **Secrets** under `ucp-dev/`, kept out of Terraform's state and the repository.
  - **Image registry:** scans images, and commit tags can't be overwritten.
  - **Roles:** under `ucp-dev-boundary`.
  - **Terraform's state:** in an encrypted, versioned bucket.
  - **On demand:** `dev.py wake` (about 10 minutes) and `sleep`, plus `build`, `teardown` and `status`. Roughly US$0.11 an hour awake and US$5 a month asleep, from list prices as remembered.
- T1: the gateway imports no cloud library (`backend/tests/test_portable.py`). Secrets reach it as environment settings, filled by the container service.
- T2: the image runs as a non-root user with a read-only root filesystem, applies Debian's security fixes when built, and is scanned on every release. It is not yet signed.
- T5, the pipeline (`.github/workflows/deploy-dev.yml`):
  - **Sign-in:** GitHub signs in to AWS without stored keys, with the trust limited to `develop` and this module branch (and GitHub's immutable repository identity).
  - **Each push:** build, scan (fixable high or critical flaws stop it), store, then `deploy.py`: migrations, the widget file, a rolling update that rolls itself back if unhealthy, and the PF check, then the smoke test. While asleep it only stores the image.
  - **On every pull request:** CI's new "Infrastructure code checks" job checks the Terraform's format and validity and runs a misconfiguration scan. Accepted findings carry their reason inline.
- T8: backups, and a restore rehearsed (below).
- Two gateway fixes the deployment needed:
  - the same-origin check behind CloudFront (`UCP_PUBLIC_ORIGIN`);
  - per-visitor limits behind CloudFront (`UCP_VISITOR_ADDRESS_HEADER`).
- Found and fixed on the deployed stack:
  - **Logging (from M4):** the gateway's own log lines never reached the logs, so no access log and no turn lines. Python drops them unless logging is configured.
  - **Image flaws:** two fixable zlib flaws in the base image, caught by the scan.
  - **Pipeline sign-in:** GitHub's newer identity format.
  - **Permissions:** one missing read permission for creating the load balancer, which an administrator added (policy version 2).
- Proven on the deployed stack, against PF staging:
  - the smoke suite, 15 steps: health, the database, the loader, the configuration, an anonymous turn, a signed-in turn. It passes from this machine and in the pipeline;
  - the R13 browser leak search, with nothing of PF anywhere in the browser (`npm run e2e:deployed`);
  - the edge: the load balancer refuses direct connections, plain HTTP is redirected to HTTPS, and the security headers are present;
  - **M4's latency budget at 25 visitors at once** (the M7 decision):
    - three runs on 1 vCPU gave 139, 113 and 111 ms at the 95th percentile (median 113, within 150), all 225 answers delivered;
    - on half a vCPU the opening burst queued it to 304–319 ms, hence the sizing;
    - each answer logs the gateway's own share, so PF's time is left out (`infra/aws/latency.py`).
  - **A release while answers stream:** 21 answers asked during a forced rollout, all completed (`rollout_check.py`).
  - **A rollback and a roll forward:** both passed the smoke test, with the log showing which code served.
  - **The restore rehearsal:** the database restored to a moment 08:17:10 UTC into a new instance in 14 minutes. Every table matched the live database at that moment (80 conversations, 462 messages), and the copy was then removed (`restore_rehearsal.py`). This completes M7's done condition too.
- **The done condition, met on 13 November 2026.** With your word, the environment was torn down and rebuilt from the code alone:
  1. **Teardown:** `dev.py teardown` removed 40 resources in about 3 minutes, leaving only the state bucket and GitHub's sign-in.
  2. **Rebuild:** `dev.py build` created 40 resources in 8 minutes 43 seconds, adopting GitHub's sign-in again.
  3. **Secrets:** `secret_store.py agent-profiles` set the PF profile.
  4. **Image:** the pipeline built, scanned and stored an image. The GitHub secrets needed no change.
  5. **Wake:** `dev.py wake` ran the migrations, the widget file and the PF check.

  From nothing to awake took 17 minutes 30 seconds of wall-clock time. The smoke suite passed all 15 steps, and the R13 leak search passed. The rebuild has a new address, `https://d17o90elbmlyrb.cloudfront.net`, which the scripts and the pipeline found from the release by themselves.
- Deferred:
  - **Production in London:** private subnets and NAT, a database across two zones, our own domain names and certificates (HTTPS to the load balancer too), and a web application firewall.
  - **Needs an AWS administrator:** budget alerts and autoscaling, which the deploying user may not create.
  - **Not chosen for dev:** container insights, flow and CloudFront logs, and encryption with our own keys.
  - **Also deferred:**
    - image signing;
    - pinned loader releases (T6);
    - a nightly run of the staging suite from AWS (M6);
    - zone-loss and failover tests;
    - timing a brand-new account's build.
- For M15:
  - the address the College uses comes from `python infra/aws/deploy.py --url`;
  - a widget's shared secret comes from `secret_store.py host-secret NAME`;
  - the sandbox's widgets go in `backend/deploy/widgets.dev.json`.
- For M12: the leak search runs against the deployed stack (`npm run e2e:deployed`); running it on every build comes with M12.

---

### M15 — Developer experience and onboarding

**Tasks**

- M15-T1 Quick-start guides: public site in five minutes; logged-in portal in thirty.
- M15-T2 Security-policy guide; troubleshooting by error code.
- M15-T3 Sample host sites (HTML, React, Next.js, Angular, Vue) and backend token examples (Python, Node, Java, .NET, PHP, Go).
- M15-T4 Loader API reference generated from the TypeScript types.
- M15-T5 Versioning and change-log policy for the loader and the protocol.
- M15-T6 The timed onboarding test procedure.

**Tests**

- Every code snippet in the documentation is extracted and run in the pipeline.
- The sample sites are the host matrix for M1.
- Link check on every build.
- The timed onboarding test each release: an engineer new to the product integrates a static site and a logged-in portal using only the public guides. Time and every point of friction are recorded.

**Done when** both timed runs finish inside the hour.

State on 13 November 2026 (pull requests 66 to 70 into `module/m15-developer-experience`). By your decisions, the base version gives the College sample pages and a guide for its own sandbox, plus copies hosted on our side. The College's details are mocked: sample branding, no College logo, and every page marked as a sample.

- Built:
  - **T3, partly:** the College's samples in `examples/college`, a public page and a portal page with `portal.js`. They have no inline scripts, and their content policy names the assistant only in `script-src`, `frame-src` and `connect-src`. The token-signing code in six languages came with M5.
  - **T1 and T2, partly:** `docs/college-sandbox-guide.md`. It covers what we send and what we need, the public page, the portal page, the content policy, and what each of the loader's debug lines means.
  - **The hosted copies** (`infra/aws/dev/samples.tf`):
    - a private bucket behind a CloudFront address of its own, with the pages filled in by Terraform. `python infra/aws/deploy.py --samples-url` prints the address. It changes whenever the site is rebuilt: a `dev.py sleep` run from a branch without `samples.tf` removed the site on 13 November, and the next wake rebuilt it at a new address;
    - the portal signs in under any name through a CloudFront function (`functions/demo-token.js`), which signs for the demo widget only;
    - the College's widget (`both`) and the demo widget (`signed_in`) are in `widgets.dev.json`, allowed on the samples' site through `UCP_SAMPLES_ORIGIN`. A widget file may now name `${UCP_…}` settings.
  - **T6:** the procedure, `docs/onboarding-test.md`.
- Tests:
  - `backend/tests/test_guides.py`: every HTML and JavaScript snippet in the guide is in a tested sample, and every relative link in the guides reaches a file;
  - `e2e/gateway/samples.spec.ts`, 12 runs: the samples, filled in as the deployment fills them, against the real gateway on three engines. The sign-in function runs as CloudFront runs it, and no page breaks its content policy;
  - `test_portable.py`: the dev widget file publishes once it is filled in;
  - on the deployed stack against PF staging (`npm run e2e:deployed`, 4 passed): the hosted public page is answered; on the hosted portal, a name signs in and finds its chat again after signing out and in; a bad name is refused; and the R13 leak search passes. The pipeline's smoke test passed on the release with the College's widgets.
- Found and fixed:
  - **Secrets not reloaded:** releasing again after a secret change did not restart the gateway, because an unchanged release starts no deployment. `deploy.py` now always forces a fresh one.
  - **Widget file not deployed:** the widget file travels inside the image, so the pipeline now deploys from this module branch, as it did for M14.
- Still to do:
  - **The College's shared secret:** run `secret_store.py host-secret college`, then `deploy.py`. It prints the secret once, to send with the widget ID and the two addresses.
  - **The College's sandbox addresses:** add them to its widget's `allowed_domains`.
  - **The first timed run:** it needs an engineer new to the product.
- Deferred:
  - framework samples (React, Next.js, Angular, Vue);
  - the loader API reference generated from the types (T4);
  - the versioning policy (T5);
  - the console's documentation, with M9;
  - running the guide's snippets in the pipeline, beyond comparing them with the tested samples.

The done condition, both timed runs inside the hour, waits for that first run.

---

## 9. System-level test suites

These cut across modules and are owned at product level.

| Suite | What it proves | Where it runs |
|---|---|---|
| End-to-end journeys | Onboard, embed, anonymous chat, logged-in chat with history, rich content, errors and recovery | every merge on one browser, nightly on all |
| Host compatibility | The widget works on each sample host and under hostile host conditions | nightly |
| Browser and device | The support list, including real phones, a tablet and a foldable | nightly by emulation, each release on real devices |
| Cross-tenant security | No identifier, token or configuration crosses a tenant or user boundary | every build |
| Load and soak | Concurrency, latency budgets, no leaks | nightly short run, each release full run |
| Resilience | Loss of an instance, a zone, the database primary or PF | each release in staging |
| Deployment verification | Smoke tests, the scripted conversation, rollback | every deployment |
| Accessibility | WCAG 2.2 AA by automated scan and manual screen-reader passes | scan on every merge, manual each release |
| Timed onboarding | The 60-minute promise | each release |

## 10. Build order

Work is ordered as thin end-to-end slices so that something demonstrable exists after each one.

| Slice | Outcome | Modules touched |
|---|---|---|
| 0 Foundations | Repository, pipeline, protocol version 1, fake PF, PF discovery started | M0 |
| 1 First streamed reply | A script tag on a plain HTML page opens a floating widget and streams Markdown from the fake PF, deployed to the AWS development environment | M1, M2, M3 (Markdown), M4, M14 (minimal) |
| 2 Real PF and configuration | The same flow against the PF sandbox; widget configuration and theme come from the control plane | M6, M8, M4 |
| 3 Identity and history | Host-signed sign-in; history stored and shown only to its owner | M5, M7, M2 |
| 4 Rich content and scrolling | Tables, charts, diagrams, code; both flow directions; scroll rules | M3, M2 |
| 5 Console and onboarding | Thin console, snippets, guides, first timed onboarding test | M9, M15 |
| 6 Hardening | Security review, accessibility audit, load and recovery tests, dashboards, penetration test | M12, M13, M14 |
| Release 2 | Attachments, voice, DynamoDB and further databases, single sign-on set-up, fuller console | M10, M11, M7, M9 |
| Release 3 | Framework wrappers, customer-specific blocks, human hand-off, self-hosting package | M1, M3, others |
| Multi-cloud | Azure, then GCP | M14 |

After slice 0, the browser work (M1 to M3) and the server work (M4 to M8) can proceed in parallel, because both sides build against the protocol examples and the fake PF.

## 11. Path to Azure and GCP

The first release is built so that moving clouds is a bounded piece of work, without building anything for the other clouds now.

| Concern | AWS (now) | Azure (later) | GCP (later) | New code needed |
|---|---|---|---|---|
| Compute | ECS Fargate | Container Apps | Cloud Run | none, same image |
| Database | RDS PostgreSQL | Azure Database for PostgreSQL | Cloud SQL | none |
| Secrets | Secrets Manager | Key Vault | Secret Manager | one adapter each |
| Files | S3 | Blob Storage | Cloud Storage | one adapter each |
| Static files and delivery | S3 and CloudFront | Storage and Front Door | Storage and Cloud CDN | none |
| Telemetry | CloudWatch through OpenTelemetry | Azure Monitor | Cloud Monitoring | configuration only |
| Infrastructure | Terraform stack | new stack | new stack | Terraform only |

For each new cloud the work is two small adapters, one Terraform stack, and a rerun of the existing conformance, end-to-end, load and security suites. Malware scanning for attachments differs most between clouds and will need its own look at that point.

## 12. Decisions: settled and still open

### Settled on 12 November 2026

| Topic | Decision |
|---|---|
| PF access | Live capture done on staging: login, conversation creation, streaming, the fetch call, hang-up behaviour and error shapes are confirmed. See `pf-capability-sheet.md`. |
| Language model | Claude Sonnet family, one version behind the latest, as a standing preference. |
| Deletion | Conversations are not deleted for now, either by the user or automatically. |
| Cancelling | PF has no call to cancel a reply. The stop button stops the display only. |
| Repository | GitHub, with the branch model in section 13. |
| AWS accounts | Development in a US account; production in London accounts. |
| The College | Its site has both public visitors and logged-in users, so the base version supports both. Branding is set per widget. |
| Target | A base version in the development environment by 22 November 2026 (section 14). |
| Repository visibility | Public, under the Apache 2.0 licence. Confirmed. |
| Base version scope | Section 14 confirmed. The admin console follows after 22 November. |
| Toolchain | Chosen, installed and verified on the build machine. Versions and commands are in `tech-stack.md`. |
| Pull requests | Feature branches are merged into module branches without review. Merges into `develop` and `main` wait for your word. |
| AWS access for development | Both policies exist as managed policies and the deployer is attached. Verified by script on 12 November 2026. The region held only its default network, with no clusters, databases or load balancers. |
| PF hosting | Staging runs in the US; production runs in the UK (London). UK customers are served only through production, and staging carries test data only. |
| Certifications | Intellect holds the certificates UK buyers ask for (Cyber Essentials, ISO 27001). |
| Hosting | We host on AWS. A government customer that requires a particular provider gets a dedicated deployment on AWS, Azure or GCP. Private data centres are out of scope (D16). |
| Transcripts | Our PostgreSQL copy is what users see. Nothing is hidden or deleted automatically for now; your team is discussing the purge policy (D10, M7-T5). |
| Admin console | Thin console in the first release (D12). |
| First customer | Goodenough College, London: a registered educational charity housing international postgraduate students. First region London, English first. It is neither a public body nor an FCA-regulated firm; see `government-readiness.md` section 2.9. |
| Browser exposure | No PF or connection detail reaches the browser (R13, D15, M12-T11). |
| Abuse controls | Limits and quotas in the first release (M12-T4). |
| Admin API secrets (14 Nov) | PF connection profiles and shared secrets set through the admin API are sealed with AES-GCM in PostgreSQL, under keys from the secret store. The app's AWS role keeps read-only access to Secrets Manager, and the code stays free of cloud libraries. |
| Admin API hosting (14 Nov) | Built and tested on this machine and in the pipeline now; hosted on AWS with the console (M9), behind a company identity-provider registration. |

### Still open

1. **Local database as a service.** PostgreSQL runs on the build machine only while a test command runs. Registering it as a Windows service would keep it running between commands; that needs your approval.
2. **Purge policy.** With your team. Until it is decided, nothing is hidden or deleted.
3. **Web addresses for production.** A name under a domain Intellect owns, for the loader, the chat and the API. Not needed for the development sandbox.
4. **Remaining PF questions.** Section 10 of `pf-capability-sheet.md`.

Proceeding with the recommended default unless you object: Terraform (D13); automatic loader updates with a pinned option; a device cloud for real-device testing; a bot challenge on public widgets only if limits prove insufficient.

### Top risks

| Risk | Effect | Mitigation |
|---|---|---|
| Conversations are not deleted for now, and PF cannot cancel a reply | A request to erase someone's data has to be handled by your team by hand; a stopped answer still runs and is remembered | Agree the purge policy before production; a stopped answer is stored and marked as stopped |
| Ten days to the base version | The full test lists in section 8 cannot all be run by 22 November | The base version carries the core suites (section 14); the rest are completed before production |
| The repository is public | Anything committed is published and licensed for reuse | Confirmed as intended. Credentials, staging identifiers and internal source documents are excluded; secret scanning runs on every push from M0 onward |
| The build machine has no Docker | Images cannot be built or run locally | The GitHub pipeline builds and starts the image on every pull request |
| PF staging runs in the US | UK personal data would leave the UK if it were used in staging | Test data only in staging; UK customers use PF production in London. Confirm that the language model behind PF production also runs in the UK. |
| Scripted abuse of public widgets | PF cost and capacity | Layered limits and quotas from the first release (M12-T4) |
| iPhone, WebView and foldable quirks | Broken layout or hidden input on real devices | Real-device pass each release (M2) |
| Host change control or strict policy | The hour is exceeded for reasons outside the product | One-origin policy change, script-free option, debug checklist |
| Corporate proxies buffer streamed replies | Answers appear all at once or time out | Heartbeats and the JSON fallback (D2) |
| Diagram and chart libraries are large | Slow on low-end phones | Load on demand, size limits per renderer (M3) |

### Sources for the PF findings

- https://purplefabric-help.intellectai.com/api/
- https://magicplatform-docs.intellectai.com/api/
- https://magicplatform-docs.intellectai.com/technicalconcepts/api/expert-agent-studio-apis/
- https://purplefabric-help.intellectai.com/5advanceconcepts/consume-an-agent-via-api
- The PF integration snippet supplied on 12 November 2026 (conversation calls)

## 13. Repository and branching

Repository: `https://github.com/baskaranchidambaram07-coder/conversationplugin`

| Branch | Purpose |
|---|---|
| `main` | Released code only. Carries the release notes and the installation package. |
| `develop` | Integration of finished module work. Used for internal testing. |
| `module/mNN-name` | One per module, sixteen in all. Holds that module's components. |
| `feature/mNN-topic` | Day-to-day work. Cut from its module branch and merged back into it by pull request. |

The flow is feature branch, then module branch, then `develop`, then `main`. A module branch is brought up to date with `develop` before work on it starts, so that it sees the shared message format and the modules it depends on.

State on 12 November 2026: `develop` and the sixteen module branches exist on GitHub. You confirmed that the repository stays public under its Apache 2.0 licence. The planning documents and the capture script are therefore pushed on `feature/m00-planning-and-discovery`, with a pull request into `module/m00-foundations`. Credentials, staging identifiers and the internal source documents are excluded by `.gitignore` and are never committed.

## 14. Base version for 22 November 2026

Goal: a working assistant in the development environment that the College can test from its own pages. Production integration follows once the College is satisfied.

Environment: the US AWS account for our side and PF staging for the agent. Both are outside the UK, so the sandbox is for test accounts and test questions only.

### In the base version

| Area | What is included | Modules |
|---|---|---|
| Embedding | Script tag, floating launcher and panel, inline placement, full screen on phones, debug checklist | M1 |
| Chat | Branding from configuration (colours, logo, title, welcome text, suggested prompts); message input; working state; streamed answers; error states; AI notice; layouts from 280 px | M2 |
| Rendering | Markdown, tables and code. Diagrams and charts if time allows | M3 |
| Gateway | Public configuration, sessions, conversations, streamed messages, allow-listed output, basic rate limits | M4 |
| Identity | Anonymous visitors and logged-in users (token signed by the host), since the College has both | M5 |
| PF | Login and refresh, conversation creation, streaming, recovery after a dropped stream, error translation | M6 |
| History | PostgreSQL. Logged-in users can reopen earlier conversations; anonymous history lasts for the session | M7 |
| Configuration | Widgets defined by a seed command from a configuration file | M8, partly |
| Deployment | One container, PostgreSQL and static hosting in the US development account, on addresses AWS provides | M14, partly |
| Hand-over | Two sample pages (public and logged-in) and a short guide for the College | M15, partly |

### After the base version, before production

The admin console; diagrams and charts if not reached; the production stack in London on our own web addresses; the full accessibility audit; load and failure tests; the penetration test; real-device testing; pinned loader releases; the purge policy. Attachments and voice stay in the second release.

### Tests in the base version

Unit tests for every module touched; API and middleware tests for the gateway; integration tests with the fake PF and PostgreSQL; a nightly check against PF staging; end-to-end journeys on three browser engines and phone sizes; the browser leak test (R13); the test that one user cannot see another's history; a smoke test after each deployment. The remaining tests listed in section 8 are completed before production.

### Order of work

| Target | Work |
|---|---|
| 13 Nov | M0: repository layout, build pipeline, message format, fake PF built from the recorded samples, local environment |
| 14 to 16 Nov | Loader, chat and gateway working together against the fake PF |
| 17 Nov | PF connector against staging; widget configuration and branding |
| 18 Nov | Sessions for both kinds of user; history |
| 19 Nov | Deployment to the development account; sample pages; leak test and end-to-end tests against the deployed stack |
| 20 Nov | Phone and keyboard pass; error states; diagrams and charts if time allows |
| 21 Nov | Reserve, and the guide for the College |
| 22 Nov | Hand-over |
