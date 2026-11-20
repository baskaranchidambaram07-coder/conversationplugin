"""Voice consents (M11): a visitor accepted the voice notice before their first recording."""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"


def upgrade() -> None:
    op.create_table(
        "voice_consents",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("widget_id", sa.Text, nullable=False),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("user_kind", sa.Text, sa.CheckConstraint("user_kind in ('anonymous', 'signed_in')"), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("engine", sa.Text, sa.CheckConstraint("engine in ('service', 'browser', 'device')"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("voice_consents_by_owner", "voice_consents", ["tenant_id", "widget_id", "user_id"])


def downgrade() -> None:
    op.drop_table("voice_consents")
