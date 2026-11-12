"""Identities (who a signed-in user is to us) and the host tokens already used."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"


def upgrade() -> None:
    op.create_table(
        "identities",
        sa.Column("tenant_id", sa.Text, primary_key=True),
        sa.Column("provider", sa.Text, primary_key=True),
        sa.Column("subject", sa.Text, primary_key=True),
        sa.Column("user_id", sa.Text, nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "used_host_tokens",
        sa.Column("widget_id", sa.Text, primary_key=True),
        sa.Column("token_hash", sa.Text, primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("used_host_tokens_by_expiry", "used_host_tokens", ["expires_at"])


def downgrade() -> None:
    op.drop_index("used_host_tokens_by_expiry", "used_host_tokens")
    op.drop_table("used_host_tokens")
    op.drop_table("identities")
