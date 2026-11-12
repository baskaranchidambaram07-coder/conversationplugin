"""The PF connector against the fake PF (M6 core, built with M4): stream conversion, recovery, login and errors."""

import asyncio
import json
import re

import httpx2
import pytest

from fakepf.app import FINAL
from ucp.connector import Accepted, AgentError, Failed, Final, Text
from ucp.gateway.pipeline import correlation
from ucp.pf import PfConnector, PfProfile

pytestmark = pytest.mark.anyio

PF_ID = re.compile(r"[0-9a-f]{24}|00000000-0000-4000")  # the shape of the fake PF's IDs


def profile(base_url: str, **changes) -> PfProfile:
    values = {
        "base_url": base_url,
        "tenant": "fake-tenant",
        "workspace_id": "fake-workspace",
        "agent_version_id": "fake-agent-version",
        "api_key": "fake-api-key",
        "username": "fake-user",
        "password": "fake-password",
    }
    return PfProfile(**{**values, **changes})


@pytest.fixture
async def logins():
    return []


@pytest.fixture
async def client(logins):
    async def count(request):
        if "/accesstoken/" in request.url.path:
            logins.append(request.url.path)

    async with httpx2.AsyncClient(event_hooks={"request": [count]}, timeout=httpx2.Timeout(5, read=2)) as client:
        yield client


async def ask(connector: PfConnector, question: str) -> list:
    conversation = await connector.create_conversation("c_ours")
    return [event async for event in connector.send(conversation, question)]


async def test_a_short_answer_becomes_accepted_text_and_one_final_with_nothing_of_pf_in_it(fake_pf, client):
    events = await ask(PfConnector(profile(fake_pf), client), "Hello")

    assert isinstance(events[0], Accepted) and isinstance(events[-1], Final)
    assert all(isinstance(event, Text) for event in events[1:-1]) and len(events) > 2
    final = events[-1]
    assert final.text == FINAL["short"]["response"] == "".join(event.text for event in events[1:-1])
    assert final.usage.keys() <= {"prompt_tokens", "completion_tokens", "total_tokens", "total_cost"}
    assert not PF_ID.search(json.dumps([event.text for event in events[1:]]))


async def test_a_long_answer_streams_in_many_pieces_that_add_up_to_the_final(fake_pf, client):
    events = await ask(PfConnector(profile(fake_pf), client), "Explain HTTPS [long]")
    pieces = [event.text for event in events if isinstance(event, Text)]

    assert len(pieces) > 100 and "".join(pieces) == events[-1].text == FINAL["long"]["response"]


async def test_an_error_part_way_ends_in_one_retryable_failure_after_the_pieces_already_sent(fake_pf, client):
    events = await ask(PfConnector(profile(fake_pf), client), "Explain [error]")

    assert [type(event).__name__ for event in events] == ["Accepted", "Text", "Text", "Text", "Failed"]
    assert (events[-1].code, events[-1].retryable) == ("assistant_unavailable", True)


async def test_an_unknown_conversation_fails_and_is_not_worth_retrying(fake_pf, client):
    connector = PfConnector(profile(fake_pf), client)
    events = [event async for event in connector.send("no-such-conversation", "Hello")]

    assert len(events) == 1 and (events[0].code, events[0].retryable) == ("assistant_unavailable", False)


async def test_a_stream_that_breaks_after_pf_has_the_question_is_recovered_by_fetching_the_answer(fake_pf):
    # The first word of [slow] comes after a long silence; a short read limit breaks the stream in that silence.
    async with httpx2.AsyncClient(timeout=httpx2.Timeout(5, read=0.2)) as impatient:
        connector = PfConnector(profile(fake_pf), impatient, poll_seconds=0.1, recover_seconds=10)
        events = await ask(connector, "Hello [slow]")

    assert [type(event).__name__ for event in events] == ["Accepted", "Final"]
    assert events[-1].text == FINAL["short"]["response"]


async def test_a_refused_token_means_one_quiet_login_and_the_question_still_gets_its_answer(fake_pf, client, logins):
    connector = PfConnector(profile(fake_pf), client)
    conversation = await connector.create_conversation("c_ours")
    await client.post(f"{fake_pf}/_fake/expire-tokens")

    events = [event async for event in connector.send(conversation, "Hello")]

    assert isinstance(events[-1], Final) and len(logins) == 2


async def test_callers_arriving_together_share_one_login(fake_pf, client, logins):
    connector = PfConnector(profile(fake_pf), client)

    await asyncio.gather(*(connector.create_conversation(f"c_{n}") for n in range(5)))

    assert len(logins) == 1


async def test_wrong_credentials_are_refused_even_though_pf_answers_with_success(fake_pf, client):
    connector = PfConnector(profile(fake_pf, password="wrong"), client)

    for call in (connector.check(), connector.create_conversation("c_ours")):
        with pytest.raises(AgentError) as refused:
            await call
        assert (refused.value.code, refused.value.retryable) == ("assistant_unavailable", False)
    events = [event async for event in connector.send("any", "Hello")]
    assert len(events) == 1 and isinstance(events[0], Failed) and not events[0].retryable


async def test_an_unreachable_pf_is_a_retryable_failure(client):
    connector = PfConnector(profile("http://127.0.0.1:9"), client)

    with pytest.raises(AgentError) as refused:
        await connector.create_conversation("c_ours")
    assert refused.value.retryable
    events = [event async for event in connector.send("any", "Hello")]
    assert len(events) == 1 and events[0].retryable


async def test_the_profiles_secrets_never_appear_in_its_printed_form(fake_pf):
    printed = repr(profile(fake_pf)) + str(profile(fake_pf))

    assert "fake-api-key" not in printed and "fake-password" not in printed


async def test_every_call_after_login_carries_our_reference_for_the_logs(fake_pf):
    seen = []

    async def note(request):
        seen.append((request.url.path, request.headers.get("x-request-id")))

    async with httpx2.AsyncClient(event_hooks={"request": [note]}) as client:
        token = correlation.set("r_trace_me")
        try:
            await ask(PfConnector(profile(fake_pf), client), "Hello")
        finally:
            correlation.reset(token)

    calls = [reference for path, reference in seen if "/accesstoken/" not in path]
    assert len(calls) == 2 and set(calls) == {"r_trace_me"}
