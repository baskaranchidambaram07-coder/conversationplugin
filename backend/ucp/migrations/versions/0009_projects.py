"""Projects: a signed-in visitor's folders of chats. Deleting a project leaves its chats, unfiled."""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("widget_id", sa.Text, nullable=False),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("projects_by_owner", "projects", ["tenant_id", "widget_id", "user_id"])
    op.add_column("conversations", sa.Column("project_id", sa.Text, sa.ForeignKey("projects.id", ondelete="SET NULL")))
    op.create_index("conversations_by_project", "conversations", ["project_id", "updated_at"])


def downgrade() -> None:
    op.drop_index("conversations_by_project", "conversations")
    op.drop_column("conversations", "project_id")
    op.drop_table("projects")
