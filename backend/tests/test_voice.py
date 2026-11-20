"""Voice through the gateway (M11): consent, the voice socket and its limits, and answers read aloud. Speech comes
from the fake speech service, which hears a fixed question in any voiced audio and speaks silence."""

import asyncio
import base64
import logging
import secrets
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.websockets import WebSocketDisconnect

from tests.test_public import PUBLIC, document
from tests.test_speech import LOUD, QUIET
from tests.test_turns import Visitor, events, settings_for, wait_for
from ucp.gateway.app import create_app
from ucp.store import Store, files, messages, voice_consents
from ucp.widgets import seed

BASE = "https://chat.example.net"
SOCKET = "wss://chat.example.net/v1/voice"
VOICE = {**PUBLIC, "voice_enabled": True, "voice_languages": ["en-GB", "hi-IN"]}


@pytest.fixture
def speaking(database_url):
    """Widgets with voice on, with it off, and with room for one listener at a time."""
    ids = {name: f"w_{secrets.token_hex(4)}" for name in ("on", "off", "one")}
    documents = {
        ids["on"]: document(agent_profile="fake", public=VOICE),
        ids["off"]: document(agent_profile="fake"),
        ids["one"]: document(
            tenant_id=f"t_{secrets.token_hex(4)}",
            agent_profile="fake",
            public=VOICE,
            limits={"concurrent_listeners": 1},
        ),
    }

    async def publish():
        engine = create_async_engine(database_url)
        await seed(Store(engine), documents)
        await engine.dispose()

    asyncio.run(publish())
    return ids


def gateway_with(database_url, fake_pf, scanner, speech: str):
    return TestClient(create_app(replace(settings_for(database_url, fake_pf, scanner), speech=speech)), base_url=BASE)


@pytest.fixture
def voiced(database_url, fake_pf, fake_scanner):
    with gateway_with(database_url, fake_pf, fake_scanner, "fake") as client:
        yield client


def token(visitor: Visitor) -> str:
    return visitor.headers["authorization"].removeprefix("Bearer ")


def consent(visitor: Visitor, engine: str = "service"):
    return visitor.client.post("/v1/voice/consent", json={"version": 1, "engine": engine}, headers=visitor.headers)


def listen(client: TestClient, start: dict, audio: list[bytes], origin: str = BASE) -> list[dict]:
    """Opens the voice socket, speaks, stops, and returns every message until it closes."""
    with client.websocket_connect(SOCKET, headers={"origin": origin}) as socket:
        socket.send_json(start)
        for frame in audio:
            socket.send_bytes(frame)
        socket.send_json({"type": "stop"})
        replies = []
        try:
            while True:
                replies.append(socket.receive_json())
        except WebSocketDisconnect:
            return replies


def started(visitor: Visitor, language: str = "en-GB") -> dict:
    return {"type": "start", "token": token(visitor), "language": language}


def test_a_spoken_question_is_heard_word_by_word_then_whole_and_nothing_of_it_is_kept(
    voiced, speaking, database_url, caplog
):
    visitor = Visitor(voiced, speaking["on"])
    assert consent(visitor).status_code == 204
    kept_before = asyncio.run(_counts(database_url))
    caplog.set_level(logging.INFO)

    replies = listen(voiced, started(visitor), [LOUD] * 8 + [QUIET] * 2)

    assert replies[0] == {"type": "partial", "text": "When"}
    assert {"type": "partial", "text": "When does the"} in replies
    assert replies[-1] == {"type": "final", "text": "When does the library open?"}
    assert asyncio.run(_counts(database_url)) == kept_before  # no message, no file: nothing of the voice is kept
    assert "library" not in caplog.text  # what was heard is never logged


def test_hindi_is_heard_in_hindi(voiced, speaking):
    visitor = Visitor(voiced, speaking["on"])
    consent(visitor)
    assert listen(voiced, started(visitor, "hi-IN"), [LOUD])[-1] == {"type": "final", "text": "पुस्तकालय कब खुलता है?"}


def test_consent_is_recorded_once_given_and_only_where_voice_is_on(voiced, speaking, database_url):
    visitor = Visitor(voiced, speaking["on"])
    assert consent(visitor, "device").status_code == 204
    refused = listen(voiced, started(visitor), [LOUD])  # consent to the device's own recogniser is not to ours
    assert refused[-1]["error"]["code"] == "forbidden"
    assert consent(visitor).status_code == 204
    assert listen(voiced, started(visitor), [LOUD])[-1]["type"] == "final"
    rows = asyncio.run(_consents(database_url, speaking["on"]))
    assert ("anonymous", 1, "device") in rows and ("anonymous", 1, "service") in rows

    quiet = Visitor(voiced, speaking["off"])
    assert consent(quiet).status_code == 403
    assert consent(Visitor(voiced, speaking["on"]), "google").status_code == 400


def test_the_socket_refuses_other_sites_bad_starts_ended_sessions_and_languages_not_offered(voiced, speaking):
    visitor = Visitor(voiced, speaking["on"])
    consent(visitor)
    with pytest.raises(WebSocketDisconnect):  # refused before it opens
        listen(voiced, started(visitor), [], origin="https://evil.example")

    def refusal(start) -> str:
        return listen(voiced, start, [])[-1]["error"]["code"]

    assert refusal({"type": "stop"}) == "invalid_request"
    assert refusal({"type": "start", "language": "en-GB"}) == "invalid_request"
    assert refusal({"type": "start", "token": "s_not-a-session", "language": "en-GB"}) == "session_expired"
    assert refusal(started(visitor, "fr-FR")) == "forbidden"  # a language, but not one this widget offers
    quiet = Visitor(voiced, speaking["off"])
    assert refusal(started(quiet)) == "forbidden"


