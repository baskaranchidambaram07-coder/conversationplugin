"""The chat's API (M4-T4 to M4-T6). Only our own chat page calls it: a request another site's page makes is
refused, and no cross-origin headers are ever sent, so a browser shows other sites nothing."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ucp import protocol
from ucp.gateway.pipeline import Problem
from ucp.gateway.public import widgets_of
from ucp.identity import Identity, expiry, verify_provider_token, verify_shared_secret
from ucp.sessions import ANONYMOUS_SECONDS, Keys, Limiter, Session, anonymous_user
from ucp.store import Owner, Store, TurnInProgress
from ucp.turns import Turns
from ucp.widgets import Widget

log = logging.getLogger("ucp.gateway")
REFUSALS_PER_MINUTE = 10  # host tokens refused from one address before it must wait


def same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    ours = request.app.state.public_origin or f"{request.url.scheme}://{request.url.netloc}"
    if origin is not None and origin != ours:
        raise Problem("forbidden")


def visitor_address(request: Request) -> str:
    """The visitor's address, for the limits per address. Behind the content delivery network every request comes
    from the load balancer, so the address the network saw is taken from its header ("address:port")."""
    header = request.app.state.visitor_address_header
    if header and (seen := request.headers.get(header)):
        return seen.rsplit(":", 1)[0]
    return request.client.host if request.client else "unknown"


router = APIRouter(prefix="/v1", dependencies=[Depends(same_origin)], responses={"4XX": {"model": protocol.ApiError}})


def _keys(request: Request) -> Keys:
    keys: Keys | None = getattr(request.app.state, "keys", None)
    if not keys:
        raise Problem("assistant_unavailable", retryable=True)
    return keys


async def visitor(request: Request) -> Session:
    """The caller's session, from `Authorization: Bearer`. Anything else is an ended session."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise Problem("session_expired")
    return _keys(request).verify(token)


def owner(session: Session) -> Owner:
    return Owner(session.tenant_id, session.widget_id, session.user_id)


async def _shared_secret(request: Request, widget_id: str, identity: Identity, token: str) -> str:
    secret = request.app.state.host_secrets.get(identity.secret)
    if not secret:
        log.error("widget %s names host secret %s, which is not configured", widget_id, identity.secret)
        raise Problem("assistant_unavailable", retryable=True)
    subject, token_hash, expires = verify_shared_secret(token, identity, widget_id, secret)
    if not await _store(request).use_host_token(widget_id, token_hash, expiry(expires)):
        log.info("host token refused: used before")
        raise Problem("forbidden")
    return subject


@router.post("/sessions", summary="Start a session for a visitor of a widget")
async def start_session(body: protocol.SessionRequest, request: Request) -> protocol.Session:
    limiter: Limiter = request.app.state.limiter
    widget = await widgets_of(request).get(body.widget_id)
    if not widget:
        raise Problem("not_found")
    address = visitor_address(request)
    # Counted per widget, as each widget sets its own limit.
    limiter.check(f"sessions:{widget.widget_id}:{address}", widget.document.limits.sessions_per_minute_per_address)
    document, keys = widget.document, _keys(request)
    if body.host_token is None:
        if document.sign_in == "signed_in":
            raise Problem("forbidden")  # this widget is for signed-in visitors only
        session = Session(anonymous_user(), document.tenant_id, widget.widget_id, widget.version, "anonymous")
        return protocol.Session(token=keys.issue(session), expires_in=ANONYMOUS_SECONDS)
    if document.sign_in == "anonymous" or not document.identity:
        raise Problem("forbidden")  # a token sent to a widget that takes none is a mistake on the host's side
    identity = document.identity
    try:
        if identity.secret:
            subject = await _shared_secret(request, widget.widget_id, identity, body.host_token)
        else:
            subject = await verify_provider_token(
                body.host_token, identity, widget.widget_id, request.app.state.provider_keys
            )
    except Problem as refused:
        if refused.code == "forbidden":  # repeated failures from one address are slowed down
            limiter.check(f"refused-host-tokens:{address}", REFUSALS_PER_MINUTE)
        raise
    user = await _store(request).user_for(document.tenant_id, identity.provider, subject)
    seconds = request.app.state.signed_in_seconds
    session = Session(user, document.tenant_id, widget.widget_id, widget.version, "signed_in")
    return protocol.Session(token=keys.issue(session, seconds=seconds), expires_in=seconds)


# Conversations and messages (M4-T5, M4-T6)


def _store(request: Request) -> Store:
    store: Store | None = getattr(request.app.state, "store", None)
    if not store:
        raise Problem("assistant_unavailable", retryable=True)
    return store


