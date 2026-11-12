"""Tokens from a host's identity provider (M5-T4): unit, backend and integration tests against a stand-in provider on
a real port. The same path runs against a real provider (Keycloak) in the pipeline: tests/test_keycloak.py."""

import asyncio
import json
import secrets
import threading
import time

import jwt
import pytest
import uvicorn
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from tests.fakeidp import FakeProvider
from tests.test_public import document
from tests.test_sessions import KEYS
from ucp.gateway.app import create_app
from ucp.settings import Settings
from ucp.store import Store
from ucp.widgets import parse, seed


@pytest.fixture(scope="module")
def provider():
    fake = FakeProvider()
    server = uvicorn.Server(uvicorn.Config(fake.app(), host="127.0.0.1", port=0, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.01)
    fake.base_url = f"http://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    yield fake
    server.should_exit = True
    thread.join(5)


@pytest.fixture
def fresh(provider):
    """The provider back to its first two keys and up, for each test."""
    provider.published = ["rsa-1", "ec-1"]
    provider.down = False
    return provider


@pytest.fixture
def widget_id(database_url, fresh):
    widget_id = f"w_{secrets.token_hex(4)}"
    identity = {"provider": "college-idp", "issuer": fresh.base_url, "audience": "chat-widget"}

    async def publish():
        engine = create_async_engine(database_url)
        await seed(Store(engine), {widget_id: document(sign_in="signed_in", identity=identity)})
        await engine.dispose()

    asyncio.run(publish())
    return widget_id


@pytest.fixture
def client(database_url, widget_id):
    with TestClient(create_app(Settings(database_url=database_url, session_keys=KEYS))) as client:
        yield client


def start(client, widget_id, token):
    return client.post("/v1/sessions", json={"widget_id": widget_id, "host_token": token})


def user_of(response) -> str:
    assert response.status_code == 200, response.text
    claims = jwt.decode(response.json()["token"], options={"verify_signature": False})
    assert claims["mode"] == "signed_in"
    return claims["sub"]


def test_rsa_and_elliptic_curve_tokens_both_sign_the_same_person_in(client, widget_id, fresh):
    by_rsa = user_of(start(client, widget_id, fresh.token()))
    by_ec = user_of(start(client, widget_id, fresh.token(kid="ec-1", algorithm="ES256")))

    assert by_rsa == by_ec


def test_a_provider_token_may_start_several_sessions_in_its_lifetime(client, widget_id, fresh):
    token = fresh.token()

    assert user_of(start(client, widget_id, token)) == user_of(start(client, widget_id, token))


REFUSED = {
    "wrong audience": lambda p: p.token(audience="someone-else"),
    "wrong issuer": lambda p: p.token(iss="https://evil.example"),
    "expired": lambda p: p.token(iat=int(time.time()) - 7200, exp=int(time.time()) - 60),
    "lasting over a day": lambda p: p.token(exp=int(time.time()) + 90_000),
    "missing its expiry": lambda p: p.token(exp=None),
    "missing its audience": lambda p: p.token(aud=None),
    "missing the user": lambda p: p.token(sub=None),
    "a key the provider never published": lambda p: jwt.encode(
        {"iss": p.base_url, "aud": "chat-widget", "sub": "u", "iat": int(time.time()), "exp": int(time.time()) + 60},
        p.private["rsa-1"],
        algorithm="RS256",
        headers={"kid": "rsa-unknown"},
    ),
    "HMAC with the public key as its secret": lambda p: jwt.api_jws.PyJWS().encode(
        json.dumps({"iss": p.base_url, "aud": "chat-widget", "sub": "u", "iat": 1, "exp": 9_999_999_999}).encode(),
        b"public key bytes, as a careless verifier would use them",
        algorithm="HS256",
        headers={"kid": "rsa-1"},
    ),
    "unsigned": lambda p: jwt.encode({"iss": p.base_url, "aud": "chat-widget", "sub": "u"}, None, algorithm="none"),
}


@pytest.mark.parametrize("make", REFUSED.values(), ids=REFUSED.keys())
def test_a_doubtful_provider_token_is_refused(client, widget_id, fresh, make):
    response = start(client, widget_id, make(fresh))

    assert response.status_code == 403 and response.json()["code"] == "forbidden"


def test_a_key_the_provider_rotates_in_is_found_without_a_restart(client, widget_id, fresh):
    user_of(start(client, widget_id, fresh.token()))
    fresh.add("rsa-2", "RS256")
    fresh.published = ["rsa-2"]
    client.app.state.provider_keys.RETRY = 0  # in production at most one look a minute; here at once

    assert user_of(start(client, widget_id, fresh.token(kid="rsa-2")))


def test_made_up_key_ids_cannot_make_us_hammer_the_provider(client, widget_id, fresh):
    user_of(start(client, widget_id, fresh.token()))
    before = fresh.key_fetches

    for _ in range(9):  # under the limit on refusals from one address, which would stop them sooner
        token = jwt.encode(
            {"sub": "u"}, fresh.private["rsa-1"], algorithm="RS256", headers={"kid": secrets.token_hex(4)}
        )
        assert start(client, widget_id, token).status_code == 403
    assert fresh.key_fetches - before <= 1


def test_while_the_provider_is_down_its_keys_are_used_until_they_are_too_old_then_visitors_are_refused(
    client, widget_id, fresh
):
    user_of(start(client, widget_id, fresh.token()))
    fresh.down = True
    keys = client.app.state.provider_keys
    keys.FRESH, keys.RETRY = 0, 0  # every sign-in now tries the provider, and fails

    assert user_of(start(client, widget_id, fresh.token()))  # the keys held still work
    keys.USABLE = 0
    refused = start(client, widget_id, fresh.token())
    assert refused.status_code == 503 and refused.json()["code"] == "assistant_unavailable"


def test_a_provider_down_from_the_start_refuses_visitors_as_unavailable_not_as_forbidden(client, widget_id, fresh):
    fresh.down = True

    response = start(client, widget_id, fresh.token())

    assert response.status_code == 503 and response.json()["code"] == "assistant_unavailable"


def test_an_identity_provider_must_be_reached_over_https():
    identity = {"provider": "college-idp", "issuer": "http://idp.example.org"}

    with pytest.raises(ValueError):
        parse("w_x", 1, document(sign_in="signed_in", identity=identity))
