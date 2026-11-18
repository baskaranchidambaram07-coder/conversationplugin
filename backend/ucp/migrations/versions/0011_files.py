"""Files visitors attach to questions (M10): doc, docx, pdf, jpg, jpeg and png, at most 10 MB, kept with their
conversation. A question's blocks name the files sent with it."""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"


def upgrade() -> None:
    op.create_table(
        "files",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("conversation_id", sa.Text, sa.ForeignKey("conversations.id"), nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("content_type", sa.Text, nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("data", sa.LargeBinary, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("files_by_conversation", "files", ["conversation_id"])


def downgrade() -> None:
    op.drop_table("files")
