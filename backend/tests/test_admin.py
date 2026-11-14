"""The admin API (M8): sign-in through the company identity provider, the three roles scoped to tenants, and an
audit entry for every change. Against PostgreSQL and a stand-in identity provider on a real port; the same sign-in
runs against a real Keycloak in the pipeline (tests/test_keycloak.py)."""

import asyncio
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from tests.test_provider import provider  # noqa: F401  (the stand-in identity provider, as a fixture)
from tests.test_public import PUBLIC, document
from ucp.admin import app as admin
from ucp.admin.__main__ import main as command
from ucp.admin.records import Records
from ucp.gateway.app import create_app as gateway
from ucp.settings import Settings
from ucp.store import Store

CONSOLE = "https://console.example.org"
AUDIENCE = "ucp-console"


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
            await Store(records.engine).publish_widget(f"w_{tenant}", tenant, document(tenant_id=tenant), "setup")
        for who, (role, tenant) in people.items():
            await records.add_administrator(provider.base_url, f"{who}-{tag}", role, tenant, who, "setup")

    run(database_url, make)
    settings = Settings(
        database_url=database_url, admin_issuer=provider.base_url, admin_audience=AUDIENCE, admin_origins=CONSOLE
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
    assert (entry["version"], entry["draft"]["revision"]) == (1, 1)


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
