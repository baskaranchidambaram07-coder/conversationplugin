"""Signed-in visitors (M5): the host-token matrix (unit), sessions in each mode (backend), what the session decides
(middleware), identity mapping and history (integration with PostgreSQL), and the security checks."""

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import create_async_engine

from tests.test_public import document
from tests.test_sessions import KEYS
from ucp.gateway.app import create_app
from ucp.gateway.pipeline import Problem
from ucp.identity import LEEWAY, Identity, verify_shared_secret
from ucp.settings import Settings
from ucp.store import Store
from ucp.widgets import parse, seed

SECRET, OLD_SECRET = "s" * 32, "o" * 32
ISSUER = "https://portal.example.ac.uk"
IDENTITY = {"provider": "college-portal", "issuer": ISSUER, "secret": "portal"}
WIDGET = "w_portal"


def host_token(audience: str = WIDGET, *, key: str = SECRET, kid: str | None = "k1", alg="HS256", drop=(), **changes):
    """A token as the customer's backend signs it, changed as a test needs."""
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": audience, "sub": "resident-42", "iat": now, "exp": now + 300}
    claims = {**claims, "jti": secrets.token_hex(8), **changes}
    for name in drop:
        claims.pop(name)
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": kid} if kid else None)


def check(token: str, **identity):
    keys = {"k1": SECRET.encode(), "k0": OLD_SECRET.encode()}
    return verify_shared_secret(token, Identity(**{**IDENTITY, **identity}), WIDGET, keys)[0]


# The token matrix (unit)

now = int(time.time())
RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC_PEM = RSA_KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
)


def hand_signed(key: bytes) -> str:
    """HS256 made by hand, as an attacker would, with the key a careless verifier might use."""
    part = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=")  # noqa: E731
    claims = {"iss": ISSUER, "aud": WIDGET, "sub": "u", "iat": now, "exp": now + 60, "jti": "j"}
    signed = part({"alg": "HS256", "typ": "JWT"}) + b"." + part(claims)
    signature = base64.urlsafe_b64encode(hmac.new(key, signed, hashlib.sha256).digest()).rstrip(b"=")
    return (signed + b"." + signature).decode()


REFUSED = {
    "expired": lambda: host_token(iat=now - 400, exp=now - LEEWAY - 2),
    "not yet valid": lambda: host_token(nbf=now + LEEWAY + 30),
    "signed in the future": lambda: host_token(iat=now + LEEWAY + 30, exp=now + LEEWAY + 300),
    "wrong audience": lambda: host_token("w_another"),
    "wrong issuer": lambda: host_token(iss="https://evil.example"),
    "bad signature": lambda: host_token(key="x" * 32),
    "unsigned": lambda: jwt.encode(
        {"iss": ISSUER, "aud": WIDGET, "sub": "u", "iat": now, "exp": now + 60, "jti": "j"}, None, algorithm="none"
    ),
    "another HMAC algorithm": lambda: host_token(alg="HS512", key="s" * 64),
    "an RSA token": lambda: host_token(alg="RS256", key=RSA_KEY),
    "the public key posing as the secret": lambda: hand_signed(PUBLIC_PEM),
    "unknown key ID": lambda: host_token(kid="k9"),
    "lasting over 10 minutes": lambda: host_token(iat=now, exp=now + 601),
    "an empty user": lambda: host_token(sub=""),
    "a user that is not text": lambda: host_token(sub=42),
    **{
        f"missing {claim}": (lambda claim=claim: host_token(drop=(claim,)))
        for claim in ("iss", "aud", "sub", "iat", "exp", "jti")
    },
    "not a token at all": lambda: "not.a.token",
}


@pytest.mark.parametrize("make", REFUSED.values(), ids=REFUSED.keys())
def test_a_doubtful_host_token_is_refused(make):
    with pytest.raises(Problem) as refused:
        check(make())
    assert refused.value.code == "forbidden"


def test_a_good_host_token_gives_the_hosts_user_id():
    assert check(host_token()) == "resident-42"


def test_clock_differences_up_to_the_tolerance_are_accepted():
    at = int(time.time())  # not the module's `now`: 5 seconds of margin must not depend on how long the run took
    assert check(host_token(iat=at - 400, exp=at - LEEWAY + 5)) == "resident-42"
    assert check(host_token(nbf=at + LEEWAY - 5)) == "resident-42"


def test_during_a_secret_rotation_both_secrets_are_accepted_named_or_not():
    assert check(host_token(key=OLD_SECRET, kid="k0")) == "resident-42"
    assert check(host_token(key=OLD_SECRET, kid=None)) == "resident-42"


def test_the_user_may_come_from_another_claim():
    assert check(host_token(employee="e-7"), user_claim="employee") == "e-7"


# Sessions through the gateway (backend, middleware, integration)


@pytest.fixture
def widgets(database_url):
    ids = {name: f"w_{secrets.token_hex(4)}" for name in ("both", "members", "open", "other_tenant")}
    documents = {
        ids["both"]: document(sign_in="both", identity=IDENTITY),
        ids["members"]: document(sign_in="signed_in", identity=IDENTITY),
        ids["open"]: document(),
        ids["other_tenant"]: document(tenant_id="t_other", sign_in="both", identity=IDENTITY),
    }

    async def publish():
        engine = create_async_engine(database_url)
        await seed(Store(engine), documents)
        await engine.dispose()

    asyncio.run(publish())
    return ids


@pytest.fixture
def client(database_url, widgets):
    settings = Settings(
        database_url=database_url,
        session_keys=KEYS,
        host_secrets=json.dumps({"portal": f"k1:{SECRET},k0:{OLD_SECRET}"}),
    )
    with TestClient(create_app(settings), base_url="https://chat.example.net") as client:
        yield client


