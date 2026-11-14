"""The admin API (M8): sign-in through the company identity provider, the three roles scoped to tenants, and an
audit entry for every change. Against PostgreSQL and a stand-in identity provider on a real port; the same sign-in
runs against a real Keycloak in the pipeline (tests/test_keycloak.py)."""

import asyncio
import json
import secrets
import time

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.test_pf import profile as pf_profile
from tests.test_provider import provider  # noqa: F401  (the stand-in identity provider, as a fixture)
from tests.test_public import PUBLIC, document
from tests.test_sessions import KEYS
from ucp.admin import app as admin
from ucp.admin.__main__ import main as command
from ucp.admin.records import Records
from ucp.gateway.app import create_app as gateway
from ucp.settings import Settings
from ucp.store import Store
from ucp.vault import Vault, new_key

CONSOLE = "https://console.example.org"
AUDIENCE = "ucp-console"
KEY = new_key()
FAKE = {"base_url": "https://pf.invalid", "tenant": "x", "workspace_id": "x", "agent_version_id": "x", "username": "x"}
OWN_PROFILE = json.dumps({**FAKE, "api_key": "k", "password": "p"})


def run(database_url, work):
    async def go():
        engine = create_async_engine(database_url)
        try:
            return await work(Records(engine))
        finally:
            await engine.dispose()

    return asyncio.run(go())


@pytest.fixture
def world(database_url, provider):  # noqa: F811
    """Two tenants, A and B, with a platform administrator, and a tenant administrator and a viewer in each."""
    tag = secrets.token_hex(3)
    people = {
        "platform": ("platform", None),
        "admin_a": ("tenant", f"t_a{tag}"),
        "viewer_a": ("viewer", f"t_a{tag}"),
        "admin_b": ("tenant", f"t_b{tag}"),
        "viewer_b": ("viewer", f"t_b{tag}"),
    }

    async def make(records):
        for tenant in (f"t_a{tag}", f"t_b{tag}"):
            await records.create_tenant(tenant, f"Tenant {tenant}", "setup")
            # Each tenant's own profile of the name the widgets use, so its own administrators may use it.
            await records.put_secret(Vault(KEY), tenant, "profile", "pf-staging", OWN_PROFILE, "setup", None)
            await Store(records.engine).publish_widget(f"w_{tenant}", tenant, document(tenant_id=tenant), "setup")
        for who, (role, tenant) in people.items():
            await records.add_administrator(provider.base_url, f"{who}-{tag}", role, tenant, who, "setup")

    run(database_url, make)
    settings = Settings(
        database_url=database_url,
        admin_issuer=provider.base_url,
        admin_audience=AUDIENCE,
        admin_origins=CONSOLE,
        secrets_key=KEY,
        agent_profiles=json.dumps({"platform-only": {}}),
    )
    with TestClient(admin.create_app(settings)) as client:
        client.tag, client.provider = tag, provider
        client.a, client.b = f"t_a{tag}", f"t_b{tag}"
        yield client


def bearer(client, who: str, **claims) -> dict:
    token = client.provider.token(audience=AUDIENCE, sub=f"{who}-{client.tag}", **claims)
    return {"authorization": f"Bearer {token}"}


def test_sign_in_needs_the_company_providers_token_for_this_api_and_a_role(world):
    assert world.get("/admin/v1/me").json()["code"] == "sign_in_required"
    assert world.get("/admin/v1/me", headers={"authorization": "Bearer nonsense"}).status_code == 401
    elsewhere = {"authorization": f"Bearer {world.provider.token(audience='another-app', sub=f'platform-{world.tag}')}"}
    assert world.get("/admin/v1/me", headers=elsewhere).status_code == 401
    assert world.get("/admin/v1/me", headers=bearer(world, "stranger")).json()["code"] == "forbidden"

    me = world.get("/admin/v1/me", headers=bearer(world, "viewer_a"))
    assert me.json() == {"subject": f"viewer_a-{world.tag}", "role": "viewer", "tenant_id": f"t_a{world.tag}"}


