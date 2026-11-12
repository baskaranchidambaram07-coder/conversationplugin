"""Who a signed-in visitor is (M5-T3 to M5-T5).

A signed-in visitor arrives with a token from the customer's side, which the gateway checks before starting a
session. The customer's backend signs a short token with the widget's shared secret, as described below.

The host token, signed with HS256 using a secret the widget's settings name:

    header   {"alg": "HS256", "typ": "JWT", "kid": "<which secret, optional>"}
    claims   iss  the issuer the widget's settings name          aud  the widget ID (unless the settings say otherwise)
             sub  the host's stable ID for the user, never an email address or a name
             iat  when it was signed     exp  at most 10 minutes later     jti  random, used once only
             nbf  optional

Anything wrong with a token (signature, issuer, audience, times, lifetime, reuse, a missing claim) refuses it the
same way, so a caller learns nothing about which check failed. The reason goes to our log only.
"""

import hashlib
import logging
from datetime import UTC, datetime
from typing import Annotated

import jwt
from pydantic import BaseModel, ConfigDict, Field

from ucp.gateway.pipeline import Problem
from ucp.protocol import Id

log = logging.getLogger("ucp.identity")

LEEWAY = 30  # seconds of clock difference between the customer's servers and ours
MAX_LIFETIME = 600  # a shared-secret token is made for one sign-in, so it never needs to last long
REQUIRED = ["iss", "aud", "sub", "iat", "exp", "jti"]


class Identity(BaseModel):
    """How a widget's signed-in visitors prove who they are. Part of the widget's private settings."""

    model_config = ConfigDict(strict=True, extra="forbid")

    provider: Id = Field(description="Our name for where these users come from; with the tenant, it keys each user.")
    issuer: Annotated[str, Field(min_length=1, max_length=512)]
    audience: Annotated[str, Field(min_length=1, max_length=512)] | None = Field(
        default=None, description="Defaults to the widget ID."
    )
    secret: Id = Field(description="The name of the shared secret in the secret store.")
    user_claim: Annotated[str, Field(min_length=1, max_length=64)] = "sub"


def _refuse(why: str) -> Problem:
    log.info("host token refused: %s", why)
    return Problem("forbidden")


def verify_shared_secret(
    token: str, identity: Identity, widget_id: str, keys: dict[str, bytes]
) -> tuple[str, str, int]:
    """The host's user ID, the token's one-time ID and its expiry, from a token signed with the widget's secret.
    Raises Problem("forbidden") for any token that does not pass every check."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as error:
        raise _refuse(f"not a token: {type(error).__name__}") from error
    if header.get("alg") != "HS256":  # only the algorithm we expect, so a public key can never pose as the secret
        raise _refuse(f"algorithm {header.get('alg')!r}")
    # The secret the token names; with no name, each of the widget's secrets (two while one is being replaced).
    if "kid" in header:
        candidates = [keys[header["kid"]]] if header["kid"] in keys else []
    else:
        candidates = list(keys.values())
    for key in candidates:
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=["HS256"],
                audience=identity.audience or widget_id,
                issuer=identity.issuer,
                leeway=LEEWAY,
                options={"require": REQUIRED},
            )
            break
        except jwt.InvalidSignatureError:
            continue
        except jwt.PyJWTError as error:
            raise _refuse(type(error).__name__) from error
    else:
        raise _refuse("signature matches no secret")
    if not isinstance(claims["iat"], int | float) or claims["exp"] - claims["iat"] > MAX_LIFETIME:
        raise _refuse("lifetime over 10 minutes")
    subject, jti = claims.get(identity.user_claim), claims["jti"]
    if not isinstance(subject, str) or not 0 < len(subject) <= 256 or not isinstance(jti, str) or not jti:
        raise _refuse("user or token ID missing")
    return subject, hashlib.sha256(jti.encode()).hexdigest(), int(claims["exp"])


def expiry(seconds: int) -> datetime:
    return datetime.fromtimestamp(seconds + LEEWAY, UTC)
