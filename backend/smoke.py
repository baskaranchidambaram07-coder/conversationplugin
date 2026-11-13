"""The smoke suite after each release (M14-T5): health, the public configuration, an anonymous turn and a signed-in
turn, against a deployed gateway, answered by its real agent.

    cd backend && uv run python smoke.py https://….cloudfront.net w_smoke

The signed-in turn signs a host token as a customer's backend would, with the smoke widget's shared secret:
UCP_SMOKE_SECRET ("id:secret"), or else read from Secrets Manager (ucp-dev/host-secrets) with the AWS command line.
Prints each step; exits non-zero, naming the step, at the first thing wrong. Costs two answers from the agent.
"""

import json
import os
import secrets
import subprocess
import sys
import time

import httpx2
import jwt

import journey
from journey import step
from ucp.protocol import ADAPTERS, Conversation, Session

EVENTS = ADAPTERS["StreamEvent"]
ISSUER = "https://smoke.ucp.invalid"  # as the smoke widget's identity settings say (deploy/widgets.dev.json)


def smoke_secret() -> tuple[str, str]:
    value = os.environ.get("UCP_SMOKE_SECRET")
    if not value:
        stored = subprocess.run(
            [
                "aws",
                "secretsmanager",
                "get-secret-value",
                "--secret-id",
                "ucp-dev/host-secrets",
                "--query",
                "SecretString",
                "--output",
                "text",
                "--region",
                "us-east-1",
            ],
            check=True,
            text=True,
            capture_output=True,
        ).stdout
        value = json.loads(stored)["smoke"].split(",")[0]
    kid, secret = value.split(":", 1)
    return kid, secret


def signed_in_turn(http: httpx2.Client, widget_id: str) -> None:
    kid, secret = smoke_secret()
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": widget_id,
        "sub": "smoke-resident",
        "iat": now,
        "exp": now + 300,
        "jti": secrets.token_urlsafe(16),
    }
    token = jwt.encode(claims, secret, algorithm="HS256", headers={"kid": kid})
    reply = http.post("/v1/sessions", json={"widget_id": widget_id, "host_token": token})
    step("a signed-in visitor's session starts from a host token", reply.status_code == 200)
    auth = {"authorization": f"Bearer {Session.model_validate_json(reply.content).token}"}
    conversation = Conversation.model_validate_json(http.post("/v1/conversations", headers=auth).content)
    body = {"text": "Reply with the single word READY.", "client_message_id": f"smoke_{secrets.token_hex(4)}"}
    with http.stream(
        "POST",
        f"/v1/conversations/{conversation.id}/messages",
        json=body,
        headers={**auth, "accept": "text/event-stream"},
    ) as streamed:
        events = [EVENTS.validate_json(line[6:]) for line in streamed.iter_lines() if line.startswith("data: ")]
    step("the signed-in visitor's question is answered", bool(events) and events[-1].type == "message.completed")


def main(base_url: str, widget_id: str) -> None:
    with httpx2.Client(base_url=base_url, timeout=httpx2.Timeout(10, read=120)) as http:
        step("the gateway is up", http.get("/healthz").status_code == 200)
        step("the gateway reaches its database", http.get("/readyz").status_code == 200)
        step("the loader is served", http.get("/loader.js").status_code == 200)
        journey.main(base_url, widget_id)  # the public configuration and an anonymous turn, step by step
        signed_in_turn(http, widget_id)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python smoke.py <gateway URL> <widget ID>")
    main(*sys.argv[1:])
