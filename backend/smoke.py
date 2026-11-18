"""The smoke suite after each release (M14-T5): health, the public configuration, an anonymous turn, a signed-in turn
and, where the widget takes attachments, the virus scan and a document the agent reads, against a deployed gateway,
answered by its real agent.

    cd backend && uv run python smoke.py https://….cloudfront.net w_smoke

The signed-in turn signs a host token as a customer's backend would, with the smoke widget's shared secret:
UCP_SMOKE_SECRET ("id:secret"), or else read from Secrets Manager (ucp-dev/host-secrets) with the AWS command line.
Prints each step; exits non-zero, naming the step, at the first thing wrong. Costs three answers from the agent.
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
from fakescan import infected_word_document, word_document
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


def files_turn(http: httpx2.Client, widget_id: str) -> None:
    """On a widget that takes attachments: the scanner beside the gateway refuses the test virus, and a clean document
    reaches the agent, which reads it."""
    if not http.get(f"/v1/widgets/{widget_id}/config").json().get("attachments_enabled"):
        print("  (the widget takes no attachments: the scanner was not checked)")
        return
    start = http.post("/v1/sessions", json={"widget_id": widget_id, "host_token": None})
    auth = {"authorization": f"Bearer {Session.model_validate_json(start.content).token}"}
    conversation = Conversation.model_validate_json(http.post("/v1/conversations", headers=auth).content)
    url = f"/v1/conversations/{conversation.id}/files"

    def upload(data: bytes) -> httpx2.Response:
        return http.post(url, params={"name": "smoke.docx"}, content=data, headers=auth)

    deadline = time.monotonic() + 300
    while (refused := upload(infected_word_document())).status_code == 503 and time.monotonic() < deadline:
        time.sleep(10)  # after a release the scanner loads its signatures for a minute or two; uploads wait for it
    step("the scanner refuses the test virus hidden in a Word document", refused.status_code == 422)
    kept = upload(word_document("The smoke word is HELIOTROPE."))
    step("a clean document is scanned and kept", kept.status_code == 201)
    body = {
        "text": "What is the smoke word in the attached document? Reply with it alone.",
        "client_message_id": f"smoke_{secrets.token_hex(4)}",
        "attachments": [kept.json()["id"]],
    }
    with http.stream(
        "POST",
        f"/v1/conversations/{conversation.id}/messages",
        json=body,
        headers={**auth, "accept": "text/event-stream"},
    ) as streamed:
        events = [EVENTS.validate_json(line[6:]) for line in streamed.iter_lines() if line.startswith("data: ")]
    answer = next((event.block.text for event in events if event.type == "content_block.completed"), "")
    step("the agent read the document", "HELIOTROPE" in answer.upper())


def main(base_url: str, widget_id: str) -> None:
    with httpx2.Client(base_url=base_url, timeout=httpx2.Timeout(10, read=240)) as http:
        step("the gateway is up", http.get("/healthz").status_code == 200)
        step("the gateway reaches its database", http.get("/readyz").status_code == 200)
        step("the loader is served", http.get("/loader.js").status_code == 200)
        journey.main(base_url, widget_id)  # the public configuration and an anonymous turn, step by step
        signed_in_turn(http, widget_id)
        files_turn(http, widget_id)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python smoke.py <gateway URL> <widget ID>")
    main(*sys.argv[1:])
