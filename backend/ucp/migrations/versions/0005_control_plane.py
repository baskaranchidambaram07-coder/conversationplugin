"""The control plane (M8): tenants, their administrators, widget drafts, and secrets set through the admin API.

- Tenants already named by published widgets are recorded as tenants.
- Each administrator is an identity-provider user (issuer and subject) with one role. A platform administrator
  holds no tenant; a tenant administrator and a viewer hold exactly one.
- A draft is a widget's next document, with a revision number, so two people editing it cannot overwrite each
  other unseen.
- A secret (a customer's shared secret, a PF connection profile) is stored encrypted (ucp.vault), never in clear.
- The audit log also records actions that touch no widget version (a tenant, an administrator, a secret), so its
  widget and version may be empty. Its rows still cannot change (0004).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005"
down_revision = "0004"


def _times():
    return (
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by", sa.Text, nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("tenant_id", sa.Text, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", sa.Text, nullable=False),
    )
    op.execute(
        "INSERT INTO tenants (tenant_id, name, created_by) SELECT DISTINCT tenant_id, tenant_id, 'migration 0005' "
        "FROM widgets"
    )
    op.create_table(
        "administrators",
        sa.Column("issuer", sa.Text, primary_key=True),
        sa.Column("subject", sa.Text, primary_key=True),
        sa.Column("role", sa.Text, sa.CheckConstraint("role in ('platform', 'tenant', 'viewer')"), nullable=False),
        sa.Column("tenant_id", sa.Text, sa.ForeignKey("tenants.tenant_id")),
        sa.Column("label", sa.Text),  # how the other administrators know them; never required
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", sa.Text, nullable=False),
        sa.CheckConstraint("(role = 'platform') = (tenant_id IS NULL)", name="administrators_tenant_by_role"),
    )
    op.create_table(
        "drafts",
        sa.Column("widget_id", sa.Text, primary_key=True),
        sa.Column("tenant_id", sa.Text, sa.ForeignKey("tenants.tenant_id"), nullable=False),
        sa.Column("document", JSONB, nullable=False),
        sa.Column("revision", sa.Integer, nullable=False),
        *_times(),
    )
    op.create_table(
        "secrets",
        sa.Column("tenant_id", sa.Text, sa.ForeignKey("tenants.tenant_id"), primary_key=True),
        sa.Column("kind", sa.Text, sa.CheckConstraint("kind in ('host', 'profile')"), primary_key=True),
        sa.Column("name", sa.Text, primary_key=True),
        sa.Column("key_id", sa.Text, nullable=False),  # which encryption key sealed it
        sa.Column("nonce", sa.LargeBinary, nullable=False),
        sa.Column("sealed", sa.LargeBinary, nullable=False),
        *_times(),
    )
    op.alter_column("audit", "widget_id", nullable=True)
    op.alter_column("audit", "version", nullable=True)
    op.create_index("audit_by_tenant", "audit", ["tenant_id", "at"])


def downgrade() -> None:
    op.drop_index("audit_by_tenant", "audit")
    for table in ("secrets", "drafts", "administrators", "tenants"):
        op.drop_table(table)
    # The audit columns stay optional: entries without a widget cannot be removed (the log only grows), and 0004's
    # downgrade drops the table anyway.
