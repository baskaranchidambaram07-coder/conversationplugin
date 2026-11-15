# Conversation Plugin on AWS: setup guide

The Conversation Plugin puts a chat assistant on your website with one script tag. Visitors' questions are answered by your Purple Fabric agent. This bundle installs the whole service in your own AWS account: the chat's server, its database and an admin console where you set up your assistants. One script, `infra/aws/stack.py`, does every step.

Plan on about an hour for a first install, most of it waiting for AWS.

## What gets built

| Part | AWS service | Notes |
|---|---|---|
| Two web addresses, for the chat and for the admin console | Amazon CloudFront | HTTPS on addresses AWS provides, such as `https://d1234abcd.cloudfront.net` |
| Load balancer | Application Load Balancer | Only CloudFront can reach it, and only requests that carry CloudFront's secret header get through |
| The chat's server and the admin console's API | Amazon ECS on Fargate | One task (1 vCPU, 2 GB) running two containers. Only the load balancer can reach it. The image is pulled from GitHub's container registry, pinned to this version |
| Database | Amazon RDS for PostgreSQL 17 | Private, encrypted, with a standby in a second zone and 7 days of point-in-time backups |
| Secrets | AWS Secrets Manager | Under `NAME/`, where NAME is the name you choose in step 1 |
| Administrators' sign-in | Amazon Cognito | By invitation only, with an authenticator app required |
| Logs and alarms | Amazon CloudWatch | 14 days of logs, plus alarms for server errors and for no healthy server |
| Network | Amazon VPC | Its own network, `10.40.0.0/16`, across two zones |

Every resource's name starts with the name you choose, and every resource carries the tags `project=ucp` and `environment=<yours>`.

## Before you start

- **An AWS account and a region,** for example `eu-west-2` (London).
- **Someone with IAM administrator rights,** once, for step 2.
- **A computer** with:
  - Python 3.11 or later;
  - the AWS command line, version 2, signed in to the account;
  - Terraform 1.11 or later.

  Docker isn't needed.
- **Your Purple Fabric agent's connection details,** which you enter in the admin console in step 6. They are stored encrypted in the database and never reach a visitor's browser.
- **The first administrator's email address,** and an authenticator app on their phone.

Run every command from the bundle's folder, `conversation-plugin-aws-VERSION`. The examples use an environment called `prod`.

## 1. Choose your settings

Copy `infra/aws/environments/example.tfvars.json` to `infra/aws/environments/prod.tfvars.json`, and edit it:

| Setting | What it is | Example |
|---|---|---|
| `name` | The start of every resource's name: 4 to 20 lower-case letters, digits and hyphens, starting with a letter. It can't change once built | `ucp-prod` |
| `environment` | The `environment` tag on every resource. The access policies check it | `prod` |
| `region` | Where everything is built | `eu-west-2` |
| `gateway_cpu`, `gateway_memory` | The server's size (1024 is one vCPU; memory in MB) | `1024`, `2048` |
| `database_class` | The database's size | `db.t4g.small` |
| `database_multi_az` | A standby database in a second zone, which takes over if the first fails. It roughly doubles the database's cost | `true` |
| `protect_data` | The database and the administrators' sign-in pool refuse to be deleted | `true` |
| `image` | Leave it out. Set it only to run a copy of the image from your own registry (see "Using your own registry") | |

Every command below takes `--env prod`, the name of this file without `.tfvars.json`.

## 2. Give access to the person or machine that installs (AWS administrator, once)

Write the two access policies for your settings:

```
python infra/aws/stack.py --env prod policies
```

This writes `infra/aws/iam/out/ucp-prod-boundary.json` and `infra/aws/iam/out/ucp-prod-deployer.json`:

- **The deployer policy** lets the installing identity create and change only resources whose names start with your `name`, in your region.
- **The boundary policy** is a ceiling on every role the installation creates. The installation can't create a role without it.

An AWS administrator then creates both as **managed policies**, not inline policies. Their names must be exactly as shown. The deployer policy goes to the IAM user or role that will run the commands:

```
aws iam create-policy --policy-name ucp-prod-boundary --policy-document file://infra/aws/iam/out/ucp-prod-boundary.json
aws iam create-policy --policy-name ucp-prod-deployer --policy-document file://infra/aws/iam/out/ucp-prod-deployer.json
aws iam attach-user-policy --user-name <the installing user> --policy-arn arn:aws:iam::<account-id>:policy/ucp-prod-deployer
```

