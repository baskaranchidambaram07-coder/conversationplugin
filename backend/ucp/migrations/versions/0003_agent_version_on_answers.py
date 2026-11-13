"""The agent version that wrote each answer (M7-T5): agents change on PF's schedule, so an answer can be traced."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade() -> None:
    op.add_column("messages", sa.Column("agent_version", sa.Text))


def downgrade() -> None:
    op.drop_column("messages", "agent_version")