def test_audio_too_big_too_fast_or_not_audio_is_refused(voiced, speaking):
    visitor = Visitor(voiced, speaking["on"])
    consent(visitor)
    assert listen(voiced, started(visitor), [LOUD + LOUD])[-1]["error"]["code"] == "invalid_request"  # 400 ms
    assert listen(voiced, started(visitor), [LOUD[:-1]])[-1]["error"]["code"] == "invalid_request"  # half a sample
    assert listen(voiced, started(visitor), [LOUD] * 30)[-1]["error"]["code"] == "rate_limited"  # 6 s in an instant

    with voiced.websocket_connect(SOCKET, headers={"origin": BASE}) as socket:
        socket.send_json(started(visitor))
        socket.send_text("not a message")
        assert socket.receive_json()["error"]["code"] == "invalid_request"


def test_a_tenant_listens_to_so_many_visitors_at_once_and_a_visitor_speaks_so_often(voiced, speaking):
    first, second = Visitor(voiced, speaking["one"]), Visitor(voiced, speaking["one"])
    consent(first), consent(second)
    with voiced.websocket_connect(SOCKET, headers={"origin": BASE}) as socket:
        socket.send_json(started(first))
        socket.send_bytes(LOUD)
        socket.send_bytes(LOUD)
        assert socket.receive_json()["type"] == "partial"  # listening now
        assert listen(voiced, started(second), [LOUD])[-1]["error"]["code"] == "rate_limited"
    chatty = Visitor(voiced, speaking["on"])
    consent(chatty)
    codes = [listen(voiced, started(chatty), [])[-1].get("error", {}).get("code") for _ in range(11)]
    assert codes[:10] == [None] * 10 and codes[10] == "rate_limited"


def test_without_a_speech_service_the_socket_says_voice_is_unavailable(database_url, fake_pf, fake_scanner, speaking):
    with gateway_with(database_url, fake_pf, fake_scanner, "none") as client:
        visitor = Visitor(client, speaking["on"])
        consent(visitor)
        error = listen(client, started(visitor), [LOUD])[-1]["error"]
        assert (error["code"], error["retryable"]) == ("assistant_unavailable", True)


def test_an_answer_asked_with_speak_is_read_aloud_in_order_after_its_text_and_names_what_it_does_not_read(
    voiced, speaking
):
    visitor = Visitor(voiced, speaking["on"])
    conversation = visitor.conversation()
    streamed = events(_ask(visitor, conversation, "How does HTTPS work? [long]", "en-GB"))

    speech = [event for event in streamed if event.type == "speech.audio"]
    assert [event.part for event in speech] == list(range(len(speech))) and len(speech) > 3
    said = " ".join(event.text for event in speech)
    assert "There is a table in the chat." in said and "|" not in said and "```" not in said
    assert all(base64.b64decode(event.audio)[:4] == b"RIFF" for event in speech)
    kinds = [event.type for event in streamed]
    assert kinds.index("message.completed") < len(kinds) - 1 or kinds[-1] == "speech.audio"
    first_text = kinds.index("content_block.delta")
    assert kinds.index("speech.audio") > first_text  # a piece is read only after its words are on screen
    answer = wait_for(visitor, conversation, streamed[0].message_id)
    assert answer.status == "complete" and answer.blocks[0].text  # the text answer is whole, as ever


def test_a_voice_that_fails_leaves_the_text_whole_and_hands_each_piece_to_the_browser(voiced, speaking):
    class Broken:
        async def speak(self, text, language):
            raise ConnectionError("the speech service is down")

    voiced.app.state.speaker = Broken()
    visitor = Visitor(voiced, speaking["on"])
    conversation = visitor.conversation()
    streamed = events(_ask(visitor, conversation, "Hello", "en-GB"))
    speech = [event for event in streamed if event.type == "speech.audio"]
    assert speech and all(event.audio is None for event in speech)
    assert "message.completed" in [event.type for event in streamed]


def test_speak_is_ignored_where_the_widget_does_not_offer_that_language_or_voice_at_all(voiced, speaking):
    for widget, language in ((speaking["on"], "fr-FR"), (speaking["off"], "en-GB")):
        visitor = Visitor(voiced, widget)
        streamed = events(_ask(visitor, visitor.conversation(), "Hello", language))
        assert "speech.audio" not in [event.type for event in streamed]
        assert streamed[-1].type == "message.completed"


def _ask(visitor: Visitor, conversation: str, text: str, speak: str):
    body = {"text": text, "client_message_id": f"k_{secrets.token_hex(4)}", "speak": speak}
    return visitor.client.post(f"/v1/conversations/{conversation}/messages", json=body, headers=visitor.headers)


async def _counts(database_url: str) -> tuple[int, int]:
    engine = create_async_engine(database_url)
    async with engine.connect() as db:
        counted = [(await db.execute(select(func.count()).select_from(table))).scalar() for table in (messages, files)]
    await engine.dispose()
    return tuple(counted)


async def _consents(database_url: str, widget_id: str) -> list[tuple]:
    engine = create_async_engine(database_url)
    async with engine.connect() as db:
        query = select(voice_consents.c.user_kind, voice_consents.c.version, voice_consents.c.engine).where(
            voice_consents.c.widget_id == widget_id
        )
        rows = [tuple(row) for row in await db.execute(query)]
    await engine.dispose()
    return rows
