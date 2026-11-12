"""Widgets, conversations and messages."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None


def _times():
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def upgrade() -> None:
    op.create_table(
        "widgets",
        sa.Column("widget_id", sa.Text, primary_key=True),
        sa.Column("version", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("document", JSONB, nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "conversations",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("widget_id", sa.Text, nullable=False),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("agent_conversation_id", sa.Text),
        sa.Column("title", sa.Text),
        *_times(),
    )
    op.create_index("conversations_by_owner", "conversations", ["tenant_id", "widget_id", "user_id", "updated_at"])
    op.create_table(
        "messages",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("conversation_id", sa.Text, sa.ForeignKey("conversations.id"), nullable=False),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("role", sa.Text, sa.CheckConstraint("role in ('user', 'assistant')"), nullable=False),
        sa.Column(
            "status",
            sa.Text,
            sa.CheckConstraint("status in ('in_progress', 'complete', 'failed', 'stopped')"),
            nullable=False,
        ),
        sa.Column("blocks", JSONB, nullable=False),
        sa.Column("error", JSONB),
        sa.Column("client_message_id", sa.Text),
        sa.Column("reply_to", sa.Text, sa.ForeignKey("messages.id")),
        sa.Column("agent_message_id", sa.Text),
        sa.Column("config_version", sa.Integer),
        *_times(),
        sa.UniqueConstraint("conversation_id", "seq"),
        sa.UniqueConstraint("conversation_id", "client_message_id"),
    )


def downgrade() -> None:
    op.drop_table("messages")
    op.drop_index("conversations_by_owner", "conversations")
    op.drop_table("conversations")
    op.drop_table("widgets")
