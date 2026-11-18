"""Visitors' ratings of answers (M4-T10, M2's feedback buttons): like or dislike, with an optional comment.

Each row is tied to the answer and to the question it answers. A public visitor's row is marked anonymous.
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column("message_id", sa.Text, sa.ForeignKey("messages.id"), primary_key=True),
        sa.Column("question_id", sa.Text, sa.ForeignKey("messages.id")),
        sa.Column("conversation_id", sa.Text, sa.ForeignKey("conversations.id"), nullable=False),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("widget_id", sa.Text, nullable=False),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("user_kind", sa.Text, sa.CheckConstraint("user_kind in ('anonymous', 'signed_in')"), nullable=False),
        sa.Column("rating", sa.Text, sa.CheckConstraint("rating in ('like', 'dislike')"), nullable=False),
        sa.Column("comment", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("feedback_by_widget", "feedback", ["tenant_id", "widget_id", "created_at"])


def downgrade() -> None:
    op.drop_table("feedback")
