"""Speech on AWS (M11), without AWS: the framing, the signing, and both services played by local stand-ins. The
signing was also checked against AWS itself on 19 November 2026: Polly and Transcribe both accepted the signature and
answered that the caller lacked permission, which AWS checks only after a signature holds."""

import asyncio
import json
import re
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import httpx2
import pytest
from websockets.asyncio.server import serve

from tests.test_speech import LOUD
from ucp import aws_speech
from ucp.aws_speech import AUDIO, LANGUAGES, Credentials, Polly, Transcribe, frame, presigned, signed_headers, unframe
from ucp.protocol import VOICE_LANGUAGES
from ucp.speech import SpeechUnavailable

KEYS = Credentials("AKIDTESTONLY", "not-a-real-secret", "a-session-token")
WHEN = datetime(2026, 11, 19, 12, 0, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def test_keys(monkeypatch):
    monkeypatch.setattr(aws_speech, "_held", KEYS)


def test_every_voice_language_has_a_transcribe_code_and_a_polly_voice():
    assert set(LANGUAGES) == set(VOICE_LANGUAGES)
    assert LANGUAGES["zh-CN"] == ("zh-CN", "Zhiyu", "cmn-CN")  # Polly names Mandarin its own way


def test_event_stream_frames_go_there_and_back_and_damage_is_noticed():
    message = frame(AUDIO, b"\x01\x02")
    assert unframe(message) == (AUDIO, b"\x01\x02")
    with pytest.raises(ValueError):
        unframe(message[:-1] + bytes([message[-1] ^ 1]))
    assert unframe(frame({}, b"")) == ({}, b"")


def test_a_websocket_address_is_signed_in_its_query_for_five_minutes_with_the_session_token():
    def sign():
        return presigned(
            "wss://host.example:8443/stream", {"language-code": "en-GB"}, "us-east-1", "transcribe", KEYS, WHEN
        )

    address = sign()
    query = {name: values[0] for name, values in parse_qs(urlsplit(address).query).items()}
    assert query["X-Amz-Credential"] == "AKIDTESTONLY/20261119/us-east-1/transcribe/aws4_request"
    assert (query["X-Amz-Date"], query["X-Amz-Expires"], query["X-Amz-SignedHeaders"]) == (
        "20261119T120000Z",
        "300",
        "host",
    )
    assert query["X-Amz-Security-Token"] == "a-session-token" and query["language-code"] == "en-GB"
    assert re.fullmatch(r"[0-9a-f]{64}", query["X-Amz-Signature"])
    assert address == sign()  # the same request, the same signature
    assert "not-a-real-secret" not in address


def test_a_request_is_signed_in_its_headers():
    headers = signed_headers("POST", "https://polly.example/v1/speech", "us-east-1", "polly", KEYS, b"{}", WHEN)
    assert headers["authorization"].startswith(
        "AWS4-HMAC-SHA256 Credential=AKIDTESTONLY/20261119/us-east-1/polly/aws4_request, "
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature="
    )
    assert headers["x-amz-security-token"] == "a-session-token"


def transcript(text: str, partial: bool) -> bytes:
    body = {"Transcript": {"Results": [{"IsPartial": partial, "Alternatives": [{"Transcript": text}]}]}}
    return frame({":event-type": "TranscriptEvent", ":message-type": "event"}, json.dumps(body).encode())


async def stand_in_transcribe(socket):
    """Checks each frame of audio, answers as Transcribe does, and closes after the empty frame that ends it."""
    assert "X-Amz-Signature" in socket.request.path
    frames = 0
    async for message in socket:
        headers, audio = unframe(message)
        assert headers == AUDIO
        if not audio:
            break
        frames += 1
        if frames == 2:
            await socket.send(transcript("when does", True))
        if frames == 4:
            await socket.send(transcript("When does the library open?", False))


async def refusing_transcribe(socket):
    exception = {":exception-type": "AccessDeniedException", ":message-type": "exception"}
    await socket.send(frame(exception, b'{"Message": "not allowed"}'))


def heard(handler) -> list[str]:
    async def run():
        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]

            async def audio():
                for _ in range(5):
                    yield LOUD

            return [text async for text in Transcribe("us-east-1", f"ws://127.0.0.1:{port}").listen(audio(), "en-GB")]

    return asyncio.run(run())


def test_transcribe_is_heard_partial_then_final():
    assert heard(stand_in_transcribe) == ["when does", "When does the library open?"]


def test_a_refusal_from_transcribe_means_voice_is_unavailable():
    with pytest.raises(SpeechUnavailable, match="AccessDeniedException"):
        heard(refusing_transcribe)


def test_polly_reads_with_the_languages_neural_voice_and_a_refusal_means_unavailable():
    sent = []

    def stand_in(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        if json.loads(request.content)["VoiceId"] == "Kajal":
            return httpx2.Response(200, content=b"ID3 an mp3")
        return httpx2.Response(403, json={"Message": "not authorized"})

    async def run(language: str):
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(stand_in)) as client:
            return await Polly("us-east-1", client, "https://polly.test").speak("नमस्ते", language)

    assert asyncio.run(run("hi-IN")) == b"ID3 an mp3"
    assert json.loads(sent[0].content) == {
        "Engine": "neural",
        "LanguageCode": "hi-IN",
        "OutputFormat": "mp3",
        "SampleRate": "24000",
        "Text": "नमस्ते",
        "TextType": "text",
        "VoiceId": "Kajal",
    }
    assert sent[0].headers["authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKIDTESTONLY/")
    with pytest.raises(SpeechUnavailable, match="403"):
        asyncio.run(run("en-GB"))


def test_credentials_come_from_the_environment_first(monkeypatch):
    monkeypatch.setattr(aws_speech, "_held", None)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIDFROMENV")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret-from-env")
    monkeypatch.delenv("AWS_SESSION_TOKEN", raising=False)
    assert asyncio.run(aws_speech.credentials()) == Credentials("AKIDFROMENV", "secret-from-env", None)
