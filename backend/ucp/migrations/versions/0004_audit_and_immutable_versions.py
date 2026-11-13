"""The audit log, and published versions that cannot change (M8-T3, T9): who published or rolled back what, when.

Both tables only grow: a trigger refuses every update, delete and truncate, whoever asks. Dropping the tables
(a downgrade) still works, since that is a schema change made by the migration role.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"

GUARD = """
CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% only grows: its rows cannot be changed or removed', TG_TABLE_NAME;
END
$$
"""


def _guard(table: str) -> None:
    op.execute(f"CREATE TRIGGER {table}_only_grows BEFORE UPDATE OR DELETE ON {table} EXECUTE FUNCTION refuse_change()")
    op.execute(f"CREATE TRIGGER {table}_not_truncated BEFORE TRUNCATE ON {table} EXECUTE FUNCTION refuse_change()")


def upgrade() -> None:
    op.add_column("widgets", sa.Column("published_by", sa.Text))
    op.create_table(
        "audit",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("actor", sa.Text, nullable=False),
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("widget_id", sa.Text, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("detail", JSONB),
    )
    op.create_index("audit_by_widget", "audit", ["widget_id", "at"])
    op.execute(GUARD)
    _guard("audit")
    _guard("widgets")


def downgrade() -> None:
    for table in ("widgets", "audit"):
        op.execute(f"DROP TRIGGER {table}_not_truncated ON {table}")
        op.execute(f"DROP TRIGGER {table}_only_grows ON {table}")
    op.execute("DROP FUNCTION refuse_change()")
    op.drop_index("audit_by_widget", "audit")
    op.drop_table("audit")
    op.drop_column("widgets", "published_by")
