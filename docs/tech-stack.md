# Technology and Infrastructure Stack

Status: 12 November 2026. Everything marked "verified" was run on that date, on the build machine or in the GitHub pipeline. The build machine is a Windows Server instance on AWS without Docker.

## 1. Readiness at a glance

| Area | State | What is left |
|---|---|---|
| Source control and branch model | In place | Nothing |
| Backend toolchain | Verified: lint and the backend tests pass | Nothing |
| Web toolchain | Verified: type checks, unit tests and builds pass | Nothing |
| Browser testing | Verified on Chromium, Firefox, WebKit and a phone profile | Real devices, before production |
| Build pipeline | Verified: all four jobs pass on GitHub | Nothing |
| Container image | Verified in the pipeline: it builds, with the loader and chat inside, and answers | Nothing |
| Local database | PostgreSQL 17 runs while a test command runs, then stops | Your decision on running it as a Windows service |
| Infrastructure tool | Terraform installed, checksum verified | The configuration itself is module M14 |
| AWS access for development | Verified: 13 needed actions allowed, 8 forbidden ones refused | Nothing |
| Purple Fabric staging | Verified by live capture | Remaining questions in `pf-capability-sheet.md` |
| Production in London | Not started | Account access and web addresses |

## 2. Backend

| Part | Choice | Version | Why |
|---|---|---|---|
| Language | Python | 3.12.10 | Your stated preference; supported until 2028 |
| Dependencies and lock file | uv | 0.9.24 | One tool for the environment and an exact lock file (`backend/uv.lock`) |
| Web framework | FastAPI on Uvicorn | 0.162 / 0.54 | Streams server-sent events; generates the API description used in contract tests |
| Data validation | Pydantic | 2.14 | The message format is defined once here and exported for the web side |
| Database access | SQLAlchemy with asyncpg | 2.1 / 0.32 | Reaches PostgreSQL now and other databases later without new adapters |
| Database | PostgreSQL | 17 | A managed service on AWS, Azure and GCP |
| Tests | pytest | 9.2 | With httpx2 2.16 as the test client, which FastAPI now requires |
| Lint, format, security rules | Ruff | 0.17 | One tool; includes the Bandit security checks |

| Database migrations | Alembic | 1.20 | Each change to the tables, tested down and up (`python -m ucp.migrate`) |
| Session tokens | PyJWT | 2.15 | Signs and checks the gateway's short-lived session tokens; M5 uses it for host tokens too |
| HTTP client for PF | httpx2 | 2.16 | Streams PF's replies; also FastAPI's test client |

Added when first used: OpenTelemetry for traces and metrics.

The gateway reads its settings from the environment when it starts:
- `UCP_DATABASE_URL`: the PostgreSQL address.
- `UCP_SESSION_KEYS`: the token-signing keys, as `id:secret,…`; the first one signs.
- `UCP_AGENT_PROFILES`: the PF connection profiles, as JSON.
- `UCP_WEB_DIR`: where the built loader and chat are. The image sets this one.

## 3. Web

| Part | Choice | Version | Why |
|---|---|---|---|
| Runtime and packages | Node with npm workspaces | 24.11 / 11.6 | Already on the build machine; no extra package manager |
| Language | TypeScript | 7.0 | Strict mode throughout |
| Chat interface | React | 19.3 | Your stated preference |
| Build | Vite | 8.3 | Builds the chat; also runs the unit tests |
| Loader build | esbuild | 0.28 | Produces one small file with no dependencies |
| Unit tests | Vitest with Testing Library and jsdom | 5.1 / 16.3 / 29.1 | Component tests without a browser |
| Browser tests | Playwright | 1.65 | Chromium 158, Firefox 159, WebKit 27.2, plus phone emulation |
| Accessibility checks | axe-core for Playwright | 4.14 | A WCAG 2.2 AA scan of every chat state and the launcher; serious or critical findings fail |
| Chat typeface | Nunito, self-hosted (`@fontsource-variable/nunito`) | 5.3 | Open licence; served from our origin, so visitors' addresses never go to a font host |
| Message format types | json-schema-to-typescript | 16.0 | Turns the schema the backend exports into TypeScript types (`protocol/src/v1.ts`) |
| Schema checks in tests | Ajv with ajv-formats | 8.20 / 3.0 | Checks the shared example files against the schema, so the TypeScript side reaches the same verdict as the Python models |