async def _widget(request: Request, session: Session) -> Widget:
    """The session's widget, as published now. A widget withdrawn, or moved to another tenant, ends the session."""
    widget = await widgets_of(request).get(session.widget_id)
    if not widget or widget.document.tenant_id != session.tenant_id:
        raise Problem("session_expired")
    return widget


def _cursor(conversation: protocol.Conversation) -> str:
    """Where a conversation list stopped: its last entry's time and ID, in nothing a URL would change."""
    return f"{conversation.updated_at.astimezone(UTC).isoformat().replace('+00:00', 'Z')}_{conversation.id}"


def _after(cursor: str | None) -> tuple[datetime, str] | None:
    if not cursor:
        return None
    moment, _, last = cursor.partition("_")
    try:
        at = datetime.fromisoformat(moment)
    except ValueError as error:
        raise Problem("invalid_request") from error
    if at.tzinfo is None or not last:
        raise Problem("invalid_request")
    return at, last


type Visitor = Annotated[Session, Depends(visitor)]
type Limit = Annotated[int, Query(ge=1, le=50)]


@router.post("/conversations", status_code=201, summary="Start a conversation")
async def create_conversation(request: Request, session: Visitor) -> protocol.Conversation:
    await _widget(request, session)
    return await _store(request).create_conversation(owner(session))


@router.get("/conversations", summary="The visitor's conversations, most recently active first")
async def list_conversations(
    request: Request, session: Visitor, before: protocol.Cursor | None = None, limit: Limit = 20
) -> protocol.ConversationPage:
    found = await _store(request).conversations(owner(session), _after(before), limit + 1)
    more = len(found) > limit
    return protocol.ConversationPage(conversations=found[:limit], next=_cursor(found[limit - 1]) if more else None)


@router.get("/conversations/{conversation_id}/messages", summary="A page of a conversation, oldest first")
async def read_messages(
    conversation_id: protocol.Id,
    request: Request,
    session: Visitor,
    before: Annotated[str | None, Query(pattern=r"^[0-9]{1,9}$")] = None,
    limit: Limit = 20,
) -> protocol.MessagePage:
    store = _store(request)
    if not await store.conversation(owner(session), conversation_id):
        raise Problem("not_found")
    found, older = await store.messages(owner(session), conversation_id, int(before) if before else None, limit)
    return protocol.MessagePage(messages=found, next=str(older) if older is not None else None)


@router.get("/conversations/{conversation_id}/messages/{message_id}", summary="One message, as stored now")
async def read_message(
    conversation_id: protocol.Id, message_id: protocol.Id, request: Request, session: Visitor
) -> protocol.Message:
    message = await _store(request).message(owner(session), conversation_id, message_id)
    if not message:
        raise Problem("not_found")
    return message


@router.post(
    "/conversations/{conversation_id}/messages",
    summary="Ask a question. The answer streams as StreamEvent lines, or arrives whole as a Message for "
    "`Accept: application/json`.",
    responses={200: {"content": {"text/event-stream": {}}, "model": protocol.Message}},
)
async def send_message(
    conversation_id: protocol.Id, body: protocol.SendMessage, request: Request, session: Visitor
) -> Response:
    widget = await _widget(request, session)
    limits, profile = widget.document.limits, widget.document.agent_profile
    request.app.state.limiter.check(f"messages:{session.user_id}", limits.messages_per_minute_per_session)
    connector = request.app.state.connectors.get(profile)
    if not connector:
        log.error("widget %s names agent profile %s, which is not configured", widget.widget_id, profile)
        raise Problem("assistant_unavailable", retryable=True)
    turns: Turns = request.app.state.turns
    turns.admit(widget.document.tenant_id, profile, limits.concurrent_turns)
    mine = owner(session)
    try:
        turn = await _store(request).start_turn(
            mine, conversation_id, body.client_message_id, body.text, widget.version, connector.version
        )
    except TurnInProgress as error:
        raise Problem("turn_in_progress", retryable=True, retry_after=5) from error
    if not turn:
        raise Problem("not_found")

    accept = request.headers.get("accept", "")
    whole = "application/json" in accept and "text/event-stream" not in accept
    if turn.repeat:
        if whole:
            return JSONResponse((await turns.settled(mine, turn)).model_dump(mode="json"))
        stream = turns.replay(mine, turn)
    else:
        queue, task = turns.start(turn, widget.document.tenant_id, profile, connector, body.text)
        if whole:
            await asyncio.shield(task)  # a caller who leaves does not cancel the answer
            return JSONResponse((await turns.settled(mine, turn)).model_dump(mode="json"))
        stream = turns.watch(queue)
    # No buffering on the way, so each piece reaches the visitor as it is written.
    headers = {"cache-control": "no-store", "x-accel-buffering": "no"}
    return StreamingResponse(stream, media_type="text/event-stream", headers=headers)
