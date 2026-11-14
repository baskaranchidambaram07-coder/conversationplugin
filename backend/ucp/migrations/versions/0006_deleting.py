"""Deleting a widget or a tenant through the admin API (M9).

Published versions and the audit log never change (0004), so a deleted widget is recorded as deleted: the gateway no
longer serves it and the admin API no longer shows it, while its versions, its audit trail and its visitors'
conversations stay until the purge policy says otherwise. A deleted tenant keeps its row, marked deleted, so that
publishing the widget file at a release cannot bring it back; its administrators and its secrets are removed.
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade() -> None:
    op.add_column("tenants", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("tenants", sa.Column("deleted_by", sa.Text))
    op.create_table(
        "deleted_widgets",
        sa.Column("widget_id", sa.Text, primary_key=True),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_by", sa.Text, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("deleted_widgets")
    op.drop_column("tenants", "deleted_by")
    op.drop_column("tenants", "deleted_at")