def test_a_browser_may_call_it_only_from_the_consoles_own_address(world):
    signed = bearer(world, "platform")

    assert world.get("/admin/v1/me", headers={**signed, "origin": "https://evil.example"}).json()["code"] == "forbidden"
    assert world.get("/admin/v1/me", headers={**signed, "origin": CONSOLE}).status_code == 200
    assert "access-control-allow-origin" not in world.get("/admin/v1/me", headers=signed).headers


def test_each_administrator_is_limited_per_minute(world, monkeypatch):
    monkeypatch.setattr(admin, "PER_MINUTE", 3)
    signed = bearer(world, "admin_b")

    assert [world.get("/admin/v1/me", headers=signed).status_code for _ in range(4)] == [200, 200, 200, 429]
    assert world.get("/admin/v1/me", headers=bearer(world, "viewer_b")).status_code == 200


def test_the_public_gateway_serves_no_part_of_the_admin_api(database_url):
    with TestClient(gateway(Settings(database_url=database_url))) as client:
        assert client.get("/admin/v1/me").status_code == 404
        assert client.post("/admin/v1/tenants", json={"name": "x"}).status_code == 404


def test_the_first_administrator_comes_from_the_command_and_is_audited(database_url, provider, monkeypatch):  # noqa: F811
    monkeypatch.setenv("UCP_ADMIN_ISSUER", provider.base_url)
    monkeypatch.setenv("UCP_DATABASE_URL", database_url)
    subject = f"first-{secrets.token_hex(3)}"

    assert asyncio.run(command(["first-administrator", subject, "--label", "Ana", "--by", "ops"])).endswith(
        "is a platform administrator"
    )
    with pytest.raises(SystemExit, match="already an administrator"):
        asyncio.run(command(["first-administrator", subject]))
    found = run(database_url, lambda records: records.audit("*", None, 50))
    assert any(e.actor == "ops" and e.detail["subject"] == subject for e in found)


# The role-by-operation-by-tenant matrix: what each administrator gets, in their own tenant (A) and another (B).
ROLES = ["platform", "admin_a", "viewer_a"]


def newcomer(role: str, tenant_id: str | None = None) -> dict:
    return {"subject": f"new-{secrets.token_hex(3)}", "role": role, "tenant_id": tenant_id}


