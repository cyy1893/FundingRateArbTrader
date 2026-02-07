"""Split trading credentials from users into trading_profiles.

Revision ID: 0005_split_trading_profiles
Revises: 0004_arb_positions_user_id
Create Date: 2026-02-08 00:00:00.000000

"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005_split_trading_profiles"
down_revision = "0004_arb_positions_user_id"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "trading_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lighter_account_index", sa.Integer(), nullable=True),
        sa.Column("lighter_api_key_index", sa.Integer(), nullable=True),
        sa.Column("lighter_private_key_enc", sa.Text(), nullable=True),
        sa.Column("grvt_api_key_enc", sa.Text(), nullable=True),
        sa.Column("grvt_private_key_enc", sa.Text(), nullable=True),
        sa.Column("grvt_trading_account_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_trading_profiles_user_id", "trading_profiles", ["user_id"], unique=True, if_not_exists=True)
    op.create_index("ix_trading_profiles_created_at", "trading_profiles", ["created_at"], if_not_exists=True)
    op.create_index("ix_trading_profiles_updated_at", "trading_profiles", ["updated_at"], if_not_exists=True)
    op.create_index("ix_trading_profiles_deleted_at", "trading_profiles", ["deleted_at"], if_not_exists=True)

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            """
            SELECT
                id,
                lighter_account_index,
                lighter_api_key_index,
                lighter_private_key_enc,
                grvt_api_key_enc,
                grvt_private_key_enc,
                grvt_trading_account_id,
                created_at,
                updated_at,
                deleted_at
            FROM users
            """
        )
    ).mappings()

    insert_stmt = sa.text(
        """
        INSERT INTO trading_profiles (
            id,
            user_id,
            lighter_account_index,
            lighter_api_key_index,
            lighter_private_key_enc,
            grvt_api_key_enc,
            grvt_private_key_enc,
            grvt_trading_account_id,
            created_at,
            updated_at,
            deleted_at
        ) VALUES (
            :id,
            :user_id,
            :lighter_account_index,
            :lighter_api_key_index,
            :lighter_private_key_enc,
            :grvt_api_key_enc,
            :grvt_private_key_enc,
            :grvt_trading_account_id,
            :created_at,
            :updated_at,
            :deleted_at
        )
        """
    )

    for row in rows:
        connection.execute(
            insert_stmt,
            {
                "id": uuid.uuid4(),
                "user_id": row["id"],
                "lighter_account_index": row["lighter_account_index"],
                "lighter_api_key_index": row["lighter_api_key_index"],
                "lighter_private_key_enc": row["lighter_private_key_enc"],
                "grvt_api_key_enc": row["grvt_api_key_enc"],
                "grvt_private_key_enc": row["grvt_private_key_enc"],
                "grvt_trading_account_id": row["grvt_trading_account_id"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "deleted_at": row["deleted_at"],
            },
        )

    op.drop_column("users", "grvt_trading_account_id")
    op.drop_column("users", "grvt_private_key_enc")
    op.drop_column("users", "grvt_api_key_enc")
    op.drop_column("users", "lighter_private_key_enc")
    op.drop_column("users", "lighter_api_key_index")
    op.drop_column("users", "lighter_account_index")


def downgrade():
    op.add_column("users", sa.Column("lighter_account_index", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("lighter_api_key_index", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("lighter_private_key_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("grvt_api_key_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("grvt_private_key_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("grvt_trading_account_id", sa.String(), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            """
            SELECT
                user_id,
                lighter_account_index,
                lighter_api_key_index,
                lighter_private_key_enc,
                grvt_api_key_enc,
                grvt_private_key_enc,
                grvt_trading_account_id
            FROM trading_profiles
            WHERE deleted_at IS NULL
            """
        )
    ).mappings()

    update_stmt = sa.text(
        """
        UPDATE users
        SET
            lighter_account_index = :lighter_account_index,
            lighter_api_key_index = :lighter_api_key_index,
            lighter_private_key_enc = :lighter_private_key_enc,
            grvt_api_key_enc = :grvt_api_key_enc,
            grvt_private_key_enc = :grvt_private_key_enc,
            grvt_trading_account_id = :grvt_trading_account_id
        WHERE id = :user_id
        """
    )

    for row in rows:
        connection.execute(
            update_stmt,
            {
                "user_id": row["user_id"],
                "lighter_account_index": row["lighter_account_index"],
                "lighter_api_key_index": row["lighter_api_key_index"],
                "lighter_private_key_enc": row["lighter_private_key_enc"],
                "grvt_api_key_enc": row["grvt_api_key_enc"],
                "grvt_private_key_enc": row["grvt_private_key_enc"],
                "grvt_trading_account_id": row["grvt_trading_account_id"],
            },
        )

    op.drop_index("ix_trading_profiles_deleted_at", table_name="trading_profiles")
    op.drop_index("ix_trading_profiles_updated_at", table_name="trading_profiles")
    op.drop_index("ix_trading_profiles_created_at", table_name="trading_profiles")
    op.drop_index("ix_trading_profiles_user_id", table_name="trading_profiles")
    op.drop_table("trading_profiles")
