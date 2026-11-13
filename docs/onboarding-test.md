# The timed onboarding test (M15-T6)

Once each release, an engineer who has never seen the product adds the assistant to a public page and to a
signed-in portal, using only the public guides. We time each step and write down every point where they got stuck.
The test passes when both runs finish inside the hour (the budget is in section 5 of
[the module breakdown](module-breakdown.md)).

## Before the run (the operator, not timed)

1. Wake the dev environment: `python infra/aws/dev.py wake`.
2. Ask the engineer where their pages will be served from, for example `http://localhost:8080` on their own machine
   or a test site of theirs on `https://`.
3. Make their widget. Until the console exists (M9), this takes the place of "create the widget in the console", so
   time it apart from the engineer's run:
   - `cd backend && uv run python -m ucp.widgets new-id` gives the widget ID;
   - add an entry to `backend/deploy/widgets.dev.json`, copied from the College's, with the engineer's site in
     `allowed_domains` and a new secret name in `identity.secret`;
   - `cd backend && uv run python ../infra/aws/secret_store.py host-secret NAME` makes the shared secret;
   - `python infra/aws/deploy.py` publishes the widget and reloads the secrets.
4. Give the engineer the values in the table in [the College's guide](college-sandbox-guide.md), and these
   documents only:
   - [the College's guide](college-sandbox-guide.md);
   - [the samples](../examples/college);
   - [the token-signing guide](../examples/token-signing/README.md).

## The run (the engineer, timed)

| Run | Clock starts | Clock stops |
|---|---|---|
| Public page | They open the guide | A question they typed on their own page is answered |
| Portal | They start on the portal part | A question asked while signed in on their portal is answered, and comes back in "Your chats" after a reload |

The engineer works alone and thinks aloud. The operator watches without helping. If the engineer is stuck for ten
minutes, the operator may answer one question, and that counts as a point of friction.

## What to write down

For each run: the date, the release (`python infra/aws/deploy.py --url` and the revision `deploy.py` printed), the
engineer's language and framework, the start and stop times, and for each point of friction:

- the time;
- what they were trying to do;
- what they expected and what happened (the `UCP:` console lines, if any);
- what we change: the guide, the samples, or the product.

Add the result to the table below. Make each change before the next release.

| Date | Release | Public page | Portal | Points of friction | Changes made |
|---|---|---|---|---|---|
| (first run to come) | | | | | |
