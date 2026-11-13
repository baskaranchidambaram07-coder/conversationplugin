"""Conversations and turns through the gateway, with PostgreSQL and the fake PF (M4 integration and backend tests)."""

import asyncio
import json
import re
import secrets
import time

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from fakepf.app import FINAL
from tests.test_public import document
from tests.test_sessions import KEYS
from ucp.gateway.app import create_app
from ucp.protocol import ADAPTERS, Message
from ucp.settings import Settings
from ucp.store import Store
from ucp.turns import Breaker, Turns
from ucp.widgets import seed

EVENTS = ADAPTERS["StreamEvent"]
PF_ID = re.compile(r"[0-9a-f]{24}|00000000-0000-4000|fake-agent|fake-workspace")


def pf_profile(base_url: str) -> dict:
    return {
        "base_url": base_url,
        "tenant": "fake-tenant",
        "workspace_id": "fake-workspace",
        "agent_version_id": "fake-agent-version",
        "api_key": "fake-api-key",
        "username": "fake-user",
        "password": "fake-password",
    }


@pytest.fixture
def widgets(database_url):
    ids = {name: f"w_{secrets.token_hex(4)}" for name in ("open", "chatty", "single", "broken")}
    documents = {
        ids["open"]: document(agent_profile="fake"),
        ids["chatty"]: document(agent_profile="fake", limits={"messages_per_minute_per_session": 2}),
        ids["single"]: document(
            tenant_id=f"t_{secrets.token_hex(4)}", agent_profile="fake", limits={"concurrent_turns": 1}
        ),
        ids["broken"]: document(agent_profile="nowhere"),
    }

    async def publish():
        engine = create_async_engine(database_url)
        await seed(Store(engine), documents)
        await engine.dispose()

    asyncio.run(publish())
    return ids


def settings_for(database_url: str, fake_pf: str) -> Settings:
    profiles = {"fake": pf_profile(fake_pf), "nowhere": pf_profile("http://127.0.0.1:9")}
    return Settings(database_url=database_url, session_keys=KEYS, agent_profiles=json.dumps(profiles))


@pytest.fixture
def gateway(database_url, fake_pf):
    with TestClient(create_app(settings_for(database_url, fake_pf)), base_url="https://chat.example.net") as client:
        yield client


class Visitor:
    """A chat, as the widget drives the gateway."""

    def __init__(self, client: TestClient, widget_id: str):
        self.client = client
        token = client.post("/v1/sessions", json={"widget_id": widget_id, "host_token": None}).json()["token"]
        self.headers = {"authorization": f"Bearer {token}"}

    def conversation(self) -> str:
        response = self.client.post("/v1/conversations", headers=self.headers)
        assert response.status_code == 201
        return response.json()["id"]

    def ask(self, conversation: str, text: str, key: str | None = None, **headers):
        body = {"text": text, "client_message_id": key or f"k_{secrets.token_hex(4)}"}
        url = f"/v1/conversations/{conversation}/messages"
        return self.client.post(url, json=body, headers={**self.headers, **headers})

    def get(self, path: str):
        return self.client.get(path, headers=self.headers)


def events(response) -> list:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    lines = [line for line in response.text.split("\n\n") if line]
    return [EVENTS.validate_json(line.removeprefix("data: ")) for line in lines if line.startswith("data: ")]


def wait_for(visitor: Visitor, conversation: str, message_id: str) -> Message:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        message = Message.model_validate_json(
            visitor.get(f"/v1/conversations/{conversation}/messages/{message_id}").content
        )
        if message.status != "in_progress":
            return message
        time.sleep(0.05)
    raise AssertionError("the answer was never stored")


