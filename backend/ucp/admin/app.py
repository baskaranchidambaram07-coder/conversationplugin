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

from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Literal

import httpx2
from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import create_async_engine

from ucp.admin.records import Records
from ucp.gateway import pipeline
from ucp.gateway.api import visitor_address
from ucp.gateway.pipeline import Problem
from ucp.identity import Identity, ProviderKeys, verify_provider_token
from ucp.protocol import Id
from ucp.sessions import Limiter
from ucp.settings import Settings
from ucp.store import Store, new_id

PER_MINUTE = 120  # requests from one signed-in administrator
ATTEMPTS_PER_MINUTE = 30  # requests from one address before sign-in is checked

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
    state.limiter.check(f"address:{visitor_address(request)}", ATTEMPTS_PER_MINUTE)
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise Problem("sign_in_required")
    if not state.identity:
        raise Problem("assistant_unavailable")  # this deployment names no identity provider for administrators
    try:
        subject = await verify_provider_token(token.strip(), state.identity, "", state.provider_keys)
    except Problem as problem:
        raise Problem("sign_in_required") if problem.code == "forbidden" else problem from None
    row = await state.records.administrator(state.identity.issuer, subject)
    if not row:
        raise Problem("forbidden")  # signed in, but not one of ours
    state.limiter.check(f"admin:{subject}", PER_MINUTE)
    return Admin(row.issuer, row.subject, row.role, row.tenant_id)


type Signed = Annotated[Admin, Depends(signed_in)]
type Kept = Annotated[Records, Depends(records)]


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
    app.state.origins = {origin.strip() for origin in (settings.admin_origins or "").split(",") if origin.strip()}
    app.state.limiter = Limiter()
    app.state.visitor_address_header = settings.visitor_address_header
    app.include_router(router)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app