def operations(tag: str) -> dict:
    a, b = f"t_a{tag}", f"t_b{tag}"
    return {
        "list A's administrators": ("GET", f"/admin/v1/administrators?tenant={a}", None),
        "list B's administrators": ("GET", f"/admin/v1/administrators?tenant={b}", None),
        "read A's audit": ("GET", f"/admin/v1/audit?tenant={a}", None),
        "read B's audit": ("GET", f"/admin/v1/audit?tenant={b}", None),
        "create a tenant": ("POST", "/admin/v1/tenants", {"name": "New"}),
        "add a viewer to A": ("POST", "/admin/v1/administrators", newcomer("viewer", a)),
        "add a viewer to B": ("POST", "/admin/v1/administrators", newcomer("viewer", b)),
        "add a platform administrator": ("POST", "/admin/v1/administrators", newcomer("platform")),
        "remove B's viewer": ("DELETE", f"/admin/v1/administrators/viewer_b-{tag}", None),
        "list A's widgets": ("GET", f"/admin/v1/tenants/{a}/widgets", None),
        "list B's widgets": ("GET", f"/admin/v1/tenants/{b}/widgets", None),
        "create a widget in A": ("POST", f"/admin/v1/tenants/{a}/widgets", {"document": document(tenant_id=a)}),
        "create a widget in B": ("POST", f"/admin/v1/tenants/{b}/widgets", {"document": document(tenant_id=b)}),
        "read A's draft": ("GET", f"/admin/v1/widgets/w_{a}/draft", None),
        "read B's draft": ("GET", f"/admin/v1/widgets/w_{b}/draft", None),
        "save A's draft": ("PUT", f"/admin/v1/widgets/w_{a}/draft", {"revision": 0, "document": document(tenant_id=a)}),
        "save B's draft": ("PUT", f"/admin/v1/widgets/w_{b}/draft", {"revision": 0, "document": document(tenant_id=b)}),
        "publish A's draft": ("POST", f"/admin/v1/widgets/w_{a}/publish", {"revision": 1}),
        "roll A back": ("POST", f"/admin/v1/widgets/w_{a}/rollback", {"version": 1}),
        "list A's versions": ("GET", f"/admin/v1/widgets/w_{a}/versions", None),
        "list B's versions": ("GET", f"/admin/v1/widgets/w_{b}/versions", None),
        "compare A's versions": ("GET", f"/admin/v1/widgets/w_{a}/compare?from=1&to=1", None),
        "list A's secrets": ("GET", f"/admin/v1/tenants/{a}/secrets", None),
        "list B's secrets": ("GET", f"/admin/v1/tenants/{b}/secrets", None),
        "set A's profile": ("PUT", f"/admin/v1/tenants/{a}/agent-profiles/pf-new", json.loads(OWN_PROFILE)),
        "set B's profile": ("PUT", f"/admin/v1/tenants/{b}/agent-profiles/pf-new", json.loads(OWN_PROFILE)),
        "make A a shared secret": ("POST", f"/admin/v1/tenants/{a}/host-secrets/portal", None),
        "make B a shared secret": ("POST", f"/admin/v1/tenants/{b}/host-secrets/portal", None),
    }  # fmt: skip


EXPECTED = {
    #                                platform  admin_a  viewer_a
    "list A's administrators":       (200,     200,     200),
    "list B's administrators":       (200,     404,     404),
    "read A's audit":                (200,     200,     200),
    "read B's audit":                (200,     404,     404),
    "create a tenant":               (201,     403,     403),
    "add a viewer to A":             (201,     201,     403),
    "add a viewer to B":             (201,     404,     404),
    "add a platform administrator":  (201,     403,     403),
    "remove B's viewer":             (204,     404,     404),
    "list A's widgets":              (200,     200,     200),
    "list B's widgets":              (200,     404,     404),
    "create a widget in A":          (201,     201,     403),
    "create a widget in B":          (201,     404,     404),
    "read A's draft":                (200,     200,     200),
    "read B's draft":                (200,     404,     404),
    "save A's draft":                (200,     200,     403),
    "save B's draft":                (200,     404,     404),
    "publish A's draft":             (200,     200,     403),
    "roll A back":                   (200,     200,     403),
    "list A's versions":             (200,     200,     200),
    "list B's versions":             (200,     404,     404),
    "compare A's versions":          (200,     200,     200),
    "list A's secrets":              (200,     200,     200),
    "list B's secrets":              (200,     404,     404),
    "set A's profile":               (200,     200,     403),
    "set B's profile":               (200,     404,     404),
    "make A a shared secret":        (201,     201,     403),
    "make B a shared secret":        (201,     404,     404),
}  # fmt: skip


@pytest.mark.parametrize("role", ROLES)
def test_the_role_matrix(world, role):
    got = {}
    for name, (method, path, body) in operations(world.tag).items():
        got[name] = world.request(method, path, json=body, headers=bearer(world, role)).status_code
    assert got == {name: statuses[ROLES.index(role)] for name, statuses in EXPECTED.items()}


def test_a_tenants_people_see_only_their_own_tenant_and_audit(world):
    a, b = f"t_a{world.tag}", f"t_b{world.tag}"

    assert [t["tenant_id"] for t in world.get("/admin/v1/tenants", headers=bearer(world, "viewer_a")).json()] == [a]
    platform = [t["tenant_id"] for t in world.get("/admin/v1/tenants", headers=bearer(world, "platform")).json()]
    assert {a, b} <= set(platform)
    entries = world.get("/admin/v1/audit", headers=bearer(world, "admin_a")).json()
    assert entries and {entry["tenant_id"] for entry in entries} == {a}
    people = world.get("/admin/v1/administrators", headers=bearer(world, "viewer_a")).json()
    assert {person["tenant_id"] for person in people} == {a}


