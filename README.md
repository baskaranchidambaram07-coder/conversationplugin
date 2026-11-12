# Conversation Plugin

An embeddable chat assistant that any website can add with one script tag, in under 60 minutes.

Status: planning complete, build starting. Target: a base version in the development environment by 22 November 2026.

## Documents

- `docs/module-breakdown.md`: requirements, design decisions, and modules M0 to M15 with their tasks and tests
- `docs/pf-capability-sheet.md`: observed behaviour of the agent platform's conversation API
- `docs/government-readiness.md`: what UK public-sector and regulated customers require
- `docs/tech-stack.md`: the technology and infrastructure stack, its state, and the commands to run it
- `docs/threat-model.md`: what we protect, from whom, and which control and test answers each threat
- `docs/supported-browsers.md`: the browsers, devices and conditions the widget supports, and how each is tested
- `infra/aws/iam/`: the AWS policies for the development environment

## Branches

| Branch | Purpose |
|---|---|
| `main` | Released code only. Carries the release notes and the installation package. |
| `develop` | Integration of finished module work. Used for internal testing. |
| `module/mNN-name` | One per module. Holds that module's components. |
| `feature/mNN-topic` | Day-to-day work. Cut from its module branch and merged back into it by pull request. |

The flow is feature branch, then module branch, then `develop`, then `main`.

1. Before starting work on a module, bring its module branch up to date with `develop`.
2. Cut a feature branch from the module branch and open a pull request back into it.
3. Merge the module branch into `develop` when the module's tests pass.
4. Release by merging `develop` into `main` and tagging the release.

## Module branches

| Branch | Module |
|---|---|
| `module/m00-foundations` | Foundations and contracts |
| `module/m01-embed-loader` | Embed loader |
| `module/m02-conversation-ui` | Conversation UI |
| `module/m03-rendering-engine` | Response rendering engine |
| `module/m04-conversation-gateway` | Conversation gateway |
| `module/m05-identity-session` | Identity and session |
| `module/m06-pf-connector` | Agent platform connector |
| `module/m07-history-persistence` | History and persistence |
| `module/m08-control-plane` | Control plane API |
| `module/m09-admin-console` | Admin console |
| `module/m10-attachments` | Attachments |
| `module/m11-voice` | Voice |
| `module/m12-security-compliance` | Security and compliance |
| `module/m13-observability` | Observability and analytics |
| `module/m14-cloud-deployment` | Cloud platform and deployment |
| `module/m15-developer-experience` | Developer experience and onboarding |
