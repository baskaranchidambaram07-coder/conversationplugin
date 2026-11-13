"""The PF connector against hand-made PF replies: what PF sends over the wire that the fake PF cannot easily stage
(split network reads, damaged events, early ends, each error status, the clock at the token's refresh point)."""

import json
from types import SimpleNamespace

import httpx2
import pytest

import ucp.pf
from fakepf.app import FINAL, RECORDED
from ucp.connector import Accepted, AgentError, Final, Text
from ucp.pf import PfConnector, PfProfile

pytestmark = pytest.mark.anyio

SECRETS = ("wire-api-key", "wire-password", "tok-")
LOGIN = {"result": "RESULT_SUCCESS", "access_token": "tok-1", "expires_in": "600"}  # PF sends durations as text
SHORT = [f"data: {data}\n\n" for _, data in RECORDED["short"][1]]
DETAILS = next(i for i, line in enumerate(SHORT) if '"MESSAGE_DETAILS"' in line)
FINAL_AT = next(i for i, line in enumerate(SHORT) if '"FINAL_RESPONSE"' in line)
PROFILE = PfProfile(
    base_url="https://pf.test",
    tenant="wire-tenant",
    workspace_id="wire-workspace",
    agent_version_id="wire-agent",
    api_key="wire-api-key",
    username="wire-user",
    password="wire-password",
)


class HandMadePf:
    """Answers each call from what a test sets, and keeps every request it was sent."""

    def __init__(self):
        self.requests: list[httpx2.Request] = []
        self.logins: list = [LOGIN]  # given in turn; the last one repeats
        self.stream: list[bytes] = ["".join(SHORT).encode()]  # the chunks the network delivers
        self.status = {"create": 201, "stream": 201}
        self.fetched = {"message_content": [{"status": "COMPLETED", "response": "fetched answer"}]}

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        path = request.url.path
        if "/accesstoken/" in path:
            reply = self.logins.pop(0) if len(self.logins) > 1 else self.logins[0]
            if isinstance(reply, Exception):
                raise reply
            return httpx2.Response(200, json=reply)
        if path.endswith("/create"):
            return httpx2.Response(self.status["create"], json={"conversation_details": {"conversation_id": "pf-c1"}})
        if path.endswith("/addmessage/stream"):

            async def chunks():
                for chunk in self.stream:
                    yield chunk

            return httpx2.Response(self.status["stream"], content=chunks())
        return httpx2.Response(200, json=self.fetched)

    def calls(self, part: str) -> list[httpx2.Request]:
        return [request for request in self.requests if part in request.url.path]


@pytest.fixture
def pf():
    return HandMadePf()


@pytest.fixture
async def connector(pf):
    async with httpx2.AsyncClient(transport=httpx2.MockTransport(pf)) as client:
        yield PfConnector(PROFILE, client, poll_seconds=0, recover_seconds=5)


async def answer(connector: PfConnector) -> list:
    return [event async for event in connector.send("pf-c1", "Hello")]


def shape(events: list) -> list[str]:
    return [type(event).__name__ for event in events]


async def test_our_calls_map_onto_pfs_fields_and_headers(pf, connector):
    await connector.create_conversation("c_ours")
    await answer(connector)

    login, create, send = pf.requests
    assert login.url.path == "/accesstoken/wire-tenant"
    assert (login.headers["apikey"], login.headers["username"], login.headers["password"]) == (
        "wire-api-key",
        "wire-user",
        "wire-password",
    )
    assert json.loads(create.content) == {"asset_version_id": "wire-agent", "conversation_name": "c_ours"}
    assert json.loads(send.content) == {"conversation_id": "pf-c1", "query": "Hello"}
    for call in (create, send):
        assert call.headers["authorization"] == "Bearer tok-1"
        assert (call.headers["apikey"], call.headers["x-platform-workspaceid"]) == ("wire-api-key", "wire-workspace")


