"""Images uploaded through the admin API (M1, M9): the assistant's picture on the launcher and in the chat.

Each is stored once under the SHA-256 of its bytes, so a stored image never changes and can be cached for ever.
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"


def upgrade() -> None:
    op.create_table(
        "images",
        sa.Column("digest", sa.Text, primary_key=True),
        sa.Column("tenant_id", sa.Text, sa.ForeignKey("tenants.tenant_id"), nullable=False),
        sa.Column("content_type", sa.Text, nullable=False),
        sa.Column("data", sa.LargeBinary, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", sa.Text, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("images")