def test_every_change_is_audited_with_who_made_it(world):
    a = f"t_a{world.tag}"
    body = newcomer("viewer", a)
    subject = body["subject"]
    world.post("/admin/v1/administrators", json=body, headers=bearer(world, "admin_a"))
    world.delete(f"/admin/v1/administrators/{subject}", headers=bearer(world, "admin_a"))
    made = world.post("/admin/v1/tenants", json={"name": "Audited"}, headers=bearer(world, "platform")).json()

    mine = world.get(f"/admin/v1/audit?tenant={a}&limit=5", headers=bearer(world, "platform")).json()
    assert [(e["action"], e["actor"], e["detail"]["subject"]) for e in mine[:2]] == [
        ("administrator.remove", f"admin_a-{world.tag}", subject),
        ("administrator.add", f"admin_a-{world.tag}", subject),
    ]
    created = world.get(f"/admin/v1/audit?tenant={made['tenant_id']}", headers=bearer(world, "platform")).json()
    assert [(e["action"], e["actor"]) for e in created] == [("tenant.create", f"platform-{world.tag}")]


def test_roles_and_tenants_must_agree(world):
    a = f"t_a{world.tag}"

    def add(body):
        return world.post("/admin/v1/administrators", json=body, headers=bearer(world, "platform"))

    assert add(newcomer("platform", a)).status_code == 400
    assert add(newcomer("viewer")).status_code == 400
    assert add(newcomer("viewer", "t_nobody")).json()["code"] == "conflict"  # no such tenant
    assert add({"subject": f"viewer_a-{world.tag}", "role": "viewer", "tenant_id": a}).json()["code"] == "conflict"


# Widgets, drafts and versions (M8-T3, T7)


def titled(world, title: str) -> dict:
    return document(tenant_id=world.a, public={**PUBLIC, "title": title})


def test_a_new_widget_is_a_draft_until_published_then_the_gateway_serves_it(world, database_url):
    signed = bearer(world, "admin_a")
    made = world.post(f"/admin/v1/tenants/{world.a}/widgets", json={"document": titled(world, "Draft")}, headers=signed)
    widget_id = made.json()["widget_id"]
    assert made.status_code == 201 and made.json()["revision"] == 1
    with TestClient(gateway(Settings(database_url=database_url))) as chat:
        assert chat.get(f"/v1/widgets/{widget_id}/config").status_code == 404

    assert world.post(f"/admin/v1/widgets/{widget_id}/publish", json={"revision": 1}, headers=signed).json() == {
        "version": 1
    }
    with TestClient(gateway(Settings(database_url=database_url))) as chat:
        assert chat.get(f"/v1/widgets/{widget_id}/config").json()["title"] == "Draft"
    listed = world.get(f"/admin/v1/tenants/{world.a}/widgets", headers=signed).json()
    entry = next(widget for widget in listed if widget["widget_id"] == widget_id)
    assert (entry["title"], entry["version"], entry["draft"]["revision"], entry["unpublished"]) == (
        "Draft",
        1,
        1,
        False,
    )
    world.put(
        f"/admin/v1/widgets/{widget_id}/draft",
        json={"revision": 1, "document": titled(world, "Changed")},
        headers=signed,
    )
    listed = world.get(f"/admin/v1/tenants/{world.a}/widgets", headers=signed).json()
    entry = next(widget for widget in listed if widget["widget_id"] == widget_id)
    assert (entry["title"], entry["unpublished"]) == ("Changed", True)  # the draft's title, ahead of the live one


