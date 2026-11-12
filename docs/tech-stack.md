# Technology and Infrastructure Stack

Status: 12 November 2026. Everything marked "verified" was run on that date, on the build machine or in the GitHub pipeline. The build machine is a Windows Server instance on AWS without Docker.

## 1. Readiness at a glance

| Area | State | What is left |
|---|---|---|
| Source control and branch model | In place | Nothing |
| Backend toolchain | Verified: lint and three tests pass | Nothing |
| Web toolchain | Verified: type checks, unit tests and builds pass | Nothing |
| Browser testing | Verified on Chromium, Firefox, WebKit and a phone profile | Real devices, before production |
| Build pipeline | Verified: all four jobs pass on GitHub | Nothing |
| Container image | Verified in the pipeline: it builds and its health endpoint answers | Nothing |
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

Added when first used: Alembic for database migrations, PyJWT for tokens, OpenTelemetry for traces and metrics.

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
| Message format types | json-schema-to-typescript | 16.0 | Turns the schema the backend exports into TypeScript types (`protocol/src/v1.ts`) |
| Schema checks in tests | Ajv with ajv-formats | 8.20 / 3.0 | Checks the shared example files against the schema, so the TypeScript side reaches the same verdict as the Python models |

Added when first used: react-markdown with a sanitiser, Recharts, Mermaid, Radix primitives, axe-core for accessibility checks.

Size budgets:

- The loader's 6 KB limit is enforced in the pipeline now (`npm run size`).
- React itself is 69 KB compressed, which leaves about 30 KB of the 100 KB first-load budget for the chat shell. Markdown and other renderers load separately. This needs watching from the first day of module M2.

## 4. Build pipeline

GitHub Actions runs four jobs on every pull request and on every push to `main`, `develop` and the module branches:

| Job | What it does |
|---|---|
| Backend lint and tests | Installs from the lock file, runs Ruff and pytest against a PostgreSQL 17 container |
| Web checks, builds and browser tests | Type checks, unit tests, both builds, the loader size limit, then Playwright on all four targets |
| Container image builds and starts | Builds the gateway image and checks that its health endpoint answers |
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

## 7. Commands

Run from the repository root in Git Bash.

After `npm install` on this Windows machine, check `package-lock.json` before committing: npm here drops the optional entries `node_modules/@emnapi/core` and `node_modules/@emnapi/runtime`, and `npm ci` in the pipeline then fails. Put the two entries back from the previous lock file.

| Task | Command |
|---|---|
| Backend lint | `cd backend && uv run ruff check . && uv run ruff format --check .` |
| Backend tests with the local database | `cd backend && bash ../scripts/with-localdb.sh uv run --env-file ../.env pytest` |
| Web type checks, unit tests, builds | `npm run typecheck && npm test && npm run build` |
| Loader size limit | `npm run size --workspace @ucp/loader` |
| Browser tests | `npm run build && npm run e2e` |
| Regenerate the message format after changing `backend/ucp/protocol.py` | `cd backend && uv run python -m ucp.protocol && cd .. && npm run generate --workspace @ucp/protocol` |
| Run the fake PF on port 8100 (behaviours are listed in `backend/fakepf/app.py`) | `cd backend && uv run uvicorn fakepf.app:app --port 8100` |
| Rebuild the fake PF's recordings from new captures (only where `spikes/pf_capture_out/` exists) | `python spikes/clean_pf_recordings.py` |
| Install or update the test browsers | `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/ms-playwright" npx playwright install` |
| Terraform | `.tools/terraform/terraform.exe` |
| Check AWS access | `bash infra/aws/iam/verify-access.sh` |
