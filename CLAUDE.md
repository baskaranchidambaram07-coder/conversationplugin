# Conversation Plugin

An embeddable chat assistant that any website adds with one script tag, powered by a Purple Fabric (PF) agent. The backend is Python (FastAPI), the chat is React inside a hosted iframe, and the loader on the customer's page is plain TypeScript.

## Read before working

- `docs/module-breakdown.md`: requirements R1 to R13, decisions D1 to D16, and modules M0 to M15 with their tasks, tests and done conditions. Section 12 lists what is settled and what is open. Section 14 is the base version due 22 November 2026.
- `docs/tech-stack.md`: every tool with its version and state, and the commands to run.
- `docs/pf-capability-sheet.md`: how the PF conversation API really behaves. Read it before touching anything that talks to PF.
- `docs/government-readiness.md`: what UK customers require.

## How to work

- Use the ponytail skill at level full for all code: the smallest change that fully solves the task.
- Load the impeccable skill before designing or changing any user interface (loader, chat, admin console). The interface must not look machine-made.
- Every module ships with its tests, in the categories listed for it in the module breakdown. A task is finished only when its tests pass on the build machine and in the GitHub pipeline.
- Start each module in a new conversation with `/start-module`, for example `/start-module M1`.
- A hook in `.claude/settings.json` runs the publish scan before every push and blocks the push if the scan finds anything.

## Branches

Work flows from `feature/mNN-topic` to `module/mNN-name` to `develop` to `main`.

- Never commit directly to a module branch, `develop` or `main`.
- Bring a module branch up to date with `develop` before starting work on it.
- Merge a feature pull request into its module branch yourself once the pipeline is green.
- Merging into `develop` or `main` needs the user's word.

## Rules

- **The repository is public.** Run `python scripts/scan-tracked-files.py` before every push. Never commit `.env`, anything under `.tools/` or `spikes/pf_capture_out/`, PF identifiers, or AWS account numbers.
- **Nothing about PF reaches the browser (R13).** No PF address, workspace, agent or conversation ID, token or raw error. Build every payload sent to the browser from an allow-list.
- **Everything stays inside this folder.** Local tools, the local database and the test browsers live in `.tools/`. Do not create folders elsewhere on the machine.
- **Never read or print `.env`.** Scripts load it themselves.
- **AWS development resources** are in `us-east-1`, are named `ucp-dev-*`, and every role carries the `ucp-dev-boundary` permissions boundary.
- **The build machine has no Docker.** Container images are built only in the GitHub pipeline.

## Most used commands

Run from the repository root in Git Bash. The full list is in `docs/tech-stack.md`.

| Task | Command |
|---|---|
| Backend lint | `cd backend && uv run ruff check . && uv run ruff format --check .` |
| Backend tests | `cd backend && bash ../scripts/with-localdb.sh uv run --env-file ../.env pytest` |
| Web checks | `npm run typecheck && npm test && npm run build` |
| Browser tests | `npm run build && npm run e2e` |
| Publish scan | `python scripts/scan-tracked-files.py` |
