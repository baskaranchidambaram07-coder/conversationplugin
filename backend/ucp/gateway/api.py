"""The chat's API (M4-T4 to M4-T6). Only our own chat page calls it: a request another site's page makes is
refused, and no cross-origin headers are ever sent, so a browser shows other sites nothing."""

from fastapi import APIRouter, Depends, Request

from ucp import protocol
from ucp.gateway.pipeline import Problem
from ucp.gateway.public import widgets_of
from ucp.sessions import ANONYMOUS_SECONDS, Keys, Limiter, Session, anonymous_user
from ucp.store import Owner


def same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is not None and origin != f"{request.url.scheme}://{request.url.netloc}":
        raise Problem("forbidden")


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


@router.post("/sessions", summary="Start a session for a visitor of a widget")
async def start_session(body: protocol.SessionRequest, request: Request) -> protocol.Session:
    limiter: Limiter = request.app.state.limiter
    widget = await widgets_of(request).get(body.widget_id)
    if not widget:
        raise Problem("not_found")
    address = request.client.host if request.client else "unknown"
    limiter.check(f"sessions:{address}", widget.document.limits.sessions_per_minute_per_address)
    # Signed-in visitors arrive with M5; until then only widgets open to anonymous visitors start sessions.
    if body.host_token is not None or widget.document.sign_in == "signed_in":
        raise Problem("forbidden")
    session = Session(anonymous_user(), widget.document.tenant_id, widget.widget_id, widget.version, "anonymous")
    return protocol.Session(token=_keys(request).issue(session), expires_in=ANONYMOUS_SECONDS)