| Answer Markdown | react-markdown with remark-gfm | 10.1 / 4.0 | Raw HTML is skipped rather than sanitised, so nothing in an answer is ever parsed as HTML; loaded only when the first answer arrives |

Added when first used: Recharts, Mermaid, Radix primitives.

Size budgets:

- The loader's 6 KB limit is enforced in the pipeline now (`npm run size`).
- React itself is 69 KB compressed, which leaves about 30 KB of the 100 KB first-load budget for the chat shell (about 78 KB used today). Markdown and other renderers load separately, each held under 60 KB compressed (Markdown is about 50 KB); `npm run size` checks both.

## 4. Build pipeline

GitHub Actions runs five jobs on every pull request and on every push to `main`, `develop` and the module branches:

| Job | What it does |
|---|---|
| Backend lint and tests | Installs from the lock file, runs Ruff and pytest against a PostgreSQL 17 container |
| Web checks, builds and browser tests | Type checks, unit tests, both builds, the loader size limit, then Playwright on all four targets |
| Gateway journeys and load | Runs the real chat against the real gateway, with PostgreSQL and the fake PF, on three browser engines. Then runs the API journey script and the load test, which checks the gateway adds at most 150 ms to the first word at the 95th percentile |
| Container image builds and starts | Builds the gateway image from the repository root (a Node stage builds the loader and chat into it), checks that it answers, sends no server header and serves the loader |
| Secret scan | Runs gitleaks over the whole history |

The backend tests and the web tests each include a check that the generated message-format files (`protocol/schema/v1.json` and `protocol/src/v1.ts`) match their source, so a forgotten regeneration fails the pipeline.

The repository is public, so the pipeline minutes are free.

## 5. Infrastructure for development

Region `us-east-1`, built with Terraform 1.17.2. Every resource name starts with `ucp-dev`.

| Service | Purpose |
|---|---|
| VPC with subnets and security groups | A private network for the service and the database |
| ECS on Fargate | Runs the gateway container |
| Application load balancer | Spreads requests and holds long streamed replies open |
| RDS for PostgreSQL 17 | Conversation history and configuration |
| S3 and CloudFront | Serve the loader and the chat over HTTPS on an address AWS provides |
| ECR | Stores the container image |
| Secrets Manager | Holds the Purple Fabric and database credentials |
| CloudWatch Logs | Service logs |
| IAM roles under a permissions boundary | What the running service and the pipeline may do |
| GitHub sign-in to AWS | Lets the pipeline deploy without stored access keys |

My estimate of the running cost is about 60 US dollars a month. It is from memory of list prices and was not checked against the pricing pages.

Not part of the base version: a web application firewall, our own web addresses with certificates, scheduled jobs. Production in London is a second run of the same Terraform with different parameters.

## 6. What was put on the build machine

Nothing was installed system-wide and no service was registered. Everything the project needs is inside the project folder, in `.tools`, which git ignores. Deleting that folder removes it all.

