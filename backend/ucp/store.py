"""Storage (the core of M7, built with M4): published widget versions, conversations and messages in PostgreSQL.

Every conversation and message is read through its owner (tenant, widget and user), so a conversation ID taken
from someone else simply is not found. PF's own IDs are kept here and never leave the server (R13).
"""

import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from pydantic import TypeAdapter
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    delete,
    func,
    insert,
    select,
    true,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB, distinct_on
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from ucp.connector import AgentFile
from ucp.protocol import ApiError, Block, Conversation, FileBlock, Message, Pin, Project

metadata = MetaData()
_BLOCK = TypeAdapter(Block)


def _times():
    return (
        Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
        Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    )


widgets = Table(
    "widgets",
    metadata,
    Column("widget_id", Text, primary_key=True),
    Column("version", Integer, primary_key=True),
    Column("tenant_id", Text, nullable=False),
    Column("document", JSONB, nullable=False),
    Column("published_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("published_by", Text),  # who published it; a version, once written, never changes (a trigger, 0004)
)

# Who published or rolled back what, and when (M8-T9). Only grows: a trigger refuses changes and removals.
audit = Table(
    "audit",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("actor", Text, nullable=False),
    Column("action", Text, nullable=False),
    Column("tenant_id", Text, nullable=False),
    Column("widget_id", Text),  # empty for an action on no widget: a tenant, an administrator, a secret (0005)
    Column("version", Integer),
    Column("detail", JSONB),
    Index("audit_by_widget", "widget_id", "at"),
    Index("audit_by_tenant", "tenant_id", "at"),
)

# The tenants (M8). A tenant named by a published widget is recorded the first time one is published. A deleted
# tenant keeps its row, marked deleted, so publishing a widget of it again cannot bring it back (0006).
tenants = Table(
    "tenants",
    metadata,
    Column("tenant_id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("created_by", Text, nullable=False),
    Column("deleted_at", DateTime(timezone=True)),
    Column("deleted_by", Text),
)

# Widgets deleted through the admin API (0006). Their versions stay, as versions never change; the gateway no
# longer serves them, whatever is published for them afterwards.
deleted_widgets = Table(
    "deleted_widgets",
    metadata,
    Column("widget_id", Text, primary_key=True),
    Column("tenant_id", Text, nullable=False),
    Column("deleted_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("deleted_by", Text, nullable=False),
)


def served():
    """Published versions the gateway may serve: neither their widget nor their tenant is deleted."""
    gone = select(tenants.c.tenant_id).where(tenants.c.deleted_at.is_not(None))
    return widgets.c.widget_id.not_in(select(deleted_widgets.c.widget_id)) & widgets.c.tenant_id.not_in(gone)


# Secrets set through the admin API (M8), sealed by ucp.vault: a tenant's shared secrets ("host") and PF connection
# profiles ("profile"). The gateway opens them by tenant and name; nothing else reads them.
sealed_secrets = Table(
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

images = Table(
    "images",
    metadata,
    Column("digest", Text, primary_key=True),  # SHA-256 of the bytes, so a stored image never changes
    Column("tenant_id", Text, ForeignKey("tenants.tenant_id"), nullable=False),
    Column("content_type", Text, nullable=False),
    Column("data", LargeBinary, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("created_by", Text, nullable=False),
)

# A signed-in visitor's folders of chats (0009). Deleting one leaves its chats, unfiled.
projects = Table(
    "projects",
    metadata,
    Column("id", Text, primary_key=True),
    Column("tenant_id", Text, nullable=False),
    Column("widget_id", Text, nullable=False),
    Column("user_id", Text, nullable=False),
    Column("name", Text, nullable=False),
    *_times(),
    Index("projects_by_owner", "tenant_id", "widget_id", "user_id"),
)

conversations = Table(
    "conversations",
    metadata,
    Column("id", Text, primary_key=True),
    Column("tenant_id", Text, nullable=False),
    Column("widget_id", Text, nullable=False),
    Column("user_id", Text, nullable=False),
    Column("agent_conversation_id", Text),
    Column("title", Text),
    *_times(),
    Column("project_id", Text, ForeignKey("projects.id", ondelete="SET NULL")),
    Index("conversations_by_owner", "tenant_id", "widget_id", "user_id", "updated_at"),
    Index("conversations_by_project", "project_id", "updated_at"),
)

messages = Table(
    "messages",
    metadata,
    Column("id", Text, primary_key=True),
    Column("conversation_id", Text, ForeignKey("conversations.id"), nullable=False),
    Column("seq", Integer, nullable=False),
    Column("role", Text, CheckConstraint("role in ('user', 'assistant')"), nullable=False),
    Column(
        "status", Text, CheckConstraint("status in ('in_progress', 'complete', 'failed', 'stopped')"), nullable=False
    ),
    Column("blocks", JSONB, nullable=False),
    Column("error", JSONB),
    Column("client_message_id", Text),  # the chat's key on a question: sending it again is the same question
    Column("reply_to", Text, ForeignKey("messages.id")),  # on an answer: the question it answers
    Column("agent_message_id", Text),  # PF's message ID, to fetch an answer whose stream broke
    Column("config_version", Integer),  # the widget version that produced an answer
    Column("agent_version", Text),  # the agent version that wrote an answer; never sent to the browser
    *_times(),
    UniqueConstraint("conversation_id", "seq"),
    UniqueConstraint("conversation_id", "client_message_id"),
)


# A visitor's rating of an answer (M4-T10), tied to the answer and the question it answers. A public visitor's row
# is marked anonymous; its user ID is the throwaway one that already owns the conversation.
feedback = Table(
    "feedback",
    metadata,
    Column("message_id", Text, ForeignKey("messages.id"), primary_key=True),
    Column("question_id", Text, ForeignKey("messages.id")),
    Column("conversation_id", Text, ForeignKey("conversations.id"), nullable=False),
    Column("tenant_id", Text, nullable=False),
    Column("widget_id", Text, nullable=False),
    Column("user_id", Text, nullable=False),
    Column("user_kind", Text, CheckConstraint("user_kind in ('anonymous', 'signed_in')"), nullable=False),
    Column("rating", Text, CheckConstraint("rating in ('like', 'dislike')"), nullable=False),
    Column("comment", Text),
    *_times(),
    Index("feedback_by_widget", "tenant_id", "widget_id", "created_at"),
)


# Files visitors attached (M10, 0011), kept with their conversation. A question's blocks name the files sent with it.
# shortcut: bytes in PostgreSQL, unscanned; S3 behind a malware scan before production (ucp.files).
files = Table(
    "files",
    metadata,
    Column("id", Text, primary_key=True),
    Column("conversation_id", Text, ForeignKey("conversations.id"), nullable=False),
    Column("name", Text, nullable=False),
    Column("content_type", Text, nullable=False),
    Column("size", Integer, nullable=False),
    Column("data", LargeBinary, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index("files_by_conversation", "conversation_id"),
)

# Answers a signed-in visitor pinned to find again (0010).
pins = Table(
    "pins",
    metadata,
    Column("message_id", Text, ForeignKey("messages.id"), primary_key=True),
    Column("conversation_id", Text, ForeignKey("conversations.id"), nullable=False),
    Column("tenant_id", Text, nullable=False),
    Column("widget_id", Text, nullable=False),
    Column("user_id", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index("pins_by_owner", "tenant_id", "widget_id", "user_id", "created_at"),
)


# A turn takes at most 5 minutes (ucp.turns), so an answer still in progress after 6 was abandoned.
STALE = timedelta(minutes=6)
STALE_ERROR = {
    "code": "assistant_unavailable",
    "message": "The assistant is not available just now. Try again shortly.",
    "retryable": True,
    "retry_after": None,
    "reference": "r_abandoned",
}

identities = Table(
    "identities",
    metadata,
    Column("tenant_id", Text, primary_key=True),
    Column("provider", Text, primary_key=True),
    Column("subject", Text, primary_key=True),  # the host's ID for the user: never an email address or a name
    Column("user_id", Text, nullable=False, unique=True),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

used_host_tokens = Table(
    "used_host_tokens",
    metadata,
    Column("widget_id", Text, primary_key=True),
    Column("token_hash", Text, primary_key=True),  # a hash of the token's jti, kept until the token expires
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Index("used_host_tokens_by_expiry", "expires_at"),
)


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(16)}"


@dataclass(frozen=True)
class Owner:
    """Who a conversation belongs to. Every read and write of a conversation goes through one."""

    tenant_id: str
    widget_id: str
    user_id: str


@dataclass(frozen=True)
class Turn:
    """A question and the answer to it. `repeat` is true when the chat sent a question it had sent before."""

    conversation_id: str
    question_id: str
    answer_id: str
    agent_conversation_id: str | None
    repeat: bool


class TurnInProgress(Exception):
    pass


class UnknownAttachment(Exception):
    """A question named a file that is not in its conversation."""


def _conversation(row) -> Conversation:
    return Conversation(
        id=row.id, title=row.title, created_at=row.created_at, updated_at=row.updated_at, project_id=row.project_id
    )


def _project(row) -> Project:
    return Project(id=row.id, name=row.name, created_at=row.created_at, updated_at=row.updated_at)


def _message(row) -> Message:
    # Built field by field: PF IDs and the config version stay behind (D15).
    error = ApiError.model_validate(row.error) if row.error else None
    blocks = [_BLOCK.validate_python(block) for block in row.blocks]
    return Message(
        id=row.id,
        role=row.role,
        status=row.status,
        blocks=blocks,
        error=error,
        created_at=row.created_at,
        feedback=row.rating,
        pinned=bool(row.pinned),
    )


class Store:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    # Widgets

    async def publish_widget(self, widget_id: str, tenant_id: str, document: dict, actor: str = "system") -> int:
        """Stores the document as the widget's next version, unless it is the same as the current one, and records
        who did it in the audit log. Returns the version now in use."""
        async with self.engine.begin() as db:
            return await self.publish_in(db, widget_id, tenant_id, document, actor, "publish", None)

    async def rollback_widget(self, widget_id: str, version: int, actor: str) -> int | None:
        """Publishes an earlier version again, as a new version, so the record of what was live stays whole.
        None if there is no such version."""
        query = select(widgets.c.tenant_id, widgets.c.document).where(
            (widgets.c.widget_id == widget_id) & (widgets.c.version == version)
        )
        async with self.engine.begin() as db:
            earlier = (await db.execute(query)).first()
            if not earlier:
                return None
            detail = {"to_version": version}
            return await self.publish_in(db, widget_id, earlier.tenant_id, earlier.document, actor, "rollback", detail)

    async def publish_in(self, db, widget_id, tenant_id, document, actor, action, detail) -> int:
        """Publishing within the caller's transaction (the admin API publishes a draft it has locked)."""
        # Two publishes of one widget at the same instant collide on the version number, and one is refused. Through
        # the admin API a publish holds its draft's row lock, so two administrators wait in turn instead.
        current = await self._latest(db, widget_id)
        if current and current.document == document and current.tenant_id == tenant_id:
            return current.version
        version = current.version + 1 if current else 1
        known = {"tenant_id": tenant_id, "name": tenant_id, "created_by": actor}
        await db.execute(pg_insert(tenants).values(known).on_conflict_do_nothing())
        row = {"widget_id": widget_id, "version": version, "tenant_id": tenant_id, "document": document}
        await db.execute(insert(widgets).values({**row, "published_by": actor}))
        entry = {"actor": actor, "action": action, "tenant_id": tenant_id, "widget_id": widget_id, "detail": detail}
        await db.execute(insert(audit).values({**entry, "version": version}))
        return version

    async def current_widgets(self) -> dict[str, dict]:
        """Every widget's current document, by widget ID: the whole live configuration."""
        query = (
            select(widgets.c.widget_id, widgets.c.document)
            .where(served())
            .ext(distinct_on(widgets.c.widget_id))
            .order_by(widgets.c.widget_id, widgets.c.version.desc())
        )
        async with self.engine.connect() as db:
            return {row.widget_id: row.document for row in await db.execute(query)}

    async def widget_versions(self, widget_id: str) -> list:
        """Every published version of a widget, newest first: version, published_at, published_by, tenant_id."""
        query = (
            select(widgets.c.version, widgets.c.published_at, widgets.c.published_by, widgets.c.tenant_id)
            .where(widgets.c.widget_id == widget_id)
            .order_by(widgets.c.version.desc())
        )
        async with self.engine.connect() as db:
            return list(await db.execute(query))

    async def audit_entries(self, widget_id: str | None = None, limit: int = 50) -> list:
        """The newest entries of the audit log, for one widget or all."""
        query = select(audit).order_by(audit.c.at.desc(), audit.c.id.desc()).limit(limit)
        if widget_id:
            query = query.where(audit.c.widget_id == widget_id)
        async with self.engine.connect() as db:
            return list(await db.execute(query))

    async def widget(self, widget_id: str, version: int | None = None):
        """A widget's current version, if it is served, or the one asked for: (version, tenant_id, document), or
        None."""
        async with self.engine.connect() as db:
            if version is None:
                return await self._latest(db, widget_id, served())
            query = select(widgets.c.version, widgets.c.tenant_id, widgets.c.document).where(
                (widgets.c.widget_id == widget_id) & (widgets.c.version == version)
            )
            return (await db.execute(query)).first()

    @staticmethod
    async def _latest(db, widget_id: str, *only):
        query = (
            select(widgets.c.version, widgets.c.tenant_id, widgets.c.document)
            .where(widgets.c.widget_id == widget_id, *only)
            .order_by(widgets.c.version.desc())
            .limit(1)
        )
        return (await db.execute(query)).first()

    async def sealed(self, tenant_id: str, kind: str, name: str):
        """A sealed secret set through the admin API: (key_id, nonce, sealed), or None."""
        found = sealed_secrets.c
        query = select(found.key_id, found.nonce, found.sealed).where(
            (found.tenant_id == tenant_id) & (found.kind == kind) & (found.name == name)
        )
        async with self.engine.connect() as db:
            return (await db.execute(query)).first()

    async def image(self, digest: str):
        """An uploaded image: (content_type, data), or None."""
        query = select(images.c.content_type, images.c.data).where(images.c.digest == digest)
        async with self.engine.connect() as db:
            return (await db.execute(query)).first()

    # Signed-in visitors (M5)

    async def user_for(self, tenant_id: str, provider: str, subject: str) -> str:
        """Our user ID for a host's user, the same every time they come back. Made on first sight."""
        row = {"tenant_id": tenant_id, "provider": provider, "subject": subject, "user_id": new_id("u")}
        query = (
            pg_insert(identities)
            .values(row)
            .on_conflict_do_update(index_elements=["tenant_id", "provider", "subject"], set_={"subject": subject})
            .returning(identities.c.user_id)
        )
        async with self.engine.begin() as db:
            return (await db.execute(query)).scalar_one()

    async def use_host_token(self, widget_id: str, token_hash: str, expires_at: datetime) -> bool:
        """Records a host token as used. False if it was used before, which makes it a replay."""
        query = (
            pg_insert(used_host_tokens)
            .values(widget_id=widget_id, token_hash=token_hash, expires_at=expires_at)
            .on_conflict_do_nothing()
            .returning(used_host_tokens.c.token_hash)
        )
        async with self.engine.begin() as db:
            await db.execute(delete(used_host_tokens).where(used_host_tokens.c.expires_at < func.now()))
            return (await db.execute(query)).first() is not None

    # Conversations

    def _owned(self, owner: Owner):
        return (
            (conversations.c.tenant_id == owner.tenant_id)
            & (conversations.c.widget_id == owner.widget_id)
            & (conversations.c.user_id == owner.user_id)
        )

    async def create_conversation(self, owner: Owner, project_id: str | None = None) -> Conversation | None:
        """A new chat, filed under one of the owner's projects if named. None if the project is not theirs."""
        values = {"id": new_id("c"), **owner.__dict__, "project_id": project_id}
        async with self.engine.begin() as db:
            if project_id and not await self._project_of(db, owner, project_id):
                return None
            row = (await db.execute(insert(conversations).values(values).returning(conversations))).one()
        return _conversation(row)

    async def conversation(self, owner: Owner, conversation_id: str) -> Conversation | None:
        async with self.engine.connect() as db:
            query = select(conversations).where(self._owned(owner) & (conversations.c.id == conversation_id))
            row = (await db.execute(query)).first()
        return _conversation(row) if row else None

    async def conversations(
        self, owner: Owner, before: tuple[datetime, str] | None, limit: int, project_id: str | None = None
    ) -> list[Conversation]:
        """Most recently active first, of one project if named. `before` is the (updated_at, id) of the last one
        already shown: the ID breaks ties, so two conversations active at the same instant are neither skipped nor
        shown twice."""
        query = select(conversations).where(self._owned(owner))
        if project_id:
            query = query.where(conversations.c.project_id == project_id)
        if before:
            query = query.where(tuple_(conversations.c.updated_at, conversations.c.id) < tuple_(*before))
        query = query.order_by(conversations.c.updated_at.desc(), conversations.c.id.desc()).limit(limit)
        async with self.engine.connect() as db:
            return [_conversation(row) for row in await db.execute(query)]

    async def file_conversation(
        self, owner: Owner, conversation_id: str, project_id: str | None
    ) -> Conversation | None:
        """Files one of the owner's chats under one of their projects, or under none. None if either is not theirs.
        The chat keeps its place in the list: filing it is not activity."""
        async with self.engine.begin() as db:
            if project_id and not await self._project_of(db, owner, project_id):
                return None
            query = (
                update(conversations)
                .where(self._owned(owner) & (conversations.c.id == conversation_id))
                .values(project_id=project_id)
                .returning(conversations)
            )
            row = (await db.execute(query)).first()
        return _conversation(row) if row else None

    # Projects (signed-in visitors)

    def _projects_owned(self, owner: Owner):
        return (
            (projects.c.tenant_id == owner.tenant_id)
            & (projects.c.widget_id == owner.widget_id)
            & (projects.c.user_id == owner.user_id)
        )

    async def _project_of(self, db, owner: Owner, project_id: str):
        query = select(projects.c.id).where(self._projects_owned(owner) & (projects.c.id == project_id))
        return (await db.execute(query)).first()

    async def projects(self, owner: Owner, limit: int = 100) -> list[Project]:
        """The owner's projects, most recently active first: a project is as recent as its newest chat.
        shortcut: the newest 100 with no paging; add a cursor when someone keeps more."""
        active = func.greatest(projects.c.updated_at, func.max(conversations.c.updated_at)).label("active")
        query = (
            select(projects.c.id, projects.c.name, projects.c.created_at, active.label("updated_at"))
            .select_from(projects.outerjoin(conversations, conversations.c.project_id == projects.c.id))
            .where(self._projects_owned(owner))
            .group_by(projects.c.id)
            .order_by(active.desc(), projects.c.id.desc())
            .limit(limit)
        )
        async with self.engine.connect() as db:
            return [_project(row) for row in await db.execute(query)]

    async def create_project(self, owner: Owner, name: str) -> Project:
        values = {"id": new_id("p"), **owner.__dict__, "name": name}
        async with self.engine.begin() as db:
            return _project((await db.execute(insert(projects).values(values).returning(projects))).one())

    async def rename_project(self, owner: Owner, project_id: str, name: str) -> Project | None:
        query = (
            update(projects)
            .where(self._projects_owned(owner) & (projects.c.id == project_id))
            .values(name=name, updated_at=func.now())
            .returning(projects)
        )
        async with self.engine.begin() as db:
            row = (await db.execute(query)).first()
        return _project(row) if row else None

    async def delete_project(self, owner: Owner, project_id: str) -> bool:
        """Removes one of the owner's projects; its chats stay, unfiled (the key's ON DELETE SET NULL)."""
        query = delete(projects).where(self._projects_owned(owner) & (projects.c.id == project_id))
        async with self.engine.begin() as db:
            return (await db.execute(query)).rowcount > 0

    async def set_agent_conversation(self, conversation_id: str, agent_conversation_id: str) -> None:
        async with self.engine.begin() as db:
            await db.execute(
                update(conversations)
                .where(conversations.c.id == conversation_id)
                .values(agent_conversation_id=agent_conversation_id)
            )

    # Messages

    async def start_turn(
        self,
        owner: Owner,
        conversation_id: str,
        client_message_id: str,
        text: str,
        config_version: int,
        agent_version: str | None = None,
        attachments: Sequence[str] = (),
    ) -> Turn | None:
        """Stores a question and an empty answer, in one transaction. None if the conversation is not the owner's.
        Files named in `attachments` must have been uploaded to this conversation (else UnknownAttachment); the
        question's blocks name them after its text.

        The same client_message_id again returns the turn it started (repeat). A new question while an answer
        is still in progress raises TurnInProgress. The conversation row is locked first, in a statement of its own:
        a read that waited for the lock inside one statement would still see the conversation as it was before the
        other question went in, and both would start. Then one read gathers everything: five statements a turn.
        """
        here = messages.c.conversation_id == conversations.c.id
        # Tied to the conversation read below, even where it sits two levels down.
        asked = (
            select(messages.c.id)
            .where(here & (messages.c.client_message_id == client_message_id))
            .correlate(conversations)
        )
        busy = select(messages.c.id).where(here & (messages.c.status == "in_progress")).limit(1)
        fresh = select(messages.c.updated_at > func.now() - STALE).where(here & (messages.c.status == "in_progress"))
        answers = messages.alias("answers")  # its own name, so the question looked up inside is not tied to it
        state = select(
            conversations.c.agent_conversation_id,
            asked.scalar_subquery().label("asked"),
            select(answers.c.id).where(answers.c.reply_to == asked.scalar_subquery()).scalar_subquery().label("answer"),
            busy.scalar_subquery().label("busy"),
            fresh.limit(1).scalar_subquery().label("fresh"),
            select(func.coalesce(func.max(messages.c.seq), -1)).where(here).scalar_subquery().label("seq"),
        ).where(conversations.c.id == conversation_id)
        lock = select(conversations.c.id).where(self._owned(owner) & (conversations.c.id == conversation_id))
        async with self.engine.begin() as db:
            if not (await db.execute(lock.with_for_update())).first():
                return None
            found = (await db.execute(state)).one()
            if found.asked:
                return Turn(conversation_id, found.asked, found.answer, found.agent_conversation_id, repeat=True)
            if found.busy and found.fresh:
                raise TurnInProgress
            if found.busy:  # left in progress by a gateway that stopped mid-turn: give up on it, or the chat is stuck
                stale = {"status": "failed", "error": STALE_ERROR, "updated_at": func.now()}
                await db.execute(update(messages).where(messages.c.id == found.busy).values(stale))
            attached = await self._attached(db, conversation_id, attachments) if attachments else []
            question_id, answer_id = new_id("m"), new_id("m")
            shared = {"conversation_id": conversation_id, "client_message_id": None, "reply_to": None}
            shared |= {"config_version": None, "agent_version": None}
            await db.execute(
                insert(messages).values(
                    [
                        {
                            **shared,
                            "id": question_id,
                            "seq": found.seq + 1,
                            "role": "user",
                            "status": "complete",
                            "blocks": [{"type": "text", "text": text}, *attached],
                            "client_message_id": client_message_id,
                        },
                        {
                            **shared,
                            "id": answer_id,
                            "seq": found.seq + 2,
                            "role": "assistant",
                            "status": "in_progress",
                            "blocks": [],
                            "reply_to": question_id,
                            "config_version": config_version,
                            "agent_version": agent_version,
                        },
                    ]
                )
            )
            await db.execute(
                update(conversations)
                .where(conversations.c.id == conversation_id)
                .values(updated_at=func.now(), title=func.coalesce(conversations.c.title, text[:80]))
            )
        return Turn(conversation_id, question_id, answer_id, found.agent_conversation_id, repeat=False)

    # Attachments (M10)

    @staticmethod
    async def _attached(db, conversation_id: str, attachments: Sequence[str]) -> list[dict]:
        """The file blocks for a question's attachments, in the order named; each must be in the conversation."""
        named = list(dict.fromkeys(attachments))
        query = select(files.c.id, files.c.name, files.c.size, files.c.content_type).where(
            (files.c.conversation_id == conversation_id) & files.c.id.in_(named)
        )
        found = {row.id: row for row in await db.execute(query)}
        if len(found) != len(named):
            raise UnknownAttachment
        return [{"type": "file", **found[key]._mapping} for key in named]

    async def add_file(
        self, owner: Owner, conversation_id: str, name: str, content_type: str, data: bytes
    ) -> FileBlock | None:
        """Keeps a checked file in one of the owner's conversations. None if the conversation is not theirs."""
        block = FileBlock(type="file", id=new_id("f"), name=name, size=len(data), content_type=content_type)
        mine = select(conversations.c.id).where(self._owned(owner) & (conversations.c.id == conversation_id))
        values = {"id": block.id, "conversation_id": conversation_id, "name": name, "content_type": content_type}
        async with self.engine.begin() as db:
            if not (await db.execute(mine)).first():
                return None
            await db.execute(insert(files).values({**values, "size": len(data), "data": data}))
        return block

    async def file(self, owner: Owner, conversation_id: str, file_id: str):
        """One of the owner's files: (name, content_type, data), or None."""
        query = (
            select(files.c.name, files.c.content_type, files.c.data)
            .join(conversations, files.c.conversation_id == conversations.c.id)
            .where(self._owned(owner) & (conversations.c.id == conversation_id) & (files.c.id == file_id))
        )
        async with self.engine.connect() as db:
            return (await db.execute(query)).first()

    async def file_contents(self, conversation_id: str, file_ids: Sequence[str]) -> list[AgentFile]:
        """The files a question was sent with, in the order named, for the agent. Read after start_turn checked them."""
        named = list(dict.fromkeys(file_ids))
        query = select(files.c.id, files.c.name, files.c.content_type, files.c.data).where(
            (files.c.conversation_id == conversation_id) & files.c.id.in_(named)
        )
        async with self.engine.connect() as db:
            found = {row.id: row for row in await db.execute(query)}
        return [AgentFile(found[key].name, found[key].content_type, found[key].data) for key in named if key in found]

    async def finish(
        self,
        answer_id: str,
        status: str,
        blocks: list[dict],
        error: ApiError | None,
        agent_message_id: str | None = None,
    ) -> None:
        """Stores the answer as it ended, with PF's ID for it (shortcut: kept only at the end, so an answer whose
        gateway stopped mid-turn cannot be fetched from PF; store it as soon as PF sends it when that is built)."""
        values = {
            "status": status,
            "blocks": blocks,
            "error": error.model_dump(mode="json") if error else None,
            "agent_message_id": agent_message_id,
            "updated_at": func.now(),
        }
        async with self.engine.begin() as db:
            await db.execute(update(messages).where(messages.c.id == answer_id).values(values))

    async def messages(
        self, owner: Owner, conversation_id: str, before: int | None, limit: int
    ) -> tuple[list[Message], int | None]:
        """A page of messages, oldest first, ending just before message number `before` (the newest page when None),
        and the `before` that gives the page above it (None when this page reaches the first message)."""
        query = self._shown(owner, conversation_id)
        if before is not None:
            query = query.where(messages.c.seq < before)
        async with self.engine.connect() as db:
            rows = list(await db.execute(query.order_by(messages.c.seq.desc()).limit(limit + 1)))
        older = rows[limit - 1].seq if len(rows) > limit else None
        return [_message(row) for row in reversed(rows[:limit])], older

    async def message(self, owner: Owner, conversation_id: str, message_id: str) -> Message | None:
        query = self._shown(owner, conversation_id).where(messages.c.id == message_id)
        async with self.engine.connect() as db:
            row = (await db.execute(query)).first()
        return _message(row) if row else None

    def _shown(self, owner: Owner, conversation_id: str):
        """A conversation's messages as the visitor sees them, with their own rating and pin of each."""
        return (
            select(messages, feedback.c.rating, pins.c.message_id.is_not(None).label("pinned"))
            .join(conversations, messages.c.conversation_id == conversations.c.id)
            .outerjoin(feedback, feedback.c.message_id == messages.c.id)
            .outerjoin(pins, pins.c.message_id == messages.c.id)
            .where(self._owned(owner) & (conversations.c.id == conversation_id))
        )

    def _finished_answer(self, owner: Owner, conversation_id: str, message_id: str):
        """One of the owner's finished answers: what may be rated or pinned."""
        return (
            select(messages.c.id, messages.c.reply_to)
            .join(conversations, messages.c.conversation_id == conversations.c.id)
            .where(self._owned(owner) & (conversations.c.id == conversation_id) & (messages.c.id == message_id))
            .where((messages.c.role == "assistant") & (messages.c.status == "complete"))
        )

    @staticmethod
    def _mine(table: Table, owner: Owner, conversation_id: str, message_id: str):
        """The owner's row about one message, in the feedback or pins table."""
        return (
            (table.c.message_id == message_id)
            & (table.c.conversation_id == conversation_id)
            & (table.c.tenant_id == owner.tenant_id)
            & (table.c.widget_id == owner.widget_id)
            & (table.c.user_id == owner.user_id)
        )

    # Feedback (M4-T10)

    async def rate(
        self, owner: Owner, user_kind: str, conversation_id: str, message_id: str, rating: str, comment: str | None
    ) -> bool:
        """Stores the visitor's rating of one of their finished answers, replacing an earlier one. False if there is
        no such answer."""
        async with self.engine.begin() as db:
            found = (await db.execute(self._finished_answer(owner, conversation_id, message_id))).first()
            if not found:
                return False
            row = {
                "message_id": message_id,
                "question_id": found.reply_to,
                "conversation_id": conversation_id,
                **owner.__dict__,
                "user_kind": user_kind,
                "rating": rating,
                "comment": comment,
            }
            changed = {"rating": rating, "comment": comment, "updated_at": func.now()}
            upsert = pg_insert(feedback).values(row).on_conflict_do_update(index_elements=["message_id"], set_=changed)
            await db.execute(upsert)
        return True

    async def unrate(self, owner: Owner, conversation_id: str, message_id: str) -> None:
        """Takes back the visitor's rating of an answer, if they gave one."""
        async with self.engine.begin() as db:
            await db.execute(delete(feedback).where(self._mine(feedback, owner, conversation_id, message_id)))

    # Pins (signed-in visitors)

    async def pin(self, owner: Owner, conversation_id: str, message_id: str) -> bool:
        """Pins one of the owner's finished answers; pinning it again changes nothing. False if there is no such
        answer."""
        async with self.engine.begin() as db:
            if not (await db.execute(self._finished_answer(owner, conversation_id, message_id))).first():
                return False
            row = {"message_id": message_id, "conversation_id": conversation_id, **owner.__dict__}
            await db.execute(pg_insert(pins).values(row).on_conflict_do_nothing())
        return True

    async def unpin(self, owner: Owner, conversation_id: str, message_id: str) -> None:
        async with self.engine.begin() as db:
            await db.execute(delete(pins).where(self._mine(pins, owner, conversation_id, message_id)))

    async def pinned(self, owner: Owner, limit: int = 100) -> list[Pin]:
        """The owner's pinned answers, the newest pin first, each with its question and chat.
        shortcut: the newest 100 with no paging; add a cursor when someone keeps more."""
        asked = messages.alias("asked")
        chat = conversations.c
        query = (
            select(
                messages,
                feedback.c.rating,
                true().label("pinned"),
                pins.c.created_at.label("pinned_at"),
                chat.title.label("chat_title"),
                chat.created_at.label("chat_created_at"),
                chat.updated_at.label("chat_updated_at"),
                chat.project_id.label("chat_project_id"),
                asked.c.blocks.label("question_blocks"),
            )
            .select_from(
                pins.join(messages, messages.c.id == pins.c.message_id)
                .join(conversations, conversations.c.id == messages.c.conversation_id)
                .outerjoin(asked, asked.c.id == messages.c.reply_to)
                .outerjoin(feedback, feedback.c.message_id == messages.c.id)
            )
            .where(self._owned(owner))
            .order_by(pins.c.created_at.desc(), pins.c.message_id.desc())
            .limit(limit)
        )
        async with self.engine.connect() as db:
            rows = list(await db.execute(query))
        return [
            Pin(
                conversation=Conversation(
                    id=row.conversation_id,
                    title=row.chat_title,
                    created_at=row.chat_created_at,
                    updated_at=row.chat_updated_at,
                    project_id=row.chat_project_id,
                ),
                question=next((block["text"] for block in row.question_blocks or [] if block["type"] == "text"), None),
                message=_message(row),
                pinned_at=row.pinned_at,
            )
            for row in rows
        ]