For a role, use `aws iam attach-role-policy --role-name <role>` instead of the last line.

If an administrator runs the installation themselves, the deployer policy isn't needed, but the boundary policy is: every role the installation makes refers to it by name.

## 3. Create the bucket for Terraform's state

```
python infra/aws/stack.py --env prod bootstrap
```

It takes about a minute. It creates an encrypted, versioned, private bucket named `ucp-prod-tfstate-…` for Terraform's record of what it built. It also writes two files beside your settings, `prod.backend.hcl` and `prod.bootstrap.tfstate`.

**Keep the whole `infra/aws/environments` folder.** Every later command needs it, including upgrades.

## 4. Build and start

```
python infra/aws/stack.py --env prod up
```

The first run takes about half an hour. Most of that is the database and its standby. When it finishes, it prints two addresses:

- **`awake at https://….cloudfront.net`:** the chat's address. The script tag on your pages loads from here.
- **`console at https://….cloudfront.net`:** the admin console.

Check that both answer:

```
python infra/aws/stack.py --env prod status
```

Both should say `answering (200)`. On a first install CloudFront can take up to 15 minutes to reach every location. If either says `not answering`, wait and try again.

## 5. Invite the first administrator

```
python infra/aws/stack.py --env prod admin you@example.com
```

This does two things:

- **It adds them to the sign-in pool.** Cognito emails them a temporary password, valid for 3 days, from `no-reply@verificationemail.com`; check spam if it doesn't arrive.
- **It makes them a platform administrator,** who can see and change every organisation.

At the console's address they sign in, choose a password, and set up their authenticator app. The password needs at least 14 characters, with upper and lower case, a digit and a symbol.

Invite more platform administrators the same way. Narrower roles, an organisation's administrator or a read-only viewer, are given through the admin API for now.

## 6. Set up your first assistant

In the admin console:

1. **New organisation:** the customer or department the assistant belongs to.
2. **New widget:** give it a title. The widget then shows its **Steps to go live**:
   - **Agent:** add a connection with your Purple Fabric agent's details, then use **Test** to check it.
   - **Sites:** the addresses of the sites that may show the chat, such as `https://www.example.com`. The chat stays blank anywhere else.
   - **Sign-in:** choose who may chat:
     - anyone;
     - only signed-in visitors, whose identity your site proves with a short token it signs. The shared secret is shown once: store it in your site's server, never in a page. The Install step has tested examples of signing a token in several languages.
   - **Look:** colours, logo, title, welcome text and suggested questions. A live preview shows the result and warns about colours that are hard to read.
   - **Install:** the script tag for your web team, and a check that a page carries it.
   - **Go live:** publish. Each publish is a version you can compare with another and roll back to.

To check a page while testing, add `data-debug` to the script tag. The browser's console then lists each step. Take it out before the page goes live.

## Everyday operation

| Task | How |
|---|---|
| What is running, and do the addresses answer | `python infra/aws/stack.py --env prod status` |
| Logs | CloudWatch log group `/ucp-prod/gateway`. Streams starting `gateway/` are the chat's, `admin/` the console's |
| Alarms | `ucp-prod-gateway-errors` (more than 5 server errors in 5 minutes) and `ucp-prod-gateway-unhealthy` (no healthy server for 5 minutes). To be notified, an administrator adds an SNS action to each |
| Restore the database | Automatic backups allow a restore to any moment in the last 7 days: in the RDS console, choose **Restore to point in time** |
| Rotate the key that signs visitors' sessions | Set `UCP_ENV=prod` (PowerShell: `$env:UCP_ENV="prod"`), run `python infra/aws/secret_store.py session-keys`, then `python infra/aws/stack.py --env prod up`. Sessions in progress keep working |
| Stop paying for a test environment | `python infra/aws/stack.py --env prod sleep` removes the server and the load balancer, and stops the database. The data, the secrets and both addresses stay, and the addresses answer "asleep". `up` starts it again. AWS restarts a stopped database after 7 days; `sleep` stops it again |

## Upgrading to a new version

1. Unzip the new bundle next to the old one.
2. Copy your `infra/aws/environments` folder from the old bundle into the new one. It holds your settings and the state bucket's details.
3. If the new version's notes mention changed access policies, run `policies` again. An administrator then publishes each file as a new version of its policy:

   ```
   aws iam create-policy-version --policy-arn arn:aws:iam::<account-id>:policy/ucp-prod-deployer --policy-document file://infra/aws/iam/out/ucp-prod-deployer.json --set-as-default
   ```

