"""Add encrypted exchange credentials to users.

Revision ID: 0003_user_exchange_creds
Revises: 0002_users
Create Date: 2025-02-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0003_user_exchange_creds"
down_revision = "0002_users"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("lighter_account_index", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("lighter_api_key_index", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("lighter_private_key_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("grvt_api_key_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("grvt_private_key_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("grvt_trading_account_id", sa.String(), nullable=True))


def downgrade():
    op.drop_column("users", "grvt_trading_account_id")
    op.drop_column("users", "grvt_private_key_enc")
    op.drop_column("users", "grvt_api_key_enc")
    op.drop_column("users", "lighter_private_key_enc")
    op.drop_column("users", "lighter_api_key_index")
    op.drop_column("users", "lighter_account_index")