async def test_the_token_is_kept_until_five_minutes_before_pf_says_it_expires(pf, connector, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(ucp.pf, "time", SimpleNamespace(monotonic=lambda: now[0]))

    await connector.create_conversation("c_1")  # logs in; PF says the token lasts 600 s
    now[0] += 299.9
    await connector.create_conversation("c_2")
    assert len(pf.calls("/accesstoken/")) == 1
    now[0] += 0.1  # 300 s left: inside the early-refresh window
    await connector.create_conversation("c_3")
    assert len(pf.calls("/accesstoken/")) == 2


async def test_pf_unreachable_at_login_is_retried_by_the_next_question(pf, connector):
    pf.logins = [httpx2.ConnectError("down"), LOGIN]

    with pytest.raises(AgentError) as refused:
        await connector.create_conversation("c_1")
    assert refused.value.retryable

    assert await connector.create_conversation("c_2") == "pf-c1"
    assert len(pf.calls("/accesstoken/")) == 2


async def test_refused_credentials_are_not_tried_again_for_five_minutes(pf, connector, monkeypatch):
    # PF's service account is shared by every widget on it, and repeated wrong passwords can lock it.
    now = [1000.0]
    monkeypatch.setattr(ucp.pf, "time", SimpleNamespace(monotonic=lambda: now[0]))
    pf.logins = [{"result": "RESULT_FAILURE", "message": "Invalid user credentials", "active": False}, LOGIN]

    for _ in range(3):
        with pytest.raises(AgentError) as refused:
            await connector.create_conversation("c_1")
        assert not refused.value.retryable
        assert shape(await answer(connector)) == ["Failed"]
    assert len(pf.calls("/accesstoken/")) == 1

    now[0] += 300
    assert await connector.create_conversation("c_2") == "pf-c1"
    assert len(pf.calls("/accesstoken/")) == 2


@pytest.mark.parametrize("size", [1, 7, 4096])
async def test_events_split_anywhere_across_network_reads_give_the_same_answer(pf, connector, size):
    whole = "".join(SHORT).encode()
    pf.stream = [whole[i : i + size] for i in range(0, len(whole), size)]

    events = await answer(connector)

    assert shape(events)[0] == "Accepted" and shape(events)[-1] == "Final"
    assert events[-1].text == FINAL["short"]["response"] == "".join(e.text for e in events if isinstance(e, Text))
    assert not pf.calls("/response/")


DAMAGED = ['data: {"event": "LLM_RESPONSE_STREAM", "conte\n\n', "data: [1, 2]\n\n", "data:\n\n"]


@pytest.mark.parametrize("damage", DAMAGED)
async def test_a_damaged_event_is_skipped_and_the_final_event_still_gives_the_whole_answer(pf, connector, damage):
    lines = SHORT[: DETAILS + 1] + [damage] + SHORT[DETAILS + 1 :]
    pf.stream = ["".join(lines).encode()]

    events = await answer(connector)

    assert isinstance(events[-1], Final) and events[-1].text == FINAL["short"]["response"]
    assert not pf.calls("/response/")


async def test_a_stream_ending_after_pf_has_the_question_is_completed_by_fetching_the_answer(pf, connector):
    pf.stream = ["".join(SHORT[:FINAL_AT]).encode()]

    events = await answer(connector)

    assert isinstance(events[0], Accepted) and events[-1] == Final("fetched answer")
    message_id = events[0].agent_message_id
    assert [r.url.path.rsplit("/", 2)[1:] for r in pf.calls("/response/")] == [["pf-c1", message_id]]


async def test_a_stream_ending_before_pf_has_the_question_fails_and_can_be_asked_again(pf, connector):
    pf.stream = ["".join(SHORT[:DETAILS]).encode()]

    events = await answer(connector)

    assert shape(events) == ["Failed"] and events[0].retryable and not pf.calls("/response/")


def error_event(status: object) -> bytes:
    content = {"response": "internal detail", "error_description": "trace at 10.0.0.7", "status_code": status}
    return f"data: {json.dumps({'event': 'ERROR', 'status': 'FAILED', 'content': content})}\n\n".encode()


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [
        (429, "rate_limited", True),
        (500, "assistant_unavailable", True),
        (503, "assistant_unavailable", True),
        (400, "assistant_unavailable", False),
        (404, "assistant_unavailable", False),
        (None, "assistant_unavailable", False),
    ],
)
async def test_pf_errors_become_our_codes_with_a_retry_flag_and_nothing_secret(pf, connector, status, code, retryable):
    # The same status three ways: refusing to create, refusing the stream, and an ERROR event inside a 201 stream.
    failures = []
    if status is not None:
        pf.status["create"] = status
        with pytest.raises(AgentError) as refused:
            await connector.create_conversation("c_1")
        failures.append(refused.value)
        pf.status["stream"] = status
        failures.append((await answer(connector))[-1])
        pf.status["stream"] = 201
    pf.stream = ["".join(SHORT[:2]).encode() + error_event(status)]
    failures.append((await answer(connector))[-1])

    for failure in failures:
        assert (failure.code, failure.retryable) == (code, retryable)
        assert not any(secret in failure.detail for secret in (*SECRETS, "10.0.0.7", "internal detail"))


async def test_a_token_refused_twice_is_one_quiet_login_then_a_failure_not_a_loop(pf, connector):
    pf.status["stream"] = 401

    events = await answer(connector)

    assert shape(events) == ["Failed"] and not events[0].retryable
    assert len(pf.calls("/accesstoken/")) == 2 and len(pf.calls("/addmessage/")) == 2