4. Optionally preview the changes with `python infra/aws/stack.py --env prod plan`. Then run `python infra/aws/stack.py --env prod up`.

The upgrade runs the database changes, then restarts the server one task at a time:

- **Visitors' open answers finish** before the old server stops.
- **A version that never becomes healthy** is replaced by the previous one automatically. `up` then says so.

## Removing everything

1. **Take a snapshot if you want to keep the data.** `teardown` deletes the database and its automatic backups. In the RDS console, choose **Actions**, then **Take snapshot**.
2. **If `protect_data` is `true`:** set it to `false` in your settings, then run `python infra/aws/stack.py --env prod sleep` to apply it.
3. **Run `python infra/aws/stack.py --env prod teardown`.** It removes everything except the state bucket.
4. **Clean up what remains:** empty and delete the `ucp-prod-tfstate-…` bucket in the S3 console. An administrator deletes the two policies.

## Using your own registry

By default the server's image is pulled from GitHub's container registry, pinned by its digest, so it can't change underneath you. To run it from your own Amazon ECR registry instead:

1. Copy the image named in `infra/aws/stack/release.auto.tfvars.json` into your registry, for example with `docker pull`, `docker tag` and `docker push`.
2. Set `image` in your settings to the copy, also pinned by digest: `<registry>/<repository>@sha256:…`.
3. Allow the task's start-up role, `ucp-prod-task-execution`, to pull from that repository. The installation already creates a repository named `ucp-prod-gateway` that it may pull from.

## What it costs

These are rough figures from AWS list prices, for `us-east-1` with the example settings. Other regions cost a little more. Check them with the AWS Pricing Calculator before you rely on them.

| Part | Roughly, per month |
|---|---|
| Server (Fargate, 1 vCPU and 2 GB, always on) | US$36 |
| Load balancer | US$20 |
| Database (`db.t4g.small` with a standby, 20 GB) | US$50 |
| Public IPv4 addresses (load balancer and server) | US$11 |
| Secrets, logs, alarms | US$5 |
| CloudFront and data transfer | Depends on traffic; small for text chat |
| Cognito, for a few administrators | Expected to be free |
| **Always on** | **about US$120 to 140** |
| **Asleep** | **about US$5 to 10** (storage, secrets and backups) |

## Security in brief

- **Purple Fabric stays private.** Nothing about it reaches a visitor's browser: no address, identifier, token or raw error. Connection credentials are sealed in the database with a key kept in Secrets Manager.
- **Each layer is reachable only from the one in front of it:** CloudFront to the load balancer, the load balancer to the server, the server to the database. The database has no route to the internet.
- **The server is locked down.** It runs as a non-root user on a read-only file system. Its image was scanned for known flaws when the version was published.
- **Administrators are invited, never signed up.** They need an authenticator app, and their console sessions end after an hour.
- **Not included in this version:**
  - your own domain names (the addresses are CloudFront's);
  - a web application firewall;
  - a private network with a NAT gateway for the server;
  - encryption with your own KMS keys;
  - signed images.

## If something goes wrong

| What you see | What to do |
|---|---|
| `no state bucket for prod yet` | Run `bootstrap` (step 3). After an upgrade, copy the `environments` folder across too |
| `AccessDenied` from Terraform or AWS | The deployer policy isn't attached, or your settings' `name`, `region` or `environment` differ from those the policies were written for. Run `policies` again, and have an administrator publish the files |
| `the release never became healthy` | The server went back to the previous version. The reason is in the logs (`/ucp-prod/gateway`) |
| The chat doesn't appear on a page | Add `data-debug` to the script tag and read the browser's console. Usually the page's address isn't in the widget's **Sites**, the widget isn't live, or the environment is asleep |
| The first administrator's temporary password expired | `aws cognito-idp admin-create-user --user-pool-id <pool id> --username you@example.com --message-action RESEND --region <region>`. The pool's ID is in the Cognito console, under the pool `ucp-prod-admins` |
| `status` says the database is `available` while asleep | AWS restarted it after 7 days. Run `sleep` again |

When asking for help, send the output of `status` and of the command that failed. None of the commands prints a secret or your account number.
