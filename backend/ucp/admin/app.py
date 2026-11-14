"""The control plane's admin API (M8), served under /admin/v1 by its own process (D3): the same image as the
gateway, started as `uvicorn ucp.admin.app:create_app --factory`. The gateway never mounts it, so the public chat
address cannot reach it.

Administrators sign in with the company identity provider (Entra ID, Okta, Keycloak): every request carries the
provider's token as `Authorization: Bearer`, checked against UCP_ADMIN_ISSUER and UCP_ADMIN_AUDIENCE with the same
code that checks visitors' tokens (ucp.identity). The user it names must be in the administrators table, with one
role:

    platform   everything, in every tenant
    tenant     everything in their own tenant, including its administrators and viewers
    viewer     reads their own tenant

Another tenant's things answer "not found", so their existence is not revealed. No cookie is ever used, so a page
on another site cannot act as a signed-in administrator; a request from a browser must also come from one of the
console's own addresses (UCP_ADMIN_ORIGINS).
"""

import json
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from secrets import token_hex, token_urlsafe
from typing import Annotated, Literal
from urllib.parse import urlsplit

import httpx2
from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import create_async_engine

from ucp.admin.records import Records
from ucp.connector import AgentError
from ucp.gateway import pipeline
from ucp.gateway.api import visitor_address
from ucp.gateway.pipeline import CODES, Problem, api_error
from ucp.identity import Identity, ProviderKeys, verify_provider_token
from ucp.identity import _secure as secure
from ucp.pf import PfConnector, PfProfile
from ucp.protocol import Id
from ucp.sessions import Limiter
from ucp.settings import Settings
from ucp.store import Store, new_id
from ucp.vault import Sealed, Vault
from ucp.widgets import problems

log = logging.getLogger("ucp.admin")
PER_MINUTE = 120  # requests from one signed-in administrator
ATTEMPTS_PER_MINUTE = 30  # refused sign-ins from one address

router = APIRouter(prefix="/admin/v1")