def test_two_people_editing_one_draft_cannot_overwrite_each_other_unseen(world):
    path = f"/admin/v1/widgets/w_{world.a}/draft"
    ana, ben = bearer(world, "admin_a"), bearer(world, "platform")
    assert world.get(path, headers=ana).json()["revision"] == 0  # never edited: the live version

    assert world.put(path, json={"revision": 0, "document": titled(world, "Ana's")}, headers=ana).json() == {
        "revision": 1
    }
    late = world.put(path, json={"revision": 0, "document": titled(world, "Ben's")}, headers=ben)
    assert late.status_code == 409 and late.json()["code"] == "conflict"
    current = world.get(path, headers=ben).json()
    assert (current["revision"], current["document"]["public"]["title"]) == (1, "Ana's")
    assert world.put(path, json={"revision": 1, "document": titled(world, "Ben's")}, headers=ben).json() == {
        "revision": 2
    }
    stale = world.post(f"/admin/v1/widgets/w_{world.a}/publish", json={"revision": 1}, headers=ana)
    assert stale.json()["code"] == "conflict"  # Ana publishes what she saw, or nothing


def test_a_draft_with_faults_is_refused_with_every_fault_named(world):
    bad = document(tenant_id=world.a, allowed_domains=["http://example.org", "https://*.ac.uk"])
    bad["public"] = {**PUBLIC, "brand_color": "purple"}
    reply = world.put(
        f"/admin/v1/widgets/w_{world.a}/draft", json={"revision": 0, "document": bad}, headers=bearer(world, "admin_a")
    )

    assert reply.status_code == 400 and reply.json()["code"] == "invalid_request"
    faults = reply.json()["faults"]
    assert len(faults) == 3 and any("brand_color" in f for f in faults) and any("*.ac.uk" in f for f in faults)
    moved = world.put(
        f"/admin/v1/widgets/w_{world.a}/draft",
        json={"revision": 0, "document": document(tenant_id=world.b)},
        headers=bearer(world, "platform"),
    )
    assert "stays in its own tenant" in moved.json()["faults"][0]


def test_rollback_and_comparing_versions(world):
    signed = bearer(world, "admin_a")
    widget = f"/admin/v1/widgets/w_{world.a}"
    world.put(f"{widget}/draft", json={"revision": 0, "document": titled(world, "Two")}, headers=signed)
    assert world.post(f"{widget}/publish", json={"revision": 1}, headers=signed).json() == {"version": 2}

    assert world.get(f"{widget}/compare?from=1&to=2", headers=signed).json() == [
        {"path": "public.title", "from": PUBLIC["title"], "to": "Two"}
    ]
    assert world.post(f"{widget}/rollback", json={"version": 1}, headers=signed).json() == {"version": 3}
    assert world.get(f"{widget}/compare?from=1&to=3", headers=signed).json() == []
    assert [v["version"] for v in world.get(f"{widget}/versions", headers=signed).json()] == [3, 2, 1]
    assert world.get(f"{widget}/versions/9", headers=signed).status_code == 404
    entries = world.get(f"/admin/v1/audit?widget=w_{world.a}", headers=signed).json()
    assert [(e["action"], e["version"]) for e in entries[:3]] == [("rollback", 3), ("publish", 2), ("draft.save", None)]


# Secrets (M8-T4, T5): sealed, never returned, scoped to their tenant


def test_profiles_and_shared_secrets_are_never_returned_nor_stored_in_clear(world, database_url):
    signed = bearer(world, "admin_a")
    body = {**FAKE, "api_key": "key-only-pf-knows", "password": "password-only-pf-knows"}
    profile = world.put(f"/admin/v1/tenants/{world.a}/agent-profiles/pf-college", json=body, headers=signed)
    assert profile.json() == {"name": "pf-college"}
    made = world.post(f"/admin/v1/tenants/{world.a}/host-secrets/portal", headers=signed).json()

    listed = world.get(f"/admin/v1/tenants/{world.a}/secrets", headers=signed)
    assert {(s["kind"], s["name"]) for s in listed.json()} >= {("profile", "pf-college"), ("host", "portal")}
    stored = run(database_url, raw_secrets)
    for words in ("key-only-pf-knows", "password-only-pf-knows", made["secret"]):
        assert words not in listed.text and words.encode() not in stored
    audit = world.get(f"/admin/v1/audit?tenant={world.a}&limit=3", headers=signed).text
    assert "pf-college" in audit and "password-only-pf-knows" not in audit and made["secret"] not in audit