def test_an_answer_streams_in_our_format_only_and_is_stored_as_it_was_sent(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()

    response = visitor.ask(conversation, "Explain HTTPS [long]")
    stream = events(response)

    kinds = [event.type for event in stream]
    assert kinds[:2] == ["message.started", "content_block.started"] and kinds[-2:] == [
        "content_block.completed",
        "message.completed",
    ]
    assert set(kinds[2:-2]) == {"content_block.delta"} and len(kinds) > 100
    assert [event.seq for event in stream] == list(range(len(stream)))
    assert len({(event.message_id, event.correlation_id) for event in stream}) == 1
    assert "".join(event.text for event in stream[2:-2]) == stream[-2].block.text == FINAL["long"]["response"]
    assert response.text.startswith(": ping") and not PF_ID.search(response.text)
    stored = wait_for(visitor, conversation, stream[0].message_id)
    assert stored.status == "complete" and stored.blocks[0].text == FINAL["long"]["response"]


def test_a_failure_part_way_is_reported_and_stored_with_the_part_already_streamed(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()

    stream = events(visitor.ask(conversation, "Explain [error]"))

    failed = stream[-1]
    assert failed.type == "message.failed" and (failed.error.code, failed.error.retryable) == (
        "assistant_unavailable",
        True,
    )
    pieces = "".join(event.text for event in stream if event.type == "content_block.delta")
    stored = wait_for(visitor, conversation, failed.message_id)
    assert (
        stored.status == "failed" and stored.blocks[0].text == pieces and stored.error.code == "assistant_unavailable"
    )


def test_internal_details_pf_adds_and_its_raw_errors_never_reach_the_visitor(gateway, widgets):
    # R13 and M6-T5: whatever PF puts in its events, the visitor gets our format with the answer text and no more.
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()

    answered = visitor.ask(conversation, "Hello [seeded]")
    stream = events(answered)
    wait_for(visitor, conversation, stream[0].message_id)
    failed = visitor.ask(conversation, "Hello [error]")
    wait_for(visitor, conversation, events(failed)[0].message_id)
    later = visitor.get(f"/v1/conversations/{conversation}/messages").text + visitor.get("/v1/conversations").text

    assert stream[-2].block.text == FINAL["short"]["response"]
    for seen in (answered.text, failed.text, later):
        assert not re.search(r"SEEDED|10\.20\.30\.40|pf-internal|Unable to process|status_code", seen)
        assert not PF_ID.search(seen)


def test_the_same_question_sent_again_gets_the_same_answer_not_a_second_one(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()

    first = events(visitor.ask(conversation, "Hello", key="k_same"))
    again = events(visitor.ask(conversation, "Hello", key="k_same"))

    assert again[0].message_id == first[0].message_id
    assert [event.type for event in again] == [
        "message.started",
        "content_block.started",
        "content_block.completed",
        "message.completed",
    ]
    assert again[-2].block.text == first[-2].block.text == FINAL["short"]["response"]
    page = visitor.get(f"/v1/conversations/{conversation}/messages").json()
    assert len(page["messages"]) == 2


def test_a_second_question_while_an_answer_is_on_its_way_is_refused(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()
    url = f"/v1/conversations/{conversation}/messages"

    with gateway.stream(
        "POST", url, json={"text": "Hi [slow]", "client_message_id": "k_1"}, headers=visitor.headers
    ) as slow:
        next(slow.iter_lines())
        refused = visitor.ask(conversation, "And another thing")

    assert refused.status_code == 409 and refused.json()["code"] == "turn_in_progress"


def test_a_visitor_who_leaves_mid_answer_still_finds_the_whole_answer_stored(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()
    url = f"/v1/conversations/{conversation}/messages"

    body = {"text": "Explain HTTPS [long]", "client_message_id": "k_1"}
    with gateway.stream("POST", url, json=body, headers=visitor.headers) as response:
        first = next(line for line in response.iter_lines() if line.startswith("data: "))
    message_id = EVENTS.validate_json(first.removeprefix("data: ")).message_id

    stored = wait_for(visitor, conversation, message_id)
    assert stored.status == "complete" and stored.blocks[0].text == FINAL["long"]["response"]


def test_an_expired_pf_token_is_renewed_without_the_visitor_noticing(gateway, widgets, fake_pf):
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()
    events(visitor.ask(conversation, "Hello"))
    httpx2.post(f"{fake_pf}/_fake/expire-tokens")

    assert events(visitor.ask(conversation, "Hello again"))[-1].type == "message.completed"


def test_a_caller_that_cannot_read_streams_gets_the_whole_answer_as_one_message(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()

    response = visitor.ask(conversation, "Hello", accept="application/json")

    message = Message.model_validate_json(response.content)
    assert (message.role, message.status, message.blocks[0].text) == (
        "assistant",
        "complete",
        FINAL["short"]["response"],
    )


def test_another_visitors_conversation_is_not_found_by_any_route(gateway, widgets):
    owner, stranger = Visitor(gateway, widgets["open"]), Visitor(gateway, widgets["open"])
    conversation = owner.conversation()
    answer = events(owner.ask(conversation, "Hello"))[0].message_id

    for response in (
        stranger.ask(conversation, "Let me in"),
        stranger.get(f"/v1/conversations/{conversation}/messages"),
        stranger.get(f"/v1/conversations/{conversation}/messages/{answer}"),
    ):
        assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert stranger.get("/v1/conversations").json() == {"conversations": [], "next": None}


def test_conversations_and_messages_come_in_pages(gateway, widgets):
    visitor = Visitor(gateway, widgets["open"])
    conversations = [visitor.conversation() for _ in range(3)]
    for n in range(3):
        events(visitor.ask(conversations[0], f"Question {n}"))

    first = visitor.get("/v1/conversations?limit=2").json()
    rest = visitor.get(f"/v1/conversations?limit=2&before={first['next']}").json()
    newest = visitor.get(f"/v1/conversations/{conversations[0]}/messages?limit=4").json()
    oldest = visitor.get(f"/v1/conversations/{conversations[0]}/messages?limit=4&before={newest['next']}").json()

    assert [c["id"] for c in first["conversations"] + rest["conversations"]] == [
        conversations[0],
        conversations[2],
        conversations[1],
    ]
    assert first["conversations"][0]["title"] == "Question 0" and rest["next"] is None
    assert [m["role"] for m in oldest["messages"] + newest["messages"]] == ["user", "assistant"] * 3
    assert oldest["next"] is None
    for cursor in ("not%20a%20date", "2026-11-13T09:00:00Z", "2026-11-13T09:00:00_c_x", "yesterday_c_x"):
        assert visitor.get(f"/v1/conversations?before={cursor}").status_code == 400


def test_history_survives_a_gateway_restart(database_url, fake_pf, widgets):
    settings = settings_for(database_url, fake_pf)
    with TestClient(create_app(settings), base_url="https://chat.example.net") as before:
        visitor = Visitor(before, widgets["open"])
        conversation = visitor.conversation()
        wait_for(visitor, conversation, events(visitor.ask(conversation, "Hello"))[0].message_id)

    with TestClient(create_app(settings), base_url="https://chat.example.net") as after:
        listed = after.get("/v1/conversations", headers=visitor.headers).json()
        page = after.get(f"/v1/conversations/{conversation}/messages", headers=visitor.headers).json()

    assert [c["id"] for c in listed["conversations"]] == [conversation]
    assert [(m["role"], m["status"]) for m in page["messages"]] == [("user", "complete"), ("assistant", "complete")]
    assert page["messages"][1]["blocks"][0]["text"] == FINAL["short"]["response"]


def test_no_first_word_within_the_limit_fails_the_answer(gateway, widgets):
    gateway.app.state.turns = Turns(gateway.app.state.store, first_word=0.2)
    visitor = Visitor(gateway, widgets["open"])
    conversation = visitor.conversation()

    stream = events(visitor.ask(conversation, "Hi [slow]"))

    assert stream[-1].type == "message.failed" and stream[-1].error.code == "assistant_unavailable"
    assert wait_for(visitor, conversation, stream[0].message_id).status == "failed"


def test_quiet_spells_are_filled_with_heartbeats(gateway, widgets):
    gateway.app.state.turns = Turns(gateway.app.state.store, heartbeat=0.05)
    visitor = Visitor(gateway, widgets["open"])

    response = visitor.ask(visitor.conversation(), "Hi [slow]")

    assert response.text.count(": ping") > 3


def test_the_circuit_opens_after_failures_in_a_row_and_lets_a_turn_try_again_after_the_cooldown(gateway, widgets):
    gateway.app.state.turns = Turns(gateway.app.state.store, retry_wait=0, breaker=(2, 0.5))
    visitor = Visitor(gateway, widgets["broken"])

    for _ in range(2):
        assert events(visitor.ask(visitor.conversation(), "Hello"))[-1].type == "message.failed"
    refused = visitor.ask(visitor.conversation(), "Hello")
    assert refused.status_code == 503 and refused.json()["retryable"] and int(refused.headers["retry-after"]) >= 1

    time.sleep(0.6)
    assert visitor.ask(visitor.conversation(), "Hello").status_code == 200


def test_messages_per_session_are_limited(gateway, widgets):
    visitor = Visitor(gateway, widgets["chatty"])
    conversation = visitor.conversation()

    assert [visitor.ask(conversation, f"Q{n}").status_code for n in range(2)] == [200, 200]
    refused = visitor.ask(conversation, "Q3")
    assert refused.status_code == 429 and refused.json()["code"] == "rate_limited"


def test_a_tenant_gets_only_its_share_of_turns_running_at_once(gateway, widgets):
    one, two = Visitor(gateway, widgets["single"]), Visitor(gateway, widgets["single"])
    url = f"/v1/conversations/{one.conversation()}/messages"

    with gateway.stream(
        "POST", url, json={"text": "Hi [slow]", "client_message_id": "k_1"}, headers=one.headers
    ) as slow:
        next(slow.iter_lines())
        refused = two.ask(two.conversation(), "Me too")

    assert refused.status_code == 429 and refused.json()["code"] == "rate_limited"


def test_a_widget_whose_agent_profile_is_missing_is_unavailable_not_broken(database_url, widgets):
    with TestClient(create_app(Settings(database_url=database_url, session_keys=KEYS))) as client:
        visitor = Visitor(client, widgets["open"])
        response = visitor.ask(visitor.conversation(), "Hello")

    assert response.status_code == 503 and response.json()["code"] == "assistant_unavailable"


def test_the_breaker_opens_on_the_threshold_and_closes_on_a_success():
    breaker = Breaker(threshold=2, cooldown=30)

    breaker.record(False)
    assert breaker.retry_after() is None
    breaker.record(False)
    assert 29 <= breaker.retry_after() <= 30
    breaker.record(True)
    assert breaker.retry_after() is None and breaker.failures == 0
