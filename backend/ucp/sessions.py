"""Sessions (M4-T4, and M5-T1's token, which M5 builds signed-in sessions on).

A session token is a short-lived token the gateway signs and the chat holds in memory only (D6). The browser can
decode it, so it carries only our opaque IDs (D15): the user, the tenant, the widget and the widget version the
session began on, and how the visitor signed in. Keys rotate by ID: the first key signs, every listed key verifies.
"""

import secrets
import time
from collections import deque
from dataclasses import dataclass
from math import ceil
from typing import Literal

import jwt

from ucp.gateway.pipeline import Problem

ALGORITHM = "HS256"
ANONYMOUS_SECONDS = 3600
LEEWAY = 5  # seconds of clock difference between gateway instances, which share a synced clock


@dataclass(frozen=True)
class Session:
    user_id: str
    tenant_id: str
    widget_id: str
    config_version: int
    mode: Literal["anonymous", "signed_in"]


class Keys:
    """From the secret store, as "id:secret,id:secret". The first one signs new tokens."""

    def __init__(self, keys: str):
        pairs = [entry.split(":", 1) for entry in keys.split(",") if entry.strip()]
        self.keys = {kid.strip(): secret.strip().encode() for kid, secret in pairs}
        if not pairs or any(len(secret) < 32 for secret in self.keys.values()):
            raise ValueError("session keys need an id and at least 32 bytes of secret each")
        self.signing = pairs[0][0].strip()

    def issue(self, session: Session, seconds: int = ANONYMOUS_SECONDS) -> str:
        now = int(time.time())
        claims = {
            "sub": session.user_id,
            "tid": session.tenant_id,
            "wid": session.widget_id,
            "cv": session.config_version,
            "mode": session.mode,
            "iat": now,
            "exp": now + seconds,
        }
        return jwt.encode(claims, self.keys[self.signing], algorithm=ALGORITHM, headers={"kid": self.signing})

    def verify(self, token: str) -> Session:
        """The session, or session_expired for anything wrong: expired, altered, unknown key, or not a token."""
        try:
            key = self.keys[jwt.get_unverified_header(token)["kid"]]
            claims = jwt.decode(
                token,
                key,
                algorithms=[ALGORITHM],
                leeway=LEEWAY,
                options={"require": ["sub", "tid", "wid", "cv", "mode", "iat", "exp"]},
            )
            return Session(claims["sub"], claims["tid"], claims["wid"], claims["cv"], claims["mode"])
        except (jwt.PyJWTError, KeyError, TypeError) as error:
            raise Problem("session_expired") from error


def anonymous_user() -> str:
    return f"u_{secrets.token_urlsafe(16)}"


class Limiter:
    """Counts requests per key over the last minute, in this process (D11: no shared store in the first release;
    the web application firewall limits at the edge). Over the limit, the caller is told when to try again."""

    MAX_KEYS = 100_000

    def __init__(self):
        self.hits: dict[str, deque[float]] = {}

    def check(self, key: str, per_minute: int) -> None:
        now = time.monotonic()
        if len(self.hits) > self.MAX_KEYS:  # forget everyone idle for a minute, so memory stays bounded
            self.hits = {k: v for k, v in self.hits.items() if v and now - v[-1] < 60}
        hits = self.hits.setdefault(key, deque())
        while hits and now - hits[0] >= 60:
            hits.popleft()
        if len(hits) >= per_minute:
            raise Problem("rate_limited", retryable=True, retry_after=max(1, ceil(60 - (now - hits[0]))))
        hits.append(now)