async def raw_secrets(records) -> bytes:
    async with records.engine.connect() as db:
        return b"".join(row.sealed + row.nonce for row in await db.execute(text("SELECT sealed, nonce FROM secrets")))


def signed_by(made: dict, widget: str) -> str:
    now = int(time.time())
    claims = {"iss": "college-portal", "aud": widget, "sub": "resident-7", "iat": now, "exp": now + 300}
    claims["jti"] = secrets.token_hex(8)
    return jwt.encode(claims, made["secret"], algorithm="HS256", headers={"kid": made["key_id"]})


def test_a_new_shared_secret_works_at_once_and_the_one_before_stays_valid_until_the_next(world, database_url):
    signed = bearer(world, "admin_a")
    made = [world.post(f"/admin/v1/tenants/{world.a}/host-secrets/portal", headers=signed).json() for _ in range(3)]
    identity = {"provider": "portal", "issuer": "college-portal", "secret": "portal"}
    widget = f"w_signed{world.tag}"
    signed_in = document(tenant_id=world.a, sign_in="signed_in", identity=identity)
    run(database_url, lambda records: Store(records.engine).publish_widget(widget, world.a, signed_in, "setup"))

    with TestClient(gateway(Settings(database_url=database_url, session_keys=KEYS, secrets_key=KEY))) as chat:

        def start(secret: dict) -> int:
            body = {"widget_id": widget, "host_token": signed_by(secret, widget)}
            return chat.post("/v1/sessions", json=body).status_code

        assert [start(made[2]), start(made[1]), start(made[0])] == [200, 200, 403]


def test_a_widget_points_only_at_its_own_tenants_secrets(world):
    a_admin, platform = bearer(world, "admin_a"), bearer(world, "platform")
    create = f"/admin/v1/tenants/{world.a}/widgets"
    b_only = {**FAKE, "api_key": "k", "password": "p"}
    world.put(f"/admin/v1/tenants/{world.b}/agent-profiles/b-only", json=b_only, headers=platform)

    def make(profile: str, who: dict):
        return world.post(create, json={"document": document(tenant_id=world.a, agent_profile=profile)}, headers=who)

    others = make("b-only", a_admin)
    assert others.status_code == 400 and "no connection profile named b-only" in others.json()["faults"][0]
    assert make("platform-only", a_admin).status_code == 400  # a platform profile is the platform's to choose
    made = make("platform-only", platform)
    assert made.status_code == 201
    renamed = titled(world, "Renamed") | {"agent_profile": "platform-only"}
    draft = f"/admin/v1/widgets/{made.json()['widget_id']}/draft"
    assert world.put(draft, json={"revision": 1, "document": renamed}, headers=a_admin).json() == {"revision": 2}


def test_test_connection_says_whether_pf_signs_in_and_reveals_nothing(world, fake_pf):
    signed = bearer(world, "admin_a")
    good = pf_profile(fake_pf).model_dump(mode="json") | {"api_key": "fake-api-key", "password": "fake-password"}
    profiles = {"good": good, "wrong": good | {"password": "wrong"}, "down": good | {"base_url": "http://127.0.0.1:9"}}
    replies = {}
    for name, body in profiles.items():
        world.put(f"/admin/v1/tenants/{world.a}/agent-profiles/{name}", json=body, headers=signed)
        replies[name] = world.post(f"/admin/v1/tenants/{world.a}/agent-profiles/{name}/test", headers=signed)

    assert replies["good"].json() == {"connected": True}
    assert replies["wrong"].json() == {"connected": False, "advice": "check the profile's credentials"}
    assert replies["down"].json()["connected"] is False
    assert not any("127.0.0.1" in reply.text or "fake-" in reply.text for reply in replies.values())
    assert world.post(f"/admin/v1/tenants/{world.a}/agent-profiles/nothing/test", headers=signed).status_code == 404


