"""Who a signed-in visitor is (M5-T3 to M5-T5).

A signed-in visitor arrives with a token from the customer's side, which the gateway checks before starting a
session. Either the customer's backend signs a short token with the widget's shared secret, as described below, or
the host passes on the token its own identity provider issued (Entra ID, Okta, Keycloak and the like), which is
checked against the provider's published keys.

The host token, signed with HS256 using a secret the widget's settings name:

    header   {"alg": "HS256", "typ": "JWT", "kid": "<which secret, optional>"}
    claims   iss  the issuer the widget's settings name          aud  the widget ID (unless the settings say otherwise)
             sub  the host's stable ID for the user, never an email address or a name
             iat  when it was signed     exp  at most 10 minutes later     jti  random, used once only
             nbf  optional

An identity provider's token is checked the same way, against the issuer and audience the widget's settings name,
with an asymmetric algorithm only and a lifetime of at most a day. It is not one-time: providers hand out the same
token for its whole life.

Anything wrong with a token (signature, issuer, audience, times, lifetime, reuse, a missing claim) refuses it the
same way, so a caller learns nothing about which check failed. The reason goes to our log only.
"""

import asyncio
import hashlib
import logging
import time
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urlsplit

import httpx2
import jwt
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ucp.gateway.pipeline import Problem
from ucp.protocol import Id

log = logging.getLogger("ucp.identity")

LEEWAY = 30  # seconds of clock difference between the customer's servers and ours
MAX_LIFETIME = 600  # a shared-secret token is made for one sign-in, so it never needs to last long
REQUIRED = ["iss", "aud", "sub", "iat", "exp", "jti"]
PROVIDER_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384"]  # never HS*: a public key is no secret
PROVIDER_MAX_LIFETIME = 86_400


class Identity(BaseModel):
    """How a widget's signed-in visitors prove who they are. Part of the widget's private settings."""

    model_config = ConfigDict(strict=True, extra="forbid")

    provider: Id = Field(description="Our name for where these users come from; with the tenant, it keys each user.")
    issuer: Annotated[str, Field(min_length=1, max_length=512)]
    audience: Annotated[str, Field(min_length=1, max_length=512)] | None = Field(
        default=None, description="Defaults to the widget ID."
    )
    secret: Id | None = Field(
        default=None,
        description="The name of the shared secret in the secret store. Without one, tokens come from the identity "
        "provider at `issuer`, whose keys are found by OpenID Connect discovery.",
    )
    user_claim: Annotated[str, Field(min_length=1, max_length=64)] = "sub"

    @model_validator(mode="after")
    def _provider_over_https(self) -> "Identity":
        if not self.secret and not _secure(self.issuer):
            raise ValueError("an identity provider is reached over https (http only on this machine, for tests)")
        return self


def _secure(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1"))


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


class ProviderKeys:
    """The public keys of the identity providers widgets trust, found by OpenID Connect discovery (M5-T4).

    Keys are kept for an hour. A token naming a key we do not hold makes us look again, at most once a minute per
    provider, which follows a provider's key rotation without a restart. If the provider cannot be reached, the
    keys already held keep working until they are a day old; after that its visitors are refused until it answers.
    """

    FRESH, USABLE, RETRY = 3600, 86_400, 60

    def __init__(self, client: httpx2.AsyncClient):
        self.client = client
        self.held: dict[str, tuple[float | None, dict[str, jwt.PyJWK]]] = {}
        self.tried: dict[str, float] = {}
        self.locks: dict[str, asyncio.Lock] = {}

    async def key(self, issuer: str, kid: str) -> jwt.PyJWK | None:
        """The provider's key with that ID, or None if it has none. Raises Problem if no keys can be had at all."""
        async with self.locks.setdefault(issuer, asyncio.Lock()):
            fetched, keys = self.held.get(issuer, (None, {}))
            now = time.monotonic()
            stale = fetched is None or now - fetched >= self.FRESH or kid not in keys
            if stale and now - self.tried.get(issuer, -self.RETRY) >= self.RETRY:
                self.tried[issuer] = now
                try:
                    keys = await self._fetch(issuer)
                    fetched = now
                    self.held[issuer] = (fetched, keys)
                except (httpx2.HTTPError, ValueError, KeyError, TypeError, jwt.PyJWTError) as error:
                    log.warning("identity provider %s keys unavailable: %s", issuer, type(error).__name__)
            if fetched is None or now - fetched >= self.USABLE:
                raise Problem("assistant_unavailable", retryable=True)  # no keys we may still trust
            return keys.get(kid)

    async def _fetch(self, issuer: str) -> dict[str, jwt.PyJWK]:
        discovery = (await self.client.get(f"{issuer.rstrip('/')}/.well-known/openid-configuration")).raise_for_status()
        address = discovery.json()["jwks_uri"]
        if not _secure(address):
            raise ValueError("the provider's keys are not served over https")
        published = jwt.PyJWKSet.from_dict((await self.client.get(address)).raise_for_status().json())
        return {key.key_id: key for key in published.keys if key.key_id}


async def verify_provider_token(token: str, identity: Identity, widget_id: str, provider_keys: ProviderKeys) -> str:
    """The user ID from a token the widget's identity provider issued. Raises Problem("forbidden") for any token
    that does not pass every check, and Problem("assistant_unavailable") if the provider's keys cannot be had."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as error:
        raise _refuse(f"not a token: {type(error).__name__}") from error
    if header.get("alg") not in PROVIDER_ALGORITHMS or not isinstance(header.get("kid"), str):
        raise _refuse(f"algorithm {header.get('alg')!r} or no key ID")
    key = await provider_keys.key(identity.issuer, header["kid"])
    if not key:
        raise _refuse("the provider has no key with that ID")
    try:
        claims = jwt.decode(
            token,
            key.key,
            algorithms=[header["alg"]],
            audience=identity.audience or widget_id,
            issuer=identity.issuer,
            leeway=LEEWAY,
            options={"require": ["iss", "aud", "iat", "exp"]},
        )
    except jwt.PyJWTError as error:
        raise _refuse(type(error).__name__) from error
    if not isinstance(claims["iat"], int | float) or claims["exp"] - claims["iat"] > PROVIDER_MAX_LIFETIME:
        raise _refuse("lifetime over a day")
    subject = claims.get(identity.user_claim)
    if not isinstance(subject, str) or not 0 < len(subject) <= 256:
        raise _refuse("no user ID")
    return subject


def expiry(seconds: int) -> datetime:
    return datetime.fromtimestamp(seconds + LEEWAY, UTC)