def start(client, widget_id, host_token=None):
    return client.post("/v1/sessions", json={"widget_id": widget_id, "host_token": host_token})


def claims_of(response) -> dict:
    assert response.status_code == 200, response.text
    return jwt.decode(response.json()["token"], options={"verify_signature": False})


def test_a_signed_in_visitor_gets_a_short_renewable_session_as_the_same_user_each_time(client, widgets):
    first = start(client, widgets["both"], host_token(widgets["both"]))
    again = claims_of(start(client, widgets["both"], host_token(widgets["both"])))
    other = claims_of(start(client, widgets["both"], host_token(widgets["both"], sub="resident-7")))

    assert first.json()["expires_in"] == 900
    assert claims_of(first)["mode"] == "signed_in" and again["sub"] == claims_of(first)["sub"] != other["sub"]
    assert "resident" not in first.json()["token"]  # the host's ID for the user never reaches the browser


def test_the_same_host_user_is_a_different_user_in_another_tenant(client, widgets):
    here = claims_of(start(client, widgets["both"], host_token(widgets["both"])))
    there = claims_of(start(client, widgets["other_tenant"], host_token(widgets["other_tenant"])))

    assert here["sub"] != there["sub"]


def test_each_widget_takes_only_the_visitors_it_is_set_up_for(client, widgets):
    assert claims_of(start(client, widgets["both"]))["mode"] == "anonymous"
    assert start(client, widgets["members"]).json()["code"] == "forbidden"
    assert claims_of(start(client, widgets["members"], host_token(widgets["members"])))["mode"] == "signed_in"
    assert start(client, widgets["open"], host_token(widgets["open"])).json()["code"] == "forbidden"


def test_a_token_made_for_one_widget_is_refused_by_another(client, widgets):
    response = start(client, widgets["members"], host_token(widgets["both"]))

    assert response.status_code == 403 and response.json()["code"] == "forbidden"


def test_a_host_token_works_once_only(client, widgets):
    token = host_token(widgets["both"])

    assert start(client, widgets["both"], token).status_code == 200
    replay = start(client, widgets["both"], token)
    assert replay.status_code == 403 and replay.json()["code"] == "forbidden"


def test_an_oversized_token_is_refused_before_anything_reads_it(client, widgets):
    response = start(client, widgets["both"], "x" * 8193)

    assert response.status_code == 400 and response.json()["code"] == "invalid_request"


def test_repeated_refusals_from_one_address_must_wait(client, widgets):
    codes = [start(client, widgets["both"], host_token(widgets["both"], key="x" * 32)).status_code for _ in range(11)]

    assert codes == [403] * 10 + [429]


def test_a_refusal_says_nothing_about_which_check_failed(client, widgets):
    bodies = {
        name: {k: v for k, v in start(client, widgets["both"], make()).json().items() if k != "reference"}
        for name, make in {
            "expired": lambda: host_token(widgets["both"], iat=now - 400, exp=now - 60),
            "wrong issuer": lambda: host_token(widgets["both"], iss="https://evil.example"),
            "bad signature": lambda: host_token(widgets["both"], key="y" * 32),
        }.items()
    }

    assert len({str(body) for body in bodies.values()}) == 1


def test_a_widget_whose_secret_is_not_configured_is_unavailable_not_open(database_url, widgets):
    with TestClient(create_app(Settings(database_url=database_url, session_keys=KEYS))) as client:
        response = start(client, widgets["both"], host_token(widgets["both"]))

    assert response.status_code == 503 and response.json()["code"] == "assistant_unavailable"


def test_a_signed_in_users_history_follows_them_and_no_one_else(client, widgets):
    def auth(sub):
        token = start(client, widgets["both"], host_token(widgets["both"], sub=sub)).json()["token"]
        return {"authorization": f"Bearer {token}"}

    mine = client.post("/v1/conversations", headers=auth("resident-42")).json()["id"]

    listed = client.get("/v1/conversations", headers=auth("resident-42")).json()["conversations"]
    assert [c["id"] for c in listed] == [mine]  # a new session, the same person, the same history
    assert client.get("/v1/conversations", headers=auth("resident-7")).json()["conversations"] == []


def test_no_request_field_can_change_who_the_caller_is(client, widgets):
    token = start(client, widgets["both"], host_token(widgets["both"], sub="resident-42")).json()["token"]
    mine = {"authorization": f"Bearer {token}"}
    other = start(client, widgets["both"], host_token(widgets["both"], sub="resident-7")).json()["token"]
    theirs = client.post("/v1/conversations", headers={"authorization": f"Bearer {other}"}).json()["id"]
    claims = jwt.decode(other, options={"verify_signature": False})

    forged = {"x-user-id": claims["sub"], "x-tenant-id": "t_college", "x-widget-id": widgets["both"]}
    query = f"?user_id={claims['sub']}&tenant_id=t_college"
    assert client.get(f"/v1/conversations{query}", headers={**mine, **forged}).json()["conversations"] == []
    assert client.get(f"/v1/conversations/{theirs}/messages{query}", headers={**mine, **forged}).status_code == 404
    smuggled = client.post(
        f"/v1/conversations/{theirs}/messages",
        json={"text": "Hi", "client_message_id": "k1", "user_id": claims["sub"]},
        headers=mine,
    )
    assert smuggled.status_code == 400  # an unknown field is refused, never read


def test_a_widget_for_signed_in_visitors_cannot_be_published_without_identity_settings():
    for sign_in in ("signed_in", "both"):
        with pytest.raises(ValidationError):
            parse("w_x", 1, document(sign_in=sign_in))
