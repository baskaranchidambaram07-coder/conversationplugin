"""What the admin API reads and writes (M8), beside the published widgets and the audit log in ucp.store.

Every change is written together with its audit entry, in one transaction: there is no change without a record of
who made it.
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Table,
    Text,
    delete,
    func,
    insert,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from ucp.gateway.pipeline import Problem
from ucp.store import audit, metadata, tenants, widgets

administrators = Table(
    "administrators",
    metadata,
    Column("issuer", Text, primary_key=True),
    Column("subject", Text, primary_key=True),
    Column("role", Text, CheckConstraint("role in ('platform', 'tenant', 'viewer')"), nullable=False),
    Column("tenant_id", Text, ForeignKey("tenants.tenant_id")),
    Column("label", Text),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("created_by", Text, nullable=False),
)

drafts = Table(
    "drafts",
    metadata,
    Column("widget_id", Text, primary_key=True),
    Column("tenant_id", Text, ForeignKey("tenants.tenant_id"), nullable=False),
    Column("document", JSONB, nullable=False),
    Column("revision", Integer, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_by", Text, nullable=False),
)

secrets = Table(
    "secrets",
    metadata,
    Column("tenant_id", Text, ForeignKey("tenants.tenant_id"), primary_key=True),
    Column("kind", Text, primary_key=True),
    Column("name", Text, primary_key=True),
    Column("key_id", Text, nullable=False),
    Column("nonce", LargeBinary, nullable=False),
    Column("sealed", LargeBinary, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_by", Text, nullable=False),
)


async def _record(db, actor: str, action: str, tenant_id: str, *, widget_id=None, version=None, detail=None) -> None:
    entry = {"actor": actor, "action": action, "tenant_id": tenant_id, "widget_id": widget_id, "version": version}
    await db.execute(insert(audit).values({**entry, "detail": detail}))


class Records:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    # Administrators

    @staticmethod
    def _one(issuer: str, subject: str):
        return (administrators.c.issuer == issuer) & (administrators.c.subject == subject)

    async def administrator(self, issuer: str, subject: str):
        query = select(administrators).where(self._one(issuer, subject))
        async with self.engine.connect() as db:
            return (await db.execute(query)).first()

    async def administrators(self, tenant_id: str | None = None) -> list:
        """Every administrator, or one tenant's (its tenant administrators and viewers)."""
        query = select(administrators).order_by(administrators.c.created_at)
        if tenant_id:
            query = query.where(administrators.c.tenant_id == tenant_id)
        async with self.engine.connect() as db:
            return list(await db.execute(query))

    async def add_administrator(self, issuer, subject, role, tenant_id, label, actor) -> None:
        row = {"issuer": issuer, "subject": subject, "role": role, "tenant_id": tenant_id, "label": label}
        try:
            async with self.engine.begin() as db:
                await db.execute(insert(administrators).values({**row, "created_by": actor}))
                detail = {"subject": subject, "role": role, "label": label}
                await _record(db, actor, "administrator.add", tenant_id or "*", detail=detail)
        except IntegrityError as error:  # already an administrator, or a tenant that does not exist
            raise Problem("conflict") from error

    async def remove_administrator(self, issuer, subject, actor) -> None:
        async with self.engine.begin() as db:
            query = delete(administrators).where(self._one(issuer, subject))
            removed = (await db.execute(query.returning(administrators.c.role, administrators.c.tenant_id))).first()
            if not removed:
                raise Problem("not_found")
            detail = {"subject": subject, "role": removed.role}
            await _record(db, actor, "administrator.remove", removed.tenant_id or "*", detail=detail)

    # Tenants

    async def tenants(self, tenant_id: str | None = None) -> list:
        query = select(tenants).order_by(tenants.c.tenant_id)
        if tenant_id:
            query = query.where(tenants.c.tenant_id == tenant_id)
        async with self.engine.connect() as db:
            return list(await db.execute(query))

    async def create_tenant(self, tenant_id: str, name: str, actor: str) -> None:
        try:
            async with self.engine.begin() as db:
                await db.execute(insert(tenants).values(tenant_id=tenant_id, name=name, created_by=actor))
                await _record(db, actor, "tenant.create", tenant_id, detail={"name": name})
        except IntegrityError as error:
            raise Problem("conflict") from error

    # Audit

    async def audit(self, tenant_id: str | None, widget_id: str | None, limit: int) -> list:
        """The newest entries: everything, or one tenant's, or one widget's within that."""
        query = select(audit).order_by(audit.c.at.desc(), audit.c.id.desc()).limit(limit)
        if tenant_id:
            query = query.where(audit.c.tenant_id == tenant_id)
        if widget_id:
            query = query.where(audit.c.widget_id == widget_id)
        async with self.engine.connect() as db:
            return list(await db.execute(query))

    async def widget_tenant(self, widget_id: str) -> str | None:
        """The tenant a widget belongs to: its draft's, or its published versions'."""
        async with self.engine.connect() as db:
            found = (await db.execute(select(drafts.c.tenant_id).where(drafts.c.widget_id == widget_id))).first()
            if not found:
                query = select(widgets.c.tenant_id).where(widgets.c.widget_id == widget_id).limit(1)
                found = (await db.execute(query)).first()
        return found.tenant_id if found else None
