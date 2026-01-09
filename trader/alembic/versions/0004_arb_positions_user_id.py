"""Add user_id to arb_positions.

Revision ID: 0004_arb_positions_user_id
Revises: 0003_user_exchange_creds
Create Date: 2026-01-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_arb_positions_user_id"
down_revision = "0003_user_exchange_creds"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "arb_positions",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_arb_positions_user_id", "arb_positions", ["user_id"])


def downgrade():
    op.drop_index("ix_arb_positions_user_id", table_name="arb_positions")
    op.drop_column("arb_positions", "user_id")
