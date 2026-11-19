"""Voice (M11): the visitor's consent, and the voice socket that carries their speech to the speech service and the
words back as they are heard (docs/voice.md, section 5.1). No audio is kept: frames pass through memory only, and
what was heard is never logged."""

import asyncio
import logging
import secrets
import time
from collections import Counter

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import ValidationError

from ucp import protocol
from ucp.gateway.api import Visitor, _store, _widget, owner, same_origin
from ucp.gateway.pipeline import Problem, api_error, correlation
from ucp.sessions import Session
from ucp.speech import BYTES_PER_SECOND, Listener, SpeechUnavailable
from ucp.widgets import Widget

log = logging.getLogger("ucp.voice")
CONSENTS_PER_MINUTE = 10
START_WITHIN = 5  # seconds for the first message to arrive
LONGEST = 60  # seconds of speech in one utterance; what was heard by then stands
FRAME = 6400  # bytes in one frame at most: 200 ms of audio
BURST = 64_000  # bytes beyond the steady rate a socket may send at once
STEADY = 50_000  # bytes a second on average: half again real time

router = APIRouter(prefix="/v1", dependencies=[Depends(same_origin)], responses={"4XX": {"model": protocol.ApiError}})
sockets = APIRouter()


@router.post("/voice/consent", status_code=204, summary="Record that the visitor accepted the voice notice")
async def consent(body: protocol.VoiceConsent, request: Request, session: Visitor) -> Response:
    widget = await _widget(request, session)
    if not widget.config.voice_enabled:
        raise Problem("forbidden")
    request.app.state.limiter.check(f"voice-consent:{session.user_id}", CONSENTS_PER_MINUTE)
    await _store(request).consent_to_voice(owner(session), session.mode, body.version, body.engine)
    return Response(status_code=204)


def _ours(socket: WebSocket) -> bool:
    """Only our own chat page may open the socket; a browser always says which page it is on."""
    ours = (
        socket.app.state.public_origin or f"{'https' if socket.url.scheme == 'wss' else 'http'}://{socket.url.netloc}"
    )
    return socket.headers.get("origin") == ours


@sockets.websocket("/v1/voice")
async def voice(socket: WebSocket) -> None:
    correlation.set(f"r_{secrets.token_urlsafe(12)}")
    if not _ours(socket):
        await socket.close(code=1008)  # before accepting, so the browser's handshake is refused
        return
    await socket.accept()
    try:
        session, widget, language = await _started(socket)
        await _listen(socket, session, widget, language)
    except Problem as problem:
        await _refuse(socket, problem)
    except (WebSocketDisconnect, RuntimeError):
        pass  # the visitor left; what was heard so far is already on their screen
    except Exception:
        log.exception("voice: unexpected failure, reference %s", correlation.get())
        await _refuse(socket, Problem("internal_error"))


async def _refuse(socket: WebSocket, problem: Problem) -> None:
    error = api_error(problem.code, retryable=problem.retryable, retry_after=problem.retry_after)
    try:
        await socket.send_text(protocol.VoiceFailed(type="error", error=error).model_dump_json())
        await socket.close()
    except (WebSocketDisconnect, RuntimeError):
        pass


async def _started(socket: WebSocket) -> tuple[Session, Widget, str]:
    """The first message: who is speaking, in which language, and whether they may."""
    try:
        async with asyncio.timeout(START_WITHIN):
            start = protocol.ADAPTERS["VoiceRequest"].validate_json(await socket.receive_text())
    except (TimeoutError, ValidationError, KeyError) as error:
        raise Problem("invalid_request") from error
    if start.type != "start":
        raise Problem("invalid_request")
    keys = socket.app.state.keys
    if not keys:
        raise Problem("assistant_unavailable", retryable=True)
    session = keys.verify(start.token)
    widget = await _widget(socket, session)  # type: ignore[arg-type]  # both carry the app
    if not widget.config.voice_enabled or start.language not in widget.config.voice_languages:
        raise Problem("forbidden")
    socket.app.state.limiter.check(
        f"utterances:{session.user_id}", widget.document.limits.utterances_per_minute_per_session
    )
    if not await _store(socket).consented_to_voice(owner(session), "service"):  # type: ignore[arg-type]
        raise Problem("forbidden")
    return session, widget, start.language


async def _listen(socket: WebSocket, session: Session, widget: Widget, language: str) -> None:
    listening: Counter[str] = socket.app.state.listening
    tenant = widget.document.tenant_id
    if listening[tenant] >= widget.document.limits.concurrent_listeners:
        raise Problem("rate_limited", retryable=True, retry_after=5)
    listening[tenant] += 1
    try:
        async with asyncio.timeout(START_WITHIN + LONGEST * 1.5):
            await _relay(socket, socket.app.state.listener, language)
    except TimeoutError as error:
        raise Problem("invalid_request") from error  # audio that never ended
    finally:
        listening[tenant] -= 1


async def _relay(socket: WebSocket, listener: Listener, language: str) -> None:
    """Frames from the visitor to the listener, and what it hears back to the visitor, until they stop."""
    frames: asyncio.Queue[bytes | None] = asyncio.Queue()

    async def receive() -> None:
        began, total = time.monotonic(), 0
        try:
            while True:
                message = await socket.receive()
                if message["type"] == "websocket.disconnect":
                    return
                if (data := message.get("bytes")) is not None:
                    if not data or len(data) > FRAME or len(data) % 2:
                        raise Problem("invalid_request")
                    total += len(data)
                    if total > LONGEST * BYTES_PER_SECOND:
                        return
                    if total > BURST + STEADY * (time.monotonic() - began):
                        raise Problem("rate_limited", retryable=True, retry_after=5)
                    frames.put_nowait(data)
                else:
                    try:
                        stop = protocol.ADAPTERS["VoiceRequest"].validate_json(message.get("text") or "")
                    except ValidationError as error:
                        raise Problem("invalid_request") from error
                    if stop.type == "stop":
                        return
                    raise Problem("invalid_request")
        finally:
            frames.put_nowait(None)

    async def audio():
        while (frame := await frames.get()) is not None:
            yield frame

    receiving = asyncio.create_task(receive())
    heard = ""
    try:
        async for heard in listener.listen(audio(), language):
            await socket.send_text(protocol.VoiceHeard(type="partial", text=heard[:4000]).model_dump_json())
        await receiving  # a refusal while receiving is raised here
    except SpeechUnavailable as error:
        log.warning("voice: the speech service could not listen (%s), reference %s", error, correlation.get())
        raise Problem("assistant_unavailable", retryable=True) from error
    finally:
        receiving.cancel()
    log.info("voice: heard %d characters, reference %s", len(heard), correlation.get())
    await socket.send_text(protocol.VoiceHeard(type="final", text=heard[:4000]).model_dump_json())
    await socket.close()
