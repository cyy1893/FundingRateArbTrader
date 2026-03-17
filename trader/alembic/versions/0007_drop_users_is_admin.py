"""Drop is_admin from users.

Revision ID: 0007_drop_users_is_admin
Revises: 0006_asset_icons
Create Date: 2026-03-17 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_drop_users_is_admin"
down_revision = "0006_asset_icons"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("users", "is_admin")


def downgrade():
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
