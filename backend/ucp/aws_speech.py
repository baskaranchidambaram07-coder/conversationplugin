"""Speech on AWS (M11): Transcribe streaming hears the visitor and Polly reads the answer, in the deployment's own
region (docs/voice.md). No AWS library, as decided on 14 November: requests are signed here (Signature Version 4),
audio travels in AWS's event-stream frames over the WebSocket client the gateway already has, and credentials come
from the task's role, or on a developer's machine from the environment or the AWS command line.
"""

import asyncio
import hashlib
import hmac
import json
import os
import struct
import time
import zlib
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote, urlsplit

import httpx2
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from ucp.speech import SpeechUnavailable

# Each language: Transcribe's code, then Polly's neural voice and Polly's code (docs/voice.md, section 4.3).
LANGUAGES = {
    "en-GB": ("en-GB", "Amy", "en-GB"),
    "en-US": ("en-US", "Joanna", "en-US"),
    "en-AU": ("en-AU", "Olivia", "en-AU"),
    "en-IN": ("en-IN", "Kajal", "en-IN"),
    "en-IE": ("en-IE", "Niamh", "en-IE"),
    "en-NZ": ("en-NZ", "Aria", "en-NZ"),
    "en-ZA": ("en-ZA", "Ayanda", "en-ZA"),
    "ar-AE": ("ar-AE", "Hala", "ar-AE"),
    "de-DE": ("de-DE", "Vicki", "de-DE"),
    "es-ES": ("es-ES", "Lucia", "es-ES"),
    "es-US": ("es-US", "Lupe", "es-US"),
    "fr-CA": ("fr-CA", "Gabrielle", "fr-CA"),
    "fr-FR": ("fr-FR", "Lea", "fr-FR"),
    "hi-IN": ("hi-IN", "Kajal", "hi-IN"),
    "it-IT": ("it-IT", "Bianca", "it-IT"),
    "ja-JP": ("ja-JP", "Kazuha", "ja-JP"),
    "ko-KR": ("ko-KR", "Seoyeon", "ko-KR"),
    "nl-NL": ("nl-NL", "Laura", "nl-NL"),
    "pt-BR": ("pt-BR", "Camila", "pt-BR"),
    "pt-PT": ("pt-PT", "Ines", "pt-PT"),
    "zh-CN": ("zh-CN", "Zhiyu", "cmn-CN"),
}


@dataclass(frozen=True)
class Credentials:
    key: str
    secret: str
    token: str | None = None
    expires: float = float("inf")  # seconds since the epoch


_held: Credentials | None = None


async def credentials() -> Credentials:
    """The task role's credentials on AWS, refreshed five minutes before they expire; else the environment's; else,
    on a developer's machine, whatever the AWS command line signs in with."""
    global _held
    if _held and _held.expires - time.time() > 300:
        return _held
    env = os.environ
    if env.get("AWS_ACCESS_KEY_ID") and env.get("AWS_SECRET_ACCESS_KEY"):
        _held = Credentials(env["AWS_ACCESS_KEY_ID"], env["AWS_SECRET_ACCESS_KEY"], env.get("AWS_SESSION_TOKEN"))
    elif relative := env.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"):
        async with httpx2.AsyncClient(timeout=5) as local:  # the task's own credentials endpoint
            found = (await local.get(f"http://169.254.170.2{relative}")).json()
        expires = datetime.fromisoformat(found["Expiration"].replace("Z", "+00:00")).timestamp()
        _held = Credentials(found["AccessKeyId"], found["SecretAccessKey"], found.get("Token"), expires)
    else:
        process = await asyncio.create_subprocess_exec(
            "aws", "configure", "export-credentials", "--format", "process",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )  # fmt: skip
        out, _ = await process.communicate()
        if process.returncode:
            raise SpeechUnavailable("no AWS credentials")
        found = json.loads(out)
        when = found.get("Expiration")
        expires = datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp() if when else float("inf")
        _held = Credentials(found["AccessKeyId"], found["SecretAccessKey"], found.get("SessionToken"), expires)
    return _held


def _hmac(key: bytes, text: str) -> bytes:
    return hmac.new(key, text.encode(), hashlib.sha256).digest()


def _scope_key(secret: str, day: str, region: str, service: str) -> bytes:
    key = _hmac(f"AWS4{secret}".encode(), day)
    for part in (region, service, "aws4_request"):
        key = _hmac(key, part)
    return key


def _canonical_query(params: dict[str, str]) -> str:
    return "&".join(f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, v in sorted(params.items()))


def signed_headers(method: str, url: str, region: str, service: str, creds: Credentials, body: bytes, now: datetime):
    """The headers that sign a request with Signature Version 4."""
    parts = urlsplit(url)
    stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload = hashlib.sha256(body).hexdigest()
    headers = {"host": parts.netloc, "x-amz-content-sha256": payload, "x-amz-date": stamp}
    if creds.token:
        headers["x-amz-security-token"] = creds.token
    names = ";".join(sorted(headers))
    canonical = "\n".join(
        [method, parts.path or "/", parts.query, *(f"{k}:{headers[k]}" for k in sorted(headers)), "", names, payload]
    )
    scope = f"{day}/{region}/{service}/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signature = hmac.new(_scope_key(creds.secret, day, region, service), to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = f"AWS4-HMAC-SHA256 Credential={creds.key}/{scope}, SignedHeaders={names}, Signature={signature}"
    return {**headers, "authorization": authorization}


