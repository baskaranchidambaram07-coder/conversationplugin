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
    Table,
    Text,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB, distinct_on
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from ucp.gateway.pipeline import Problem
from ucp.store import Store, audit, metadata, tenants, widgets
from ucp.store import sealed_secrets as secrets
from ucp.vault import Vault, place

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

    # Widgets and their drafts

    async def widgets(self, tenant_id: str) -> list[dict]:
        """A tenant's widgets: each one's title, live version (if published), draft (if one is being edited) and
        whether the draft holds changes not yet published."""
        live = (
            select(widgets.c.widget_id, widgets.c.version, widgets.c.document)
            .where(widgets.c.tenant_id == tenant_id)
            .ext(distinct_on(widgets.c.widget_id))
            .order_by(widgets.c.widget_id, widgets.c.version.desc())
        )
        editing = select(drafts).where(drafts.c.tenant_id == tenant_id)
        async with self.engine.connect() as db:
            published = {row.widget_id: row for row in await db.execute(live)}
            edited = {row.widget_id: row for row in await db.execute(editing)}
        found = []
        for widget_id in sorted(published.keys() | edited.keys()):
            current, draft = published.get(widget_id), edited.get(widget_id)
            document = (draft or current).document
            found.append(
                {
                    "widget_id": widget_id,
                    "title": (document.get("public") or {}).get("title", widget_id),
                    "version": current.version if current else None,
                    "draft": draft
                    and {"revision": draft.revision, "updated_at": draft.updated_at, "updated_by": draft.updated_by},
                    "unpublished": bool(draft) and (not current or draft.document != current.document),
                }
            )
        return found

    async def draft(self, widget_id: str):
        async with self.engine.connect() as db:
            return (await db.execute(select(drafts).where(drafts.c.widget_id == widget_id))).first()

    async def create_widget(self, widget_id: str, tenant_id: str, document: dict, actor: str) -> None:
        async with self.engine.begin() as db:
            row = {"widget_id": widget_id, "tenant_id": tenant_id, "document": document, "revision": 1}
            await db.execute(insert(drafts).values({**row, "updated_by": actor}))
            await _record(db, actor, "widget.create", tenant_id, widget_id=widget_id, detail={"revision": 1})

    async def save_draft(self, widget_id: str, tenant_id: str, document: dict, revision: int, actor: str) -> int:
        """Saves the draft over the revision the editor started from, as the next one. Refused as a conflict when
        someone saved another revision since, so no one's edits are lost unseen. A widget never edited before
        starts from revision 0, its live version."""
        async with self.engine.begin() as db:
            if revision == 0:
                row = {"widget_id": widget_id, "tenant_id": tenant_id, "document": document, "revision": 1}
                try:
                    async with db.begin_nested():
                        await db.execute(insert(drafts).values({**row, "updated_by": actor}))
                except IntegrityError as error:
                    raise Problem("conflict") from error
                saved = 1
            else:
                query = (
                    update(drafts)
                    .where((drafts.c.widget_id == widget_id) & (drafts.c.revision == revision))
                    .values(document=document, revision=revision + 1, updated_at=func.now(), updated_by=actor)
                    .returning(drafts.c.revision)
                )
                saved = (await db.execute(query)).scalar()
                if saved is None:
                    raise Problem("conflict")
            await _record(db, actor, "draft.save", tenant_id, widget_id=widget_id, detail={"revision": saved})
        return saved

    async def publish_draft(self, store: Store, widget_id: str, revision: int, actor: str) -> int:
        """Publishes the draft at that revision as the widget's next version. A conflict if the draft has moved on."""
        async with self.engine.begin() as db:
            query = (
                select(drafts.c.tenant_id, drafts.c.document)
                .where((drafts.c.widget_id == widget_id) & (drafts.c.revision == revision))
                .with_for_update()
            )
            draft = (await db.execute(query)).first()
            if not draft:
                raise Problem("conflict")
            detail = {"revision": revision}
            return await store.publish_in(db, widget_id, draft.tenant_id, draft.document, actor, "publish", detail)

    # Secrets: sealed by the vault, never read back through the API

    async def secret_names(self, tenant_id: str) -> list:
        query = (
            select(secrets.c.kind, secrets.c.name, secrets.c.updated_at, secrets.c.updated_by)
            .where(secrets.c.tenant_id == tenant_id)
            .order_by(secrets.c.kind, secrets.c.name)
        )
        async with self.engine.connect() as db:
            return list(await db.execute(query))

    async def has_secret(self, tenant_id: str, kind: str, name: str) -> bool:
        query = select(secrets.c.name).where(
            (secrets.c.tenant_id == tenant_id) & (secrets.c.kind == kind) & (secrets.c.name == name)
        )
        async with self.engine.connect() as db:
            return (await db.execute(query)).first() is not None

    async def put_secret(self, vault: Vault, tenant_id: str, kind: str, name: str, value, actor: str, detail) -> None:
        """Seals and stores a secret, replacing any of that name. `value` is the new value, or a function of the
        current one (opened) for a rotation that keeps it."""
        where = place(tenant_id, kind, name)
        mine = (secrets.c.tenant_id == tenant_id) & (secrets.c.kind == kind) & (secrets.c.name == name)
        async with self.engine.begin() as db:
            if callable(value):
                query = select(secrets.c.key_id, secrets.c.nonce, secrets.c.sealed).where(mine).with_for_update()
                row = (await db.execute(query)).first()
                value = value(vault.open(row.key_id, row.nonce, row.sealed, where) if row else None)
            key_id, nonce, sealed = vault.seal(value, where)
            changed = {"key_id": key_id, "nonce": nonce, "sealed": sealed, "updated_by": actor}
            upsert = pg_insert(secrets).values({"tenant_id": tenant_id, "kind": kind, "name": name, **changed})
            upsert = upsert.on_conflict_do_update(
                index_elements=["tenant_id", "kind", "name"], set_={**changed, "updated_at": func.now()}
            )
            await db.execute(upsert)
            await _record(db, actor, f"{kind}.set", tenant_id, detail={"name": name, **(detail or {})})
