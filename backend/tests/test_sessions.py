"""Sessions, tokens, limits and the same-origin rule (M4-T2, M4-T4): unit, backend and middleware tests."""

import asyncio
import secrets
import time
from typing import Annotated

import jwt
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from tests.test_public import document
from ucp.gateway.api import visitor
from ucp.gateway.app import create_app
from ucp.gateway.pipeline import Problem
from ucp.sessions import Keys, Limiter, Session
from ucp.settings import Settings
from ucp.store import Store
from ucp.widgets import seed

IDENTITY = {"provider": "college-portal", "issuer": "https://portal.example.ac.uk", "secret": "portal"}

KEYS = "k2:" + "b" * 32 + ",k1:" + "a" * 32
SESSION = Session("u_1", "t_college", "w_1", 1, "anonymous")


@pytest.fixture
def widgets(database_url):
    ids = {name: f"w_{secrets.token_hex(4)}" for name in ("open", "members", "strict")}
    documents = {
        ids["open"]: document(),
        ids["members"]: document(sign_in="signed_in", identity=IDENTITY),
        ids["strict"]: document(limits={"sessions_per_minute_per_address": 2}),
    }

    async def publish():
        engine = create_async_engine(database_url)
        await seed(Store(engine), documents)
        await engine.dispose()

    asyncio.run(publish())
    return ids


@pytest.fixture
def client(database_url, widgets):
    app = create_app(Settings(database_url=database_url, session_keys=KEYS))

    @app.get("/v1/test/me")
    async def me(session: Annotated[Session, Depends(visitor)]) -> dict:
        return session.__dict__

    with TestClient(app, base_url="https://chat.example.net") as client:
        yield client


def start(client, widget_id, host_token=None, **headers):
    return client.post("/v1/sessions", json={"widget_id": widget_id, "host_token": host_token}, headers=headers)


def test_an_anonymous_visitor_gets_a_token_that_carries_only_opaque_ids(client, widgets):
    response = start(client, widgets["open"])

    assert response.status_code == 200 and response.json()["expires_in"] == 3600
    token = response.json()["token"]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims.keys() == {"sub", "tid", "wid", "cv", "mode", "iat", "exp"}
    assert (claims["tid"], claims["wid"], claims["cv"], claims["mode"]) == (
        "t_college",
        widgets["open"],
        1,
        "anonymous",
    )
    assert claims["sub"].startswith("u_") and jwt.get_unverified_header(token)["kid"] == "k2"
    assert client.get("/v1/test/me", headers={"authorization": f"Bearer {token}"}).json()["user_id"] == claims["sub"]


def test_each_session_is_a_new_anonymous_visitor(client, widgets):
    tokens = [start(client, widgets["open"]).json()["token"] for _ in range(2)]

    assert len({jwt.decode(t, options={"verify_signature": False})["sub"] for t in tokens}) == 2


def test_a_token_sent_to_an_anonymous_widget_and_no_token_sent_to_a_members_widget_are_refused(client, widgets):
    assert start(client, widgets["open"], host_token="a.b.c").json()["code"] == "forbidden"
    assert start(client, widgets["members"]).json()["code"] == "forbidden"


def test_an_unknown_widget_starts_no_session(client):
    response = start(client, "w_nobody")

    assert response.status_code == 404 and response.json()["code"] == "not_found"


def test_sessions_per_address_are_limited_with_a_hint_when_to_try_again(client, widgets):
    assert [start(client, widgets["strict"]).status_code for _ in range(2)] == [200, 200]
    refused = start(client, widgets["strict"])

    assert refused.status_code == 429 and refused.json()["retryable"] is True
    assert 0 < int(refused.headers["retry-after"]) <= 60


def test_another_sites_page_is_refused_and_never_told_it_may_read_the_reply(client, widgets):
    elsewhere = start(client, widgets["open"], origin="https://evil.example")
    ours = start(client, widgets["open"], origin="https://chat.example.net")
    preflight = client.options("/v1/sessions", headers={"origin": "https://evil.example"})

    assert elsewhere.status_code == 403 and elsewhere.json()["code"] == "forbidden"
    assert ours.status_code == 200
    for response in (elsewhere, ours, preflight):
        assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize(
    "authorization",
    [
        None,
        "Basic dXNlcjpwYXNz",
        "Bearer ",
        "Bearer not-a-token",
        "Bearer " + Keys("k1:" + "a" * 32).issue(SESSION, seconds=-120),  # expired beyond the clock leeway
        "Bearer " + Keys("k9:" + "c" * 32).issue(SESSION),  # signed with a key we do not hold
        "Bearer " + jwt.encode({**SESSION.__dict__, "exp": time.time() + 60}, "a" * 32, headers={"kid": "k1"}),
        "Bearer " + jwt.encode({"sub": "u_1", "exp": time.time() + 60}, None, algorithm="none"),
    ],
    ids=["none", "basic", "empty", "garbage", "expired", "unknown-key", "missing-claims", "unsigned"],
)
def test_any_doubtful_token_is_an_ended_session(client, authorization):
    headers = {"authorization": authorization} if authorization else {}
    response = client.get("/v1/test/me", headers=headers)

    assert response.status_code == 401 and response.json()["code"] == "session_expired"


def test_an_altered_token_is_refused():
    keys = Keys(KEYS)
    header, payload, signature = keys.issue(SESSION).split(".")
    forged = jwt.encode(
        {**jwt.decode(keys.issue(SESSION), options={"verify_signature": False}), "tid": "t_other"}, "x" * 32
    )

    with pytest.raises(Problem):
        keys.verify(f"{header}.{forged.split('.')[1]}.{signature}")


def test_a_token_from_the_previous_key_still_works_after_rotation():
    before = Keys("k1:" + "a" * 32).issue(SESSION)

    assert Keys(KEYS).verify(before) == SESSION


@pytest.mark.parametrize("keys", ["", "k1", "k1:short", ":" + "a" * 32 + ",k2:short"])
def test_weak_or_malformed_keys_stop_the_gateway_from_starting(keys):
    with pytest.raises(ValueError):
        Keys(keys)


def test_the_limiter_counts_a_rolling_minute_per_key():
    limiter = Limiter()
    for _ in range(3):
        limiter.check("a", 3)
    limiter.check("b", 3)

    with pytest.raises(Problem) as refused:
        limiter.check("a", 3)
    assert refused.value.code == "rate_limited" and 0 < refused.value.retry_after <= 60
    limiter.hits["a"] = type(limiter.hits["a"])(t - 61 for t in limiter.hits["a"])
    limiter.check("a", 3)
