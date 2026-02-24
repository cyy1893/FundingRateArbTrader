"""Add asset_icons table for symbol icon URL persistence.

Revision ID: 0006_asset_icons
Revises: 0005_split_trading_profiles
Create Date: 2026-02-24 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006_asset_icons"
down_revision = "0005_split_trading_profiles"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "asset_icons",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("symbol", sa.String(), nullable=False),
        sa.Column("icon_url", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_unique_constraint("uq_asset_icons_symbol", "asset_icons", ["symbol"])
    op.create_index("ix_asset_icons_symbol", "asset_icons", ["symbol"], unique=False, if_not_exists=True)
    op.create_index("ix_asset_icons_last_checked_at", "asset_icons", ["last_checked_at"], if_not_exists=True)
    op.create_index("ix_asset_icons_created_at", "asset_icons", ["created_at"], if_not_exists=True)
    op.create_index("ix_asset_icons_updated_at", "asset_icons", ["updated_at"], if_not_exists=True)
    op.create_index("ix_asset_icons_deleted_at", "asset_icons", ["deleted_at"], if_not_exists=True)


def downgrade():
    op.drop_index("ix_asset_icons_deleted_at", table_name="asset_icons")
    op.drop_index("ix_asset_icons_updated_at", table_name="asset_icons")
    op.drop_index("ix_asset_icons_created_at", table_name="asset_icons")
    op.drop_index("ix_asset_icons_last_checked_at", table_name="asset_icons")
    op.drop_index("ix_asset_icons_symbol", table_name="asset_icons")
    op.drop_constraint("uq_asset_icons_symbol", "asset_icons", type_="unique")
    op.drop_table("asset_icons")