def presigned(url: str, params: dict[str, str], region: str, service: str, creds: Credentials, now: datetime) -> str:
    """An address signed in its query string, good for five minutes: how a WebSocket is signed."""
    parts = urlsplit(url)
    stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    scope = f"{day}/{region}/{service}/aws4_request"
    query = {
        **params,
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{creds.key}/{scope}",
        "X-Amz-Date": stamp,
        "X-Amz-Expires": "300",
        "X-Amz-SignedHeaders": "host",
    }
    if creds.token:
        query["X-Amz-Security-Token"] = creds.token
    canonical_query = _canonical_query(query)
    empty = hashlib.sha256(b"").hexdigest()
    canonical = "\n".join(["GET", parts.path, canonical_query, f"host:{parts.netloc}", "", "host", empty])
    to_sign = "\n".join(["AWS4-HMAC-SHA256", stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signature = hmac.new(_scope_key(creds.secret, day, region, service), to_sign.encode(), hashlib.sha256).hexdigest()
    return f"{parts.scheme}://{parts.netloc}{parts.path}?{canonical_query}&X-Amz-Signature={signature}"


# AWS's event-stream framing: a prelude (total and header lengths) and its CRC, the headers, the payload, a CRC.


def frame(headers: dict[str, str], payload: bytes) -> bytes:
    encoded = b"".join(
        bytes([len(name)]) + name.encode() + b"\x07" + struct.pack(">H", len(value)) + value.encode()
        for name, value in headers.items()
    )
    prelude = struct.pack(">II", 16 + len(encoded) + len(payload), len(encoded))
    body = prelude + struct.pack(">I", zlib.crc32(prelude)) + encoded + payload
    return body + struct.pack(">I", zlib.crc32(body))


def unframe(message: bytes) -> tuple[dict[str, str], bytes]:
    """The string headers and the payload of one frame; anything malformed raises ValueError."""
    total, length = struct.unpack(">II", message[:8])
    if total != len(message) or zlib.crc32(message[:-4]) != struct.unpack(">I", message[-4:])[0]:
        raise ValueError("a damaged event-stream frame")
    headers: dict[str, str] = {}
    at, end = 12, 12 + length
    while at < end:
        size = message[at]
        name = message[at + 1 : at + 1 + size].decode()
        at += 1 + size
        if message[at] != 7:  # Transcribe sends only string headers
            raise ValueError("an event-stream header that is not a string")
        (value_size,) = struct.unpack(">H", message[at + 1 : at + 3])
        headers[name] = message[at + 3 : at + 3 + value_size].decode()
        at += 3 + value_size
    return headers, message[end:-4]


AUDIO = {":content-type": "application/octet-stream", ":event-type": "AudioEvent", ":message-type": "event"}


class Transcribe:
    """Hears a visitor as they speak, through Amazon Transcribe's streaming WebSocket."""

    def __init__(self, region: str, endpoint: str | None = None):
        self.region = region
        self.endpoint = endpoint or f"wss://transcribestreaming.{region}.amazonaws.com:8443"  # another for tests

    async def listen(self, audio: AsyncIterator[bytes], language: str) -> AsyncIterator[str]:
        code = LANGUAGES[language][0]
        params = {"language-code": code, "media-encoding": "pcm", "sample-rate": "16000"}
        host = f"{self.endpoint}/stream-transcription-websocket"
        address = presigned(host, params, self.region, "transcribe", await credentials(), datetime.now(UTC))
        try:
            async with connect(address, max_size=2**20, open_timeout=10) as socket:
                sending = asyncio.create_task(self._send(socket, audio))
                try:
                    done: list[str] = []
                    async for message in socket:
                        headers, payload = unframe(message if isinstance(message, bytes) else message.encode())
                        if headers.get(":message-type") == "exception":
                            raise SpeechUnavailable(f"Transcribe: {headers.get(':exception-type')}")
                        partial = ""
                        for result in json.loads(payload).get("Transcript", {}).get("Results", []):
                            words = (result.get("Alternatives") or [{}])[0].get("Transcript", "")
                            if result.get("IsPartial"):
                                partial = words
                            else:
                                done.append(words)
                        yield " ".join([*done, partial]).strip()
                    await sending
                finally:
                    sending.cancel()
        except (OSError, WebSocketException, ValueError) as error:
            raise SpeechUnavailable(f"Transcribe: {type(error).__name__}") from error

    @staticmethod
    async def _send(socket, audio: AsyncIterator[bytes]) -> None:
        async for chunk in audio:
            await socket.send(frame(AUDIO, chunk))
        await socket.send(frame(AUDIO, b""))  # an empty audio event ends the stream; Transcribe then closes


class Polly:
    """Reads a piece of an answer aloud with Amazon Polly's neural voices, as an MP3."""

    def __init__(self, region: str, client: httpx2.AsyncClient, endpoint: str | None = None):
        self.region, self.client = region, client
        self.endpoint = endpoint or f"https://polly.{region}.amazonaws.com"  # another for tests

    async def speak(self, text: str, language: str) -> bytes | None:
        _, voice, code = LANGUAGES[language]
        body = json.dumps(
            {"Engine": "neural", "LanguageCode": code, "OutputFormat": "mp3", "SampleRate": "24000", "Text": text,
             "TextType": "text", "VoiceId": voice}
        ).encode()  # fmt: skip
        url = f"{self.endpoint}/v1/speech"
        headers = signed_headers("POST", url, self.region, "polly", await credentials(), body, datetime.now(UTC))
        reply = await self.client.post(url, content=body, headers={**headers, "content-type": "application/json"})
        if reply.status_code != 200:
            raise SpeechUnavailable(f"Polly answered {reply.status_code}: {reply.text[:200]}")
        return reply.content
