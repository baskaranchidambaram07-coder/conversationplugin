"""Signing in through a real identity provider (M5 integration): Keycloak, run by the pipeline in a container.

Skipped unless KEYCLOAK_URL is set: the build machine has no Docker. The pipeline job "Sign-in through a real
identity provider" starts Keycloak and runs this file.
"""

import asyncio
import os
import secrets

import httpx2
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from tests.test_public import document
from tests.test_sessions import KEYS
from ucp.admin.app import create_app as admin_api
from ucp.admin.records import Records
from ucp.gateway.app import create_app
from ucp.settings import Settings
from ucp.store import Store
from ucp.widgets import seed

KEYCLOAK = os.environ.get("KEYCLOAK_URL", "")
REALM = f"{KEYCLOAK}/realms/college"
pytestmark = pytest.mark.skipif(not KEYCLOAK, reason="KEYCLOAK_URL is not set; the pipeline runs a real Keycloak")


@pytest.fixture(scope="module")
def admin():
    """Keycloak's admin API, with a realm made for this run: a public client for the widget, another app, a user."""
    reply = httpx2.post(
        f"{KEYCLOAK}/realms/master/protocol/openid-connect/token",
        data={"grant_type": "password", "client_id": "admin-cli", "username": "admin", "password": "admin"},
    )
    api = httpx2.Client(
        base_url=f"{KEYCLOAK}/admin/realms", headers={"authorization": f"Bearer {reply.json()['access_token']}"}
    )
    api.delete("/college")
    api.post("", json={"realm": "college", "enabled": True}).raise_for_status()
    for client in ("chat-widget", "another-app", "ucp-console"):
        body = {"clientId": client, "publicClient": True, "directAccessGrantsEnabled": True, "enabled": True}
        api.post("/college/clients", json=body).raise_for_status()
    for name in ("resident", "visitor"):
        user = {
            "username": name,
            "enabled": True,
            "email": f"{name}@example.org",
            "emailVerified": True,
            "firstName": name.title(),
            "lastName": "Test",
            "credentials": [{"type": "password", "value": "test-password", "temporary": False}],
        }
        api.post("/college/users", json=user).raise_for_status()
    yield api
    api.close()


def id_token(username: str = "resident", client: str = "chat-widget") -> str:
    reply = httpx2.post(
        f"{REALM}/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": client,
            "username": username,
            "password": "test-password",
            "scope": "openid",
        },
    )
    return reply.raise_for_status().json()["id_token"]


@pytest.fixture
def gateway(database_url, admin):
    widget_id = f"w_{secrets.token_hex(4)}"
    identity = {"provider": "college-keycloak", "issuer": REALM, "audience": "chat-widget"}

    async def publish():
        engine = create_async_engine(database_url)
        await seed(Store(engine), {widget_id: document(sign_in="signed_in", identity=identity)})
        await engine.dispose()

    asyncio.run(publish())
    with TestClient(create_app(Settings(database_url=database_url, session_keys=KEYS))) as client:
        client.widget_id = widget_id
        yield client


def start(gateway, token: str):
    return gateway.post("/v1/sessions", json={"widget_id": gateway.widget_id, "host_token": token})


def user_of(response) -> str:
    assert response.status_code == 200, response.text
    return jwt.decode(response.json()["token"], options={"verify_signature": False})["sub"]


def test_a_keycloak_user_signs_in_and_comes_back_as_the_same_user_with_their_history(gateway):
    first = start(gateway, id_token())
    auth = {"authorization": f"Bearer {first.json()['token']}"}
    conversation = gateway.post("/v1/conversations", headers=auth).json()["id"]

    again = start(gateway, id_token())
    other = start(gateway, id_token("visitor"))

    assert user_of(again) == user_of(first) != user_of(other)
    listed = gateway.get("/v1/conversations", headers={"authorization": f"Bearer {again.json()['token']}"})
    assert [c["id"] for c in listed.json()["conversations"]] == [conversation]


def test_a_token_keycloak_issued_for_another_application_is_refused(gateway):
    response = start(gateway, id_token(client="another-app"))

    assert response.status_code == 403 and response.json()["code"] == "forbidden"


def test_keycloak_rotating_its_signing_key_is_followed_without_a_restart(gateway, admin):
    before = id_token()
    assert user_of(start(gateway, before))
    realm_id = admin.get("/college").json()["id"]
    rotated = {
        "name": "rotated",
        "providerId": "rsa-generated",
        "providerType": "org.keycloak.keys.KeyProvider",
        "parentId": realm_id,
        "config": {"priority": ["500"], "active": ["true"], "enabled": ["true"]},
    }
    admin.post("/college/components", json=rotated).raise_for_status()
    gateway.app.state.provider_keys.RETRY = 0  # in production at most one look a minute; here at once

    after = id_token()
    assert jwt.get_unverified_header(after)["kid"] != jwt.get_unverified_header(before)["kid"]
    assert user_of(start(gateway, after)) == user_of(start(gateway, before))


def test_an_administrator_signs_in_to_the_admin_api_with_keycloak(database_url, admin):
    console = id_token("visitor", client="ucp-console")
    subject = jwt.decode(console, options={"verify_signature": False})["sub"]

    async def promote():
        engine = create_async_engine(database_url)
        await Records(engine).add_administrator(REALM, subject, "platform", None, "visitor", "test")
        await engine.dispose()

    asyncio.run(promote())
    settings = Settings(database_url=database_url, admin_issuer=REALM, admin_audience="ucp-console")
    with TestClient(admin_api(settings)) as api:
        me = api.get("/admin/v1/me", headers={"authorization": f"Bearer {console}"})
        assert me.json() == {"subject": subject, "role": "platform", "tenant_id": None}
        widget_token = {"authorization": f"Bearer {id_token('visitor')}"}  # Keycloak's, but made for the chat
        assert api.get("/admin/v1/me", headers=widget_token).json()["code"] == "sign_in_required"
