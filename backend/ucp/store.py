"""Storage (the core of M7, built with M4): published widget versions, conversations and messages in PostgreSQL.

Every conversation and message is read through its owner (tenant, widget and user), so a conversation ID taken
from someone else simply is not found. PF's own IDs are kept here and never leave the server (R13).
"""

import secrets
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
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    delete,
    func,
    insert,
    select,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from ucp.protocol import ApiError, Block, Conversation, Message

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
    Column("widget_id", Text, nullable=False),
    Column("version", Integer, nullable=False),
    Column("detail", JSONB),
    Index("audit_by_widget", "widget_id", "at"),
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
    Index("conversations_by_owner", "tenant_id", "widget_id", "user_id", "updated_at"),
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


def _conversation(row) -> Conversation:
    return Conversation(id=row.id, title=row.title, created_at=row.created_at, updated_at=row.updated_at)


def _message(row) -> Message:
    # Built field by field: PF IDs and the config version stay behind (D15).
    error = ApiError.model_validate(row.error) if row.error else None
    blocks = [_BLOCK.validate_python(block) for block in row.blocks]
    return Message(id=row.id, role=row.role, status=row.status, blocks=blocks, error=error, created_at=row.created_at)


class Store:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    # Widgets

    async def publish_widget(self, widget_id: str, tenant_id: str, document: dict, actor: str = "system") -> int:
        """Stores the document as the widget's next version, unless it is the same as the current one, and records
        who did it in the audit log. Returns the version now in use."""
        async with self.engine.begin() as db:
            return await self._publish(db, widget_id, tenant_id, document, actor, "publish", None)

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
            return await self._publish(db, widget_id, earlier.tenant_id, earlier.document, actor, "rollback", detail)

    async def _publish(self, db, widget_id, tenant_id, document, actor, action, detail) -> int:
        # shortcut: two people publishing the same widget at the same instant collide on the version number and
        # one is refused; fine for an operator's command, revisit with the admin API (M8 with M9).
        current = await self._latest(db, widget_id)
        if current and current.document == document and current.tenant_id == tenant_id:
            return current.version
        version = current.version + 1 if current else 1
        row = {"widget_id": widget_id, "version": version, "tenant_id": tenant_id, "document": document}
        await db.execute(insert(widgets).values({**row, "published_by": actor}))
        entry = {"actor": actor, "action": action, "tenant_id": tenant_id, "widget_id": widget_id, "detail": detail}
        await db.execute(insert(audit).values({**entry, "version": version}))
        return version

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
        """A widget's current version, or the one asked for: (version, tenant_id, document), or None."""
        async with self.engine.connect() as db:
            if version is None:
                return await self._latest(db, widget_id)
            query = select(widgets.c.version, widgets.c.tenant_id, widgets.c.document).where(
                (widgets.c.widget_id == widget_id) & (widgets.c.version == version)
            )
            return (await db.execute(query)).first()

    @staticmethod
    async def _latest(db, widget_id: str):
        query = (
            select(widgets.c.version, widgets.c.tenant_id, widgets.c.document)
            .where(widgets.c.widget_id == widget_id)
            .order_by(widgets.c.version.desc())
            .limit(1)
        )
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

    async def create_conversation(self, owner: Owner) -> Conversation:
        values = {"id": new_id("c"), **owner.__dict__}
        async with self.engine.begin() as db:
            row = (await db.execute(insert(conversations).values(values).returning(conversations))).one()
        return _conversation(row)

    async def conversation(self, owner: Owner, conversation_id: str) -> Conversation | None:
        async with self.engine.connect() as db:
            query = select(conversations).where(self._owned(owner) & (conversations.c.id == conversation_id))
            row = (await db.execute(query)).first()
        return _conversation(row) if row else None

    async def conversations(self, owner: Owner, before: tuple[datetime, str] | None, limit: int) -> list[Conversation]:
        """Most recently active first. `before` is the (updated_at, id) of the last one already shown: the ID breaks
        ties, so two conversations active at the same instant are neither skipped nor shown twice."""
        query = select(conversations).where(self._owned(owner))
        if before:
            query = query.where(tuple_(conversations.c.updated_at, conversations.c.id) < tuple_(*before))
        query = query.order_by(conversations.c.updated_at.desc(), conversations.c.id.desc()).limit(limit)
        async with self.engine.connect() as db:
            return [_conversation(row) for row in await db.execute(query)]

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
    ) -> Turn | None:
        """Stores a question and an empty answer, in one transaction. None if the conversation is not the owner's.

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
                            "blocks": [{"type": "text", "text": text}],
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
        query = (
            select(messages)
            .join(conversations, messages.c.conversation_id == conversations.c.id)
            .where(self._owned(owner) & (conversations.c.id == conversation_id))
        )
        if before is not None:
            query = query.where(messages.c.seq < before)
        async with self.engine.connect() as db:
            rows = list(await db.execute(query.order_by(messages.c.seq.desc()).limit(limit + 1)))
        older = rows[limit - 1].seq if len(rows) > limit else None
        return [_message(row) for row in reversed(rows[:limit])], older

    async def message(self, owner: Owner, conversation_id: str, message_id: str) -> Message | None:
        query = (
            select(messages)
            .join(conversations, messages.c.conversation_id == conversations.c.id)
            .where(self._owned(owner) & (conversations.c.id == conversation_id) & (messages.c.id == message_id))
        )
        async with self.engine.connect() as db:
            row = (await db.execute(query)).first()
        return _message(row) if row else None
