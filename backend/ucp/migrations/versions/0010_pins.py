"""Pinned answers: a signed-in visitor keeps an answer to find it again."""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"


def upgrade() -> None:
    op.create_table(
        "pins",
        sa.Column("message_id", sa.Text, sa.ForeignKey("messages.id"), primary_key=True),
        sa.Column("conversation_id", sa.Text, sa.ForeignKey("conversations.id"), nullable=False),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("widget_id", sa.Text, nullable=False),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("pins_by_owner", "pins", ["tenant_id", "widget_id", "user_id", "created_at"])


def downgrade() -> None:
    op.drop_table("pins")