class _Body(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


@dataclass(frozen=True)
class Admin:
    issuer: str
    subject: str
    role: Literal["platform", "tenant", "viewer"]
    tenant_id: str | None

    def reach(self, tenant_id: str, *, write: bool = False) -> None:
        """Refuses another tenant's things as not found, and a viewer's changes as forbidden."""
        if self.role != "platform" and self.tenant_id != tenant_id:
            raise Problem("not_found")
        if write and self.role == "viewer":
            raise Problem("forbidden")

    def platform(self) -> None:
        if self.role != "platform":
            raise Problem("forbidden")


def records(request: Request) -> Records:
    return request.app.state.records


async def signed_in(request: Request) -> Admin:
    state = request.app.state
    origin = request.headers.get("origin")
    if origin is not None and origin not in state.origins:
        raise Problem("forbidden")
    address = f"refused:{visitor_address(request)}"

    def refuse(code: Literal["sign_in_required", "forbidden"]) -> Problem:
        # Only refusals count against an address, so guessing is slowed while an office of administrators behind
        # one address is not; signed-in administrators have their own limit below.
        state.limiter.check(address, ATTEMPTS_PER_MINUTE)
        return Problem(code)

    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise refuse("sign_in_required")
    if not state.identity:
        raise Problem("assistant_unavailable")  # this deployment names no identity provider for administrators
    try:
        subject = await verify_provider_token(token.strip(), state.identity, "", state.provider_keys)
    except Problem as problem:
        raise refuse("sign_in_required") if problem.code == "forbidden" else problem from None
    row = await state.records.administrator(state.identity.issuer, subject)
    if not row:
        raise refuse("forbidden")  # signed in, but not one of ours
    state.limiter.check(f"admin:{subject}", PER_MINUTE)
    return Admin(row.issuer, row.subject, row.role, row.tenant_id)


type Signed = Annotated[Admin, Depends(signed_in)]
type Kept = Annotated[Records, Depends(records)]


@router.get("/sign-in", summary="Where the console signs administrators in (no sign-in needed to read it)")
async def sign_in(request: Request) -> dict:
    endpoints = await provider_endpoints(request.app)
    if not endpoints:
        raise Problem("assistant_unavailable")
    return {"client_id": request.app.state.identity.audience, **endpoints}


async def provider_endpoints(app: FastAPI) -> dict | None:
    """Where the console sends administrators to sign in and exchanges the code it gets back: the provider's
    authorization and token endpoints, by OpenID Connect discovery, read once and kept."""
    identity = app.state.identity
    if not identity:
        return None
    if not app.state.endpoints:
        try:
            address = f"{identity.issuer.rstrip('/')}/.well-known/openid-configuration"
            found = (await app.state.client.get(address)).raise_for_status().json()
            endpoints = {
                "authorization_endpoint": found["authorization_endpoint"],
                "token_endpoint": found["token_endpoint"],
            }
        except (httpx2.HTTPError, ValueError, KeyError, TypeError) as error:
            log.warning("the administrators' identity provider cannot be discovered: %s", type(error).__name__)
            return None
        if not all(map(secure, endpoints.values())):
            log.warning("the administrators' identity provider is not served over https")
            return None
        app.state.endpoints = endpoints
    return app.state.endpoints


@router.get("/me", summary="Who is signed in, and their role")
async def me(admin: Signed) -> dict:
    return {"subject": admin.subject, "role": admin.role, "tenant_id": admin.tenant_id}


# Tenants


class NewTenant(_Body):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    tenant_id: Id | None = Field(default=None, description="Our ID for it; a new one when left out.")


def _tenant(row) -> dict:
    return {"tenant_id": row.tenant_id, "name": row.name, "created_at": row.created_at, "created_by": row.created_by}


@router.get("/tenants", summary="Every tenant (a platform administrator), or one's own")
async def list_tenants(admin: Signed, kept: Kept) -> list[dict]:
    return [_tenant(row) for row in await kept.tenants(None if admin.role == "platform" else admin.tenant_id)]


@router.post("/tenants", status_code=201, summary="A new tenant (platform administrators only)")
async def create_tenant(body: NewTenant, admin: Signed, kept: Kept) -> dict:
    admin.platform()
    tenant_id = body.tenant_id or new_id("t")
    await kept.create_tenant(tenant_id, body.name, admin.subject)
    return {"tenant_id": tenant_id, "name": body.name}


# Administrators


class NewAdministrator(_Body):
    subject: Annotated[str, Field(min_length=1, max_length=256, description="The user's ID at the provider.")]
    role: Literal["platform", "tenant", "viewer"]
    tenant_id: Id | None = Field(default=None, description="Their tenant; none for a platform administrator.")
    label: Annotated[str, Field(max_length=120)] | None = None


def _may_manage(admin: Admin, role: str, tenant_id: str | None) -> None:
    """A platform administrator manages anyone; a tenant administrator, their own tenant's administrators and
    viewers; a viewer, no one."""
    if role == "platform" or tenant_id is None:
        admin.platform()
    else:
        admin.reach(tenant_id, write=True)


def _administrator(row) -> dict:
    return {
        "subject": row.subject,
        "role": row.role,
        "tenant_id": row.tenant_id,
        "label": row.label,
        "created_at": row.created_at,
        "created_by": row.created_by,
    }


@router.get("/administrators", summary="Every administrator, or one tenant's")
async def list_administrators(admin: Signed, kept: Kept, tenant: Id | None = None) -> list[dict]:
    if admin.role != "platform":
        admin.reach(tenant or admin.tenant_id or "")
        tenant = admin.tenant_id
    return [_administrator(row) for row in await kept.administrators(tenant)]


@router.post("/administrators", status_code=201, summary="Give someone a role")
async def add_administrator(body: NewAdministrator, admin: Signed, kept: Kept, request: Request) -> dict:
    if (body.role == "platform") != (body.tenant_id is None):
        raise Problem("invalid_request")  # a platform administrator has no tenant; every other role has one
    _may_manage(admin, body.role, body.tenant_id)
    issuer = request.app.state.identity.issuer
    await kept.add_administrator(issuer, body.subject, body.role, body.tenant_id, body.label, admin.subject)
    return {"subject": body.subject, "role": body.role, "tenant_id": body.tenant_id}


@router.delete("/administrators/{subject}", status_code=204, summary="Take someone's role away")
async def remove_administrator(subject: str, admin: Signed, kept: Kept, request: Request) -> Response:
    issuer = request.app.state.identity.issuer
    target = await kept.administrator(issuer, subject)
    if not target:
        raise Problem("not_found")
    _may_manage(admin, target.role, target.tenant_id)
    await kept.remove_administrator(issuer, subject, admin.subject)
    return Response(status_code=204)


# Audit


def _entry(row) -> dict:
    return {
        "at": row.at,
        "actor": row.actor,
        "action": row.action,
        "tenant_id": row.tenant_id,
        "widget_id": row.widget_id,
        "version": row.version,
        "detail": row.detail,
    }


@router.get("/audit", summary="The newest entries of the audit log: all, one tenant's, or one widget's")
async def read_audit(
    admin: Signed,
    kept: Kept,
    tenant: Id | None = None,
    widget: Id | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
) -> list[dict]:
    if admin.role != "platform":
        admin.reach(tenant or admin.tenant_id or "")
        tenant = admin.tenant_id
    return [_entry(row) for row in await kept.audit(tenant, widget, limit)]


# Widgets: each is edited as a draft, then published as an unchangeable version (M8-T3)


class NewWidget(_Body):
    document: dict = Field(description="The widget's settings, as in a widget file; its tenant is the one named.")


class Draft(_Body):
    revision: Annotated[int, Field(ge=0, description="The revision this edit started from; 0 for the live version.")]
    document: dict


class Publish(_Body):
    revision: Annotated[int, Field(ge=1, description="The draft revision to publish, as last read.")]


class Rollback(_Body):
    version: Annotated[int, Field(ge=1)]


class _Faults(Exception):
    def __init__(self, faults: list[str]):
        self.faults = faults


async def _faults(_: Request, error: _Faults) -> JSONResponse:
    body = api_error("invalid_request").model_dump(mode="json")
    return JSONResponse({**body, "faults": error.faults}, status_code=CODES["invalid_request"][0])


def _checked(widget_id: str, tenant_id: str, document: dict) -> dict:
    """The document as it will be stored, or a 400 naming every fault at once. Its tenant is the widget's own."""
    if document.get("tenant_id", tenant_id) != tenant_id:
        raise _Faults([f"{widget_id}: tenant_id: a widget stays in its own tenant, {tenant_id}"])
    document = {**document, "tenant_id": tenant_id}
    if found := problems({widget_id: document}):
        raise _Faults(found)
    return document


REFERENCES = (("profile", "agent_profile", "connection profile"), ("host", "identity.secret", "shared secret"))


def _named(document: dict | None, kind: str) -> str | None:
    if not document:
        return None
    return document.get("agent_profile") if kind == "profile" else (document.get("identity") or {}).get("secret")


async def _references(request: Request, admin: Admin, kept: Records, widget_id: str, document: dict, before) -> None:
    """A widget's connection profile and shared secret must be its own tenant's, set through this API, so no tenant
    can point its widget at another's. A platform one (the gateway's own settings) is for platform administrators
    to choose; a tenant administrator may keep one they chose, not pick a new one."""
    faults = []
    for kind, field, what in REFERENCES:
        name = _named(document, kind)
        if not name or await kept.has_secret(document["tenant_id"], kind, name):
            continue
        offered = name in request.app.state.platform[kind]
        if offered and (admin.role == "platform" or name == _named(before, kind)):
            continue
        faults.append(f"{widget_id}: {field}: this tenant has no {what} named {name}")
    if faults:
        raise _Faults(faults)


async def _widget(kept: Records, admin: Admin, widget_id: str, *, write: bool = False) -> str:
    tenant_id = await kept.widget_tenant(widget_id)
    if not tenant_id:
        raise Problem("not_found")
    admin.reach(tenant_id, write=write)
    return tenant_id


def store(request: Request) -> Store:
    return request.app.state.store


type Published = Annotated[Store, Depends(store)]


@router.get("/tenants/{tenant_id}/widgets", summary="A tenant's widgets, with their live version and draft")
async def list_widgets(tenant_id: Id, admin: Signed, kept: Kept) -> list[dict]:
    admin.reach(tenant_id)
    return await kept.widgets(tenant_id)


@router.post("/tenants/{tenant_id}/widgets", status_code=201, summary="A new widget, as a draft")
async def create_widget(tenant_id: Id, body: NewWidget, admin: Signed, kept: Kept, request: Request) -> dict:
    admin.reach(tenant_id, write=True)
    if not await kept.tenants(tenant_id):
        raise Problem("not_found")
    widget_id = new_id("w")
    document = _checked(widget_id, tenant_id, body.document)
    await _references(request, admin, kept, widget_id, document, None)
    await kept.create_widget(widget_id, tenant_id, document, admin.subject)
    return {"widget_id": widget_id, "revision": 1}


@router.get("/widgets/{widget_id}/draft", summary="The draft being edited, or the live version as revision 0")
async def read_draft(widget_id: Id, admin: Signed, kept: Kept, published: Published) -> dict:
    await _widget(kept, admin, widget_id)
    if draft := await kept.draft(widget_id):
        return {"revision": draft.revision, "document": draft.document, "updated_by": draft.updated_by}
    live = await published.widget(widget_id)
    return {"revision": 0, "document": live.document, "updated_by": None}


@router.put("/widgets/{widget_id}/draft", summary="Save the draft; refused if someone saved since you read it")
async def save_draft(
    widget_id: Id, body: Draft, admin: Signed, kept: Kept, published: Published, request: Request
) -> dict:
    tenant_id = await _widget(kept, admin, widget_id, write=True)
    document = _checked(widget_id, tenant_id, body.document)
    before = await kept.draft(widget_id) or await published.widget(widget_id)
    await _references(request, admin, kept, widget_id, document, before.document if before else None)
    return {"revision": await kept.save_draft(widget_id, tenant_id, document, body.revision, admin.subject)}


# Secrets: a tenant's PF connection profiles and its sites' shared secrets (M8-T4, T5). Written, never read back.


def _vault(request: Request) -> Vault:
    if not request.app.state.vault:
        raise Problem("assistant_unavailable")  # this deployment holds no key to seal secrets with
    return request.app.state.vault


@router.get("/tenants/{tenant_id}/secrets", summary="A tenant's connection profiles and shared secrets, by name only")
async def list_secrets(tenant_id: Id, admin: Signed, kept: Kept) -> list[dict]:
    admin.reach(tenant_id)
    rows = await kept.secret_names(tenant_id)
    return [{"kind": r.kind, "name": r.name, "updated_at": r.updated_at, "updated_by": r.updated_by} for r in rows]


@router.put("/tenants/{tenant_id}/agent-profiles/{name}", summary="Set a PF connection profile; never shown again")
async def set_profile(tenant_id: Id, name: Id, body: PfProfile, admin: Signed, kept: Kept, request: Request) -> dict:
    admin.reach(tenant_id, write=True)
    plain = {
        **body.model_dump(),
        "api_key": body.api_key.get_secret_value(),
        "password": body.password.get_secret_value(),
    }
    await kept.put_secret(_vault(request), tenant_id, "profile", name, json.dumps(plain), admin.subject, None)
    return {"name": name}


@router.post("/tenants/{tenant_id}/agent-profiles/{name}/test", summary="Sign in to PF with a profile")
async def test_profile(tenant_id: Id, name: Id, admin: Signed, request: Request) -> dict:
    """Signs in with the profile and says how it went, never with the profile's address or credentials. A wrong
    workspace or agent shows only on the first question: PF has no cheap call to check them."""
    admin.reach(tenant_id, write=True)
    profile = await Sealed(request.app.state.store, _vault(request)).get(tenant_id, "profile", name)
    if not profile:
        raise Problem("not_found")
    try:
        await PfConnector(PfProfile(**json.loads(profile)), request.app.state.client).check()
    except AgentError as error:
        advice = "PF did not answer; try again later" if error.retryable else "check the profile's credentials"
        return {"connected": False, "advice": advice}
    return {"connected": True}


@router.post("/tenants/{tenant_id}/host-secrets/{name}", status_code=201, summary="A new shared secret, shown once")
async def new_host_secret(tenant_id: Id, name: Id, admin: Signed, kept: Kept, request: Request) -> dict:
    """A new secret for the customer's backend to sign visitors' tokens with. The one before it stays valid beside
    it until the next rotation, so the customer can switch without a gap; any older one stops working."""
    admin.reach(tenant_id, write=True)
    key_id, secret = f"k{datetime.now(UTC):%Y%m%d}{token_hex(2)}", token_urlsafe(32)

    def rotated(current: str | None) -> str:
        return ",".join(filter(None, [f"{key_id}:{secret}", current.split(",")[0] if current else None]))

    await kept.put_secret(_vault(request), tenant_id, "host", name, rotated, admin.subject, {"key_id": key_id})
    return {"name": name, "key_id": key_id, "secret": secret}


@router.post("/widgets/{widget_id}/publish", summary="Publish a draft revision as the next version")
async def publish(widget_id: Id, body: Publish, admin: Signed, kept: Kept, published: Published) -> dict:
    tenant_id = await _widget(kept, admin, widget_id, write=True)
    draft = await kept.draft(widget_id)
    if not draft or draft.revision != body.revision:
        raise Problem("conflict")
    _checked(widget_id, tenant_id, draft.document)  # today's rules, which may be newer than the draft
    return {"version": await kept.publish_draft(published, widget_id, body.revision, admin.subject)}


@router.get("/widgets/{widget_id}/versions", summary="Every published version, newest first")
async def versions(widget_id: Id, admin: Signed, kept: Kept, published: Published) -> list[dict]:
    await _widget(kept, admin, widget_id)
    rows = await published.widget_versions(widget_id)
    return [{"version": r.version, "published_at": r.published_at, "published_by": r.published_by} for r in rows]


@router.get("/widgets/{widget_id}/versions/{version}", summary="One published version's document")
async def version(widget_id: Id, version: int, admin: Signed, kept: Kept, published: Published) -> dict:
    await _widget(kept, admin, widget_id)
    row = await published.widget(widget_id, version)
    if not row:
        raise Problem("not_found")
    return {"version": row.version, "document": row.document}


@router.post("/widgets/{widget_id}/rollback", summary="Publish an earlier version again, as the next version")
async def rollback(widget_id: Id, body: Rollback, admin: Signed, kept: Kept, published: Published) -> dict:
    tenant_id = await _widget(kept, admin, widget_id, write=True)
    earlier = await published.widget(widget_id, body.version)
    if not earlier:
        raise Problem("not_found")
    _checked(widget_id, tenant_id, earlier.document)  # one that breaks today's rules is refused, not served broken
    return {"version": await published.rollback_widget(widget_id, body.version, admin.subject)}


def changes(before, after, path: str = "") -> list[dict]:
    """Every setting that differs between two documents, by its dotted path. Lists compare as whole values."""
    if isinstance(before, dict) and isinstance(after, dict):
        return [
            change
            for key in sorted(before.keys() | after.keys())
            for change in changes(before.get(key), after.get(key), f"{path}.{key}" if path else key)
        ]
    return [] if before == after else [{"path": path, "from": before, "to": after}]


@router.get("/widgets/{widget_id}/compare", summary="What changed between two versions")
async def compare(
    widget_id: Id,
    admin: Signed,
    kept: Kept,
    published: Published,
    first: Annotated[int, Query(alias="from", ge=1)],
    second: Annotated[int, Query(alias="to", ge=1)],
) -> list[dict]:
    await _widget(kept, admin, widget_id)
    one, two = await published.widget(widget_id, first), await published.widget(widget_id, second)
    if not one or not two:
        raise Problem("not_found")
    return changes(one.document, two.document)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    pipeline.install_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with AsyncExitStack() as stack:
            engine = create_async_engine(settings.database_url, pool_size=5, pool_pre_ping=True)
            stack.push_async_callback(engine.dispose)
            app.state.records = Records(engine)
            app.state.store = Store(engine)
            client = await stack.enter_async_context(httpx2.AsyncClient(timeout=httpx2.Timeout(10, read=30)))
            app.state.client = client
            app.state.provider_keys = ProviderKeys(client)
            yield

    # Like the gateway, it describes nothing about itself: the description is exported (ucp.admin.openapi).
    app = FastAPI(
        title="Control plane", version="1", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    pipeline.install(app)
    app.add_exception_handler(_Faults, _faults)
    app.state.identity = (
        Identity(
            provider="administrators",
            issuer=settings.admin_issuer,
            audience=settings.admin_audience,
            user_claim=settings.admin_user_claim,
        )
        if settings.admin_issuer and settings.admin_audience
        else None
    )
    app.state.vault = Vault(settings.secrets_key) if settings.secrets_key else None
    app.state.endpoints = None
    # The platform's own profiles and secrets, from the gateway's settings: only their names, to check references.
    app.state.platform = {
        "profile": set(json.loads(settings.agent_profiles or "{}")),
        "host": set(json.loads(settings.host_secrets or "{}")),
    }
    app.state.origins = {origin.strip() for origin in (settings.admin_origins or "").split(",") if origin.strip()}
    app.state.limiter = Limiter()
    app.state.visitor_address_header = settings.visitor_address_header
    app.include_router(router)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    if settings.web_dir and (settings.web_dir / "console" / "dist" / "index.html").is_file():
        app.include_router(console(settings.web_dir / "console" / "dist", settings.web_dir / "widget" / "dist"))
    return app


def console_policy(token_endpoint: str | None) -> str:
    """The console's own page: only our files, the API on this address and the identity provider's token endpoint;
    no site may frame it (M9: the console cannot be framed). Logos may come from any https site, as the chat's do."""
    provider = urlsplit(token_endpoint)._replace(path="", query="", fragment="").geturl() if token_endpoint else ""
    return (
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' https: data:; "
        f"connect-src 'self' {provider}".rstrip()
        + "; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    )


# The chat's own page as the console's live preview (M9-T3): framed by the console only, fetching nothing.
PREVIEW_POLICY = (
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' https: data:; "
    "connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
)


def console(dist: Path, chat: Path) -> APIRouter:
    """The admin console (M9), from web/console/dist: hashed assets kept forever, and its page for every other
    path, so a route reloaded in the browser still opens the console. With the built chat (web/widget/dist), its
    page at /preview, the console's live preview, and the chat's assets beside the console's own."""
    pages = APIRouter(include_in_schema=False)
    page = (dist / "index.html").read_bytes()
    folders = [dist / "assets", chat / "assets"]
    types = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2"}

    @pages.get("/assets/{name}")
    async def asset(name: str) -> FileResponse:
        for folder in folders:
            path = folder / name
            if path.parent == folder and path.suffix in types and path.is_file():
                headers = {"cache-control": "public, max-age=31536000, immutable"}
                return FileResponse(path, media_type=types[path.suffix], headers=headers)
        raise Problem("not_found")

    if (chat / "index.html").is_file():
        preview = (chat / "index.html").read_bytes()

        @pages.get("/preview")
        async def chat_preview() -> Response:
            headers = {"content-security-policy": PREVIEW_POLICY, "cache-control": "no-cache"}
            return Response(preview, media_type="text/html; charset=utf-8", headers=headers)

    @pages.get("/{route:path}")
    async def index(route: str, request: Request) -> Response:
        if route.startswith(("admin/", "assets/")):
            raise Problem("not_found")
        endpoints = await provider_endpoints(request.app) or {}
        policy = console_policy(endpoints.get("token_endpoint"))
        headers = {"content-security-policy": policy, "cache-control": "no-cache"}
        return Response(page, media_type="text/html; charset=utf-8", headers=headers)

    return pages
