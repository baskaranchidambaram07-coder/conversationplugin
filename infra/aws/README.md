# The dev environment on AWS: runbook

The conversation gateway in the US development account (`us-east-1`), on addresses AWS provides. It runs **on demand**: wake it to use it, put it to sleep to stop paying for it. Everything is named `ucp-dev*`, and every role carries the `ucp-dev-boundary` permissions boundary (see `iam/`).

Run every command from the repository root, in Git Bash, with the AWS command line signed in as the deploying user (`service-commandline-user`). Terraform comes from `.tools/terraform`. No command prints a secret or the account number.

## What runs where

| Part | Awake | Asleep |
|---|---|---|
| CloudFront: HTTPS on its own `*.cloudfront.net` address, which the customer's script tag uses | Serves the loader, the chat and the API; caches the chat's files | Stays, so the address never changes; answers with an error |
| Load balancer: reachable only from CloudFront, which proves itself with a secret header | Runs | Removed |
| Gateway: one container on Fargate, in a public subnet with no inbound except from the load balancer | Runs | Removed (the cluster, the release and the images stay) |
| PostgreSQL 17: private, encrypted, seven days of point-in-time backups | Runs | Stopped (AWS starts it again after seven days; `sleep` stops it again) |
| Secrets Manager `ucp-dev/*`, image registry, logs, network | Stay | Stay |

Roughly, from list prices as remembered and not checked: about US$0.09 an hour awake, about US$5 a month asleep.

## Every day

| To | Run | Takes |
|---|---|---|
| See what is running, and the address | `python infra/aws/dev.py status` | seconds |
| Wake it: database on, load balancer and gateway up, newest release out, migrations, the widget file, the PF check | `python infra/aws/dev.py wake` | about 10 minutes |
| Put it to sleep | `python infra/aws/dev.py sleep` | about 5 minutes |
| Check it from outside: health, configuration, an anonymous and a signed-in turn | `cd backend && uv run python smoke.py <address> w_smoke` | a minute |

A plain `terraform apply` without `-var=awake=true` puts the environment to sleep: always go through `dev.py`.

## Releasing

Every push to `develop` runs `.github/workflows/deploy-dev.yml`. It builds the image, scans it (fixable high and critical flaws stop it), and stores it under its commit's tag. Then it runs `deploy.py`:

1. a new release of that image;
2. the database migrations;
3. the widget file `backend/deploy/widgets.dev.json`, published with the run's actor in the audit log;
4. the service rolled over (if the new release never becomes healthy, the container service goes back to the one before by itself);
5. the PF connection check;
6. the smoke test.

While the environment sleeps, the image is stored and the release goes out on the next `wake`.

To release by hand, or **to roll back** to an earlier image, give its commit:

```
python infra/aws/deploy.py --image <commit> --by "<your name>"
```

The loader and the chat are in the image, so rolling back the application rolls them back too. Widget configuration has its own history: `python -m ucp.widgets versions` and `rollback` (see `docs/tech-stack.md`), run as a one-off task or by releasing a changed `widgets.dev.json`.

## Secrets

| Secret | Holds | Set by |
|---|---|---|
| `ucp-dev/database-url` | The gateway's database connection | Terraform, once, write-only (never in the state) |
| `ucp-dev/session-keys` | The keys that sign visitors' sessions | Terraform, once; `secret_store.py session-keys` to rotate |
| `ucp-dev/host-secrets` | The shared secrets of signed-in sites (`smoke` for the smoke test) | Terraform for `smoke`; `secret_store.py host-secret NAME` for a customer |
| `ucp-dev/agent-profiles` | The PF staging connection profile `pf-staging` | `secret_store.py agent-profiles`, from the `PF_*` settings in `.env` |

```
cd backend && uv run --env-file ../.env python ../infra/aws/secret_store.py agent-profiles
cd backend && uv run python ../infra/aws/secret_store.py session-keys
cd backend && uv run python ../infra/aws/secret_store.py host-secret college --rotate
```

The gateway reads its secrets when it starts, so release again after a change: `python infra/aws/deploy.py`. Rotating keeps the previous key valid beside the new one until the next rotation. A customer can switch to a new shared secret without a gap, and visitors' sessions in progress don't break.

## Restoring the database

Backups are taken every day and kept for seven days, with point-in-time restore. A restore makes a **new** database from the backup; the gateway is then pointed at it.

1. `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier ucp-dev-database --target-db-instance-identifier ucp-dev-restored --restore-time <UTC time> --db-subnet-group-name ucp-dev-database --vpc-security-group-ids <the ucp-dev-database group> --no-publicly-accessible`
2. `aws rds wait db-instance-available --db-instance-identifier ucp-dev-restored`
3. Check its data with a one-off task (see the rehearsal record in `docs/module-breakdown.md`, M14).
4. Either keep the restored database (rename the old one away and the restored one to `ucp-dev-database`, then release), or delete it: `aws rds delete-db-instance --db-instance-identifier ucp-dev-restored --skip-final-snapshot`.

## From nothing, and back to nothing

Building the environment from nothing:

1. `python infra/aws/dev.py bootstrap`: the encrypted, versioned bucket for Terraform's state, and Terraform's set-up. Its settings go to `dev/backend.hcl`, which git ignores.
2. `python infra/aws/dev.py plan --asleep`, then build asleep: `.tools/terraform/terraform.exe -chdir=infra/aws/dev apply -var=awake=false`.
3. `cd backend && uv run --env-file ../.env python ../infra/aws/secret_store.py agent-profiles`.
4. GitHub, for the pipeline:
   - secrets `AWS_DEPLOY_ROLE_ARN` (Terraform's output `deploy_role_arn`) and `AWS_ACCOUNT_ID` (only so the logs hide it);
   - variable `DEV_URL` (output `url`).
5. Push to `develop`: the pipeline stores the first image.
6. `python infra/aws/dev.py wake`.

Removing it all: `terraform -chdir=infra/aws/dev destroy -var=awake=false`. The deploying user may create GitHub's sign-in provider but not delete it, so first run `terraform -chdir=infra/aws/dev state rm aws_iam_openid_connect_provider.github` and ask an administrator to delete it (it costs nothing). The state bucket is removed last, from `bootstrap/`, once it has been emptied.

## Not in dev, by design

- **Production in London:** private subnets with NAT, a database across two zones, our own domain names and certificates (HTTPS to the load balancer too), and a web application firewall.
- **Needs an AWS administrator:** budget alerts and autoscaling, since the deploying user may not create either.
- **Not chosen for dev:** container insights, CloudFront and network flow logs, and encryption with our own keys, which carry cost or need key permissions.

The misconfiguration scan (`trivy config`, in the pipeline) records each of these decisions where it applies, inline in the Terraform.
