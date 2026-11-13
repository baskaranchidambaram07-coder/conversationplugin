"""The API journey (M4 end-to-end): one visitor's path through a running gateway, checking every reply against the
message format. It runs against any gateway, local or deployed, so it is also the smoke test after a deployment.

    cd backend && uv run python journey.py http://localhost:8200 w_gateway

Prints each step; exits non-zero, naming the step, at the first thing wrong. It asks one question, so against a
real agent it costs one answer.
"""

import secrets
import sys

import httpx2

from ucp.protocol import ADAPTERS, ApiError, Conversation, ConversationPage, Message, MessagePage, Session, WidgetConfig

EVENTS = ADAPTERS["StreamEvent"]


def step(name: str, ok: bool) -> None:
    print(f"{'ok' if ok else 'FAILED'}  {name}")
    if not ok:
        sys.exit(1)


def ask(http: httpx2.Client, path: str, key: str, auth: dict) -> list:
    body = {"text": "Hello from the API journey", "client_message_id": key}
    with http.stream("POST", path, json=body, headers={**auth, "accept": "text/event-stream"}) as reply:
        reply.raise_for_status()
        return [EVENTS.validate_json(line[6:]) for line in reply.iter_lines() if line.startswith("data: ")]


def main(base_url: str, widget_id: str) -> None:
    with httpx2.Client(base_url=base_url, timeout=httpx2.Timeout(10, read=120)) as http:
        config = WidgetConfig.model_validate_json(http.get(f"/v1/widgets/{widget_id}/config").content)
        step("the widget's public settings are in the message format", config.widget_id == widget_id)

        reply = http.post("/v1/sessions", json={"widget_id": widget_id, "host_token": None})
        auth = {"authorization": f"Bearer {Session.model_validate_json(reply.content).token}"}
        step("an anonymous session starts", reply.status_code == 200)

        refused = http.get("/v1/conversations")
        step("without the session, nothing", ApiError.model_validate_json(refused.content).code == "session_expired")

        conversation = Conversation.model_validate_json(http.post("/v1/conversations", headers=auth).content)
        step("a conversation starts", conversation.title is None)

        path = f"/v1/conversations/{conversation.id}/messages"
        key = f"journey_{secrets.token_hex(4)}"
        events = ask(http, path, key, auth)
        kinds = [event.type for event in events]
        step(
            "the answer streams from started to completed",
            kinds[0] == "message.started" and kinds[-1] == "message.completed",
        )
        step("its events are numbered in order", [event.seq for event in events] == list(range(len(events))))
        answer = next(event.block.text for event in events if event.type == "content_block.completed")

        stored = Message.model_validate_json(http.get(f"{path}/{events[0].message_id}", headers=auth).content)
        step("the answer is stored as it was streamed", stored.status == "complete" and stored.blocks[0].text == answer)

        again = ask(http, path, key, auth)
        step("the same question again returns the same answer", again[0].message_id == events[0].message_id)

        page = MessagePage.model_validate_json(http.get(path, headers=auth).content)
        step(
            "the conversation reads back, question then answer",
            [m.role for m in page.messages] == ["user", "assistant"],
        )

        listed = ConversationPage.model_validate_json(http.get("/v1/conversations", headers=auth).content)
        step("the conversation is in the visitor's list", conversation.id in [c.id for c in listed.conversations])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python journey.py <gateway URL> <widget ID>")
    main(*sys.argv[1:])
