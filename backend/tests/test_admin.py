"""The admin API (M8): sign-in through the company identity provider, the three roles scoped to tenants, and an
audit entry for every change. Against PostgreSQL and a stand-in identity provider on a real port; the same sign-in
runs against a real Keycloak in the pipeline (tests/test_keycloak.py)."""

import asyncio
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from tests.test_provider import provider  # noqa: F401  (the stand-in identity provider, as a fixture)
from ucp.admin import app as admin
from ucp.admin.__main__ import main as command
from ucp.admin.records import Records
from ucp.gateway.app import create_app as gateway
from ucp.settings import Settings

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
        for who, (role, tenant) in people.items():
            await records.add_administrator(provider.base_url, f"{who}-{tag}", role, tenant, who, "setup")

    run(database_url, make)
    settings = Settings(
        database_url=database_url, admin_issuer=provider.base_url, admin_audience=AUDIENCE, admin_origins=CONSOLE
    )
    with TestClient(admin.create_app(settings)) as client:
        client.tag, client.provider = tag, provider
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