| Location in the project | Contents |
|---|---|
| `.tools\terraform\` | Terraform 1.17.2 |
| `.tools\pgsql\` | PostgreSQL 17.11 server programs, from the EnterpriseDB download |
| `.tools\pgdata\` | The local database files |
| `.tools\pg-superuser.txt`, `.tools\pg-app.txt` | Generated database passwords |
| `.tools\ms-playwright\` | The Playwright browsers |
| `backend\.venv\`, `node_modules\` | Python and Node packages |

The download caches of uv and npm stay where those tools keep them, in the user profile.

The project's `.env` file holds the local settings: the Purple Fabric connection, the staging workspace and agent IDs, and the two database addresses. It is never committed.

The local database listens on `127.0.0.1` only, requires a password, and the application connects as a role without administrator rights.

## 7. Browser tests for the loader

`e2e/server.mjs` serves the loader tests on port 4174. Host pages in `e2e/hosts/` open on `http://127.0.0.1:4174`; our side (the built loader, sample widget configurations and a stand-in chat page, `e2e/chat-stub.html`, that speaks the chat's half of the bridge) is served from `http://localhost:4174`. The two names are different origins, as a customer's site and ours always are. The host pages cover a plain site, a signed-in portal, inline placement, the left corner, a right-to-left site, a strict content policy with Trusted Types, hostile global CSS, and a page that already defines `UCP`.

The same server serves the built chat at `/embed/{id}` (the widgets `w_test` and `w_left` get the stand-in instead) and a fake gateway that speaks the API in `backend/ucp/protocol.py`. Words in a test question pick its behaviour: `[long]` (the recorded long answer), `[slow]` (5 s before the first word), `[busy]` (too many messages), `[fail]` (an error part-way), `[drop]` (the stream is cut but the answer can still be fetched), `[expire]` (the session ends once), `[gallery:name]` (an example from `web/widget/src/render/gallery/`) and `[injection]` (the whole security corpus in one answer). The chat page is served with the strict content policy M4 must carry. M4 replaces it with the real gateway.

## 8. Commands

Run from the repository root in Git Bash.

After `npm install` on this Windows machine, check `package-lock.json` before committing: npm here drops the optional entries `node_modules/@emnapi/core` and `node_modules/@emnapi/runtime`, and `npm ci` in the pipeline then fails. Put the two entries back from the previous lock file.

| Task | Command |
|---|---|
| Backend lint | `cd backend && uv run ruff check . && uv run ruff format --check .` |
| Backend tests with the local database | `cd backend && bash ../scripts/with-localdb.sh uv run --env-file ../.env pytest` |
| Web type checks, unit tests, builds | `npm run typecheck && npm test && npm run build` |
| Loader size limit | `npm run size --workspace @ucp/loader` |
| Chat first-load size limit | `npm run size --workspace @ucp/widget` |
| Browser tests | `npm run build && npm run e2e` |
| The whole stack locally: gateway on port 8200, fake PF on 8100, widgets from `e2e/widgets.json` | `npm run build`, then `cd backend && bash ../scripts/with-localdb.sh uv run --env-file ../.env python devstack.py` |
| Browser journeys through the real gateway (starts the stack itself) | `npm run build && npm run e2e:gateway` |
| API journey against a running gateway (also the smoke test after a deployment) | `cd backend && uv run python journey.py http://localhost:8200 w_gateway` |
| Load test against the running stack (start it with `FAKE_PF_SPEED=0.1`) | `cd backend && uv run python loadtest.py --visitors 25 --turns 5` |
| Bring a database's tables up to date | `cd backend && UCP_DATABASE_URL=... uv run python -m ucp.migrate` |
| Publish widgets from a file | `cd backend && UCP_DATABASE_URL=... uv run python -m ucp.widgets seed path/to/widgets.json` |
| Regenerate the API description after changing a route | `cd backend && uv run python -m ucp.gateway.openapi` |
| Regenerate the message format after changing `backend/ucp/protocol.py` | `cd backend && uv run python -m ucp.protocol && cd .. && npm run generate --workspace @ucp/protocol` |
| Run the fake PF on port 8100 (behaviours are listed in `backend/fakepf/app.py`) | `cd backend && uv run uvicorn fakepf.app:app --port 8100` |
| Rebuild the fake PF's recordings from new captures (only where `spikes/pf_capture_out/` exists) | `python spikes/clean_pf_recordings.py` |
| Install or update the test browsers | `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/ms-playwright" npx playwright install` |
| Terraform | `.tools/terraform/terraform.exe` |
| Check AWS access | `bash infra/aws/iam/verify-access.sh` |