def test_a_tenants_own_profile_answers_its_widgets_through_the_gateway(world, database_url, fake_pf):
    good = pf_profile(fake_pf).model_dump(mode="json") | {"api_key": "fake-api-key", "password": "fake-password"}
    world.put(f"/admin/v1/tenants/{world.a}/agent-profiles/pf-staging", json=good, headers=bearer(world, "admin_a"))

    with TestClient(gateway(Settings(database_url=database_url, session_keys=KEYS, secrets_key=KEY))) as chat:
        session = chat.post("/v1/sessions", json={"widget_id": f"w_{world.a}", "host_token": None}).json()
        auth = {"authorization": f"Bearer {session['token']}"}
        conversation = chat.post("/v1/conversations", headers=auth).json()["id"]
        question = {"text": "Hello", "client_message_id": "c1"}
        reply = chat.post(f"/v1/conversations/{conversation}/messages", json=question, headers=auth)
        assert "message.completed" in reply.text


def test_sealed_secrets_open_only_where_they_were_sealed_and_with_a_key_held():
    old, new = new_key(), new_key()
    sealed = Vault(old).seal("s3cret", "t_a/host/portal")

    assert Vault(f"{new},{old}").open(*sealed, "t_a/host/portal") == "s3cret"  # a rotated key still opens
    with pytest.raises(ValueError, match="does not open here"):
        Vault(old).open(*sealed, "t_b/host/portal")  # moved to another tenant
    with pytest.raises(ValueError, match="no key"):
        Vault(new).open(*sealed, "t_a/host/portal")
    tampered = (sealed[0], sealed[1], bytes([sealed[2][0] ^ 1]) + sealed[2][1:])
    with pytest.raises(ValueError):
        Vault(old).open(*tampered, "t_a/host/portal")
    for bad in ("", "k1", "k1:short", "k1:" + "!" * 43):
        with pytest.raises(ValueError):
            Vault(bad)


def test_the_admin_api_description_file_matches_the_routes():
    from ucp.admin.openapi import OPENAPI_FILE, openapi_text

    stale = "Run: cd backend && uv run python -m ucp.admin.openapi"
    assert OPENAPI_FILE.read_text(encoding="utf-8") == openapi_text(), stale


# The console (M9): where it signs in, and its page


def test_the_console_learns_where_to_sign_in_without_signing_in(world):
    found = world.get("/admin/v1/sign-in").json()

    assert found == {
        "client_id": AUDIENCE,
        "authorization_endpoint": f"{world.provider.base_url}/authorize",
        "token_endpoint": f"{world.provider.base_url}/token",
    }


def test_the_console_page_is_served_for_any_route_and_may_be_framed_by_no_site(database_url, provider, tmp_path):  # noqa: F811
    dist = tmp_path / "console" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Console</title>")
    (dist / "assets" / "index-abc.js").write_text("/* console */")
    settings = Settings(
        database_url=database_url, web_dir=tmp_path, admin_issuer=provider.base_url, admin_audience=AUDIENCE
    )

    with TestClient(admin.create_app(settings)) as client:
        for route in ("/", "/widgets/w_1/look"):
            page = client.get(route)
            assert page.text == "<!doctype html><title>Console</title>"
            policy = page.headers["content-security-policy"]
            assert "frame-ancestors 'none'" in policy and f"connect-src 'self' {provider.base_url};" in policy
        assert client.get("/assets/index-abc.js").headers["cache-control"] == "public, max-age=31536000, immutable"
        assert client.get("/assets/nothing.js").status_code == 404
        assert client.get("/admin/v1/me").json()["code"] == "sign_in_required"  # the API stays the API
