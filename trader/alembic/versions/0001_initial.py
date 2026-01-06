"""Initial arb/risk/order tables.

Revision ID: 0001_initial
Revises:
Create Date: 2025-02-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    arb_status = sa.Enum(
        "idle",
        "pending",
        "partially_filled",
        "hedged",
        "exiting",
        "closed",
        "failed",
        name="arb_position_status",
    )
    risk_task_type = sa.Enum("auto_close", "liquidation_guard", name="risk_task_type")
    risk_task_status = sa.Enum("pending", "triggered", "canceled", "failed", name="risk_task_status")
    order_status = sa.Enum("sent", "accepted", "rejected", "failed", name="order_status")

    op.create_table(
        "arb_positions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("symbol", sa.String(), nullable=False, index=True),
        sa.Column("left_venue", sa.String(), nullable=False),
        sa.Column("right_venue", sa.String(), nullable=False),
        sa.Column("left_side", sa.String(), nullable=False),
        sa.Column("right_side", sa.String(), nullable=False),
        sa.Column("notional", sa.Float(), nullable=False),
        sa.Column("leverage_left", sa.Float(), nullable=False),
        sa.Column("leverage_right", sa.Float(), nullable=False),
        sa.Column("status", arb_status, nullable=False),
        sa.Column("opened_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("open_order_ids", postgresql.JSONB(), nullable=True),
        sa.Column("close_order_ids", postgresql.JSONB(), nullable=True),
        sa.Column("meta", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_arb_positions_symbol", "arb_positions", ["symbol"], if_not_exists=True)
    op.create_index("ix_arb_positions_status", "arb_positions", ["status"], if_not_exists=True)
    op.create_index("ix_arb_positions_created_at", "arb_positions", ["created_at"], if_not_exists=True)
    op.create_index("ix_arb_positions_updated_at", "arb_positions", ["updated_at"], if_not_exists=True)
    op.create_index("ix_arb_positions_deleted_at", "arb_positions", ["deleted_at"], if_not_exists=True)

    op.create_table(
        "risk_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "arb_position_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            index=True,
        ),
        sa.Column("task_type", risk_task_type, nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("threshold_pct", sa.Float(), nullable=True),
        sa.Column("execute_at", sa.DateTime(), nullable=True),
        sa.Column("triggered_at", sa.DateTime(), nullable=True),
        sa.Column("status", risk_task_status, nullable=False),
        sa.Column("trigger_reason", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_risk_tasks_arb_position_id", "risk_tasks", ["arb_position_id"], if_not_exists=True)
    op.create_index("ix_risk_tasks_status", "risk_tasks", ["status"], if_not_exists=True)
    op.create_index("ix_risk_tasks_created_at", "risk_tasks", ["created_at"], if_not_exists=True)
    op.create_index("ix_risk_tasks_updated_at", "risk_tasks", ["updated_at"], if_not_exists=True)
    op.create_index("ix_risk_tasks_deleted_at", "risk_tasks", ["deleted_at"], if_not_exists=True)

    op.create_table(
        "order_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "arb_position_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            index=True,
        ),
        sa.Column("venue", sa.String(), nullable=False),
        sa.Column("side", sa.String(), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("size", sa.Float(), nullable=False),
        sa.Column("reduce_only", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("request_payload", postgresql.JSONB(), nullable=True),
        sa.Column("response_payload", postgresql.JSONB(), nullable=True),
        sa.Column("status", order_status, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_order_logs_arb_position_id", "order_logs", ["arb_position_id"], if_not_exists=True)
    op.create_index("ix_order_logs_status", "order_logs", ["status"], if_not_exists=True)
    op.create_index("ix_order_logs_created_at", "order_logs", ["created_at"], if_not_exists=True)
    op.create_index("ix_order_logs_updated_at", "order_logs", ["updated_at"], if_not_exists=True)
    op.create_index("ix_order_logs_deleted_at", "order_logs", ["deleted_at"], if_not_exists=True)


def downgrade():
    op.drop_index("ix_order_logs_deleted_at", table_name="order_logs")
    op.drop_index("ix_order_logs_updated_at", table_name="order_logs")
    op.drop_index("ix_order_logs_created_at", table_name="order_logs")
    op.drop_index("ix_order_logs_status", table_name="order_logs")
    op.drop_index("ix_order_logs_arb_position_id", table_name="order_logs")
    op.drop_table("order_logs")

    op.drop_index("ix_risk_tasks_deleted_at", table_name="risk_tasks")
    op.drop_index("ix_risk_tasks_updated_at", table_name="risk_tasks")
    op.drop_index("ix_risk_tasks_created_at", table_name="risk_tasks")
    op.drop_index("ix_risk_tasks_status", table_name="risk_tasks")
    op.drop_index("ix_risk_tasks_arb_position_id", table_name="risk_tasks")
    op.drop_table("risk_tasks")

    op.drop_index("ix_arb_positions_deleted_at", table_name="arb_positions")
    op.drop_index("ix_arb_positions_updated_at", table_name="arb_positions")
    op.drop_index("ix_arb_positions_created_at", table_name="arb_positions")
    op.drop_index("ix_arb_positions_status", table_name="arb_positions")
    op.drop_index("ix_arb_positions_symbol", table_name="arb_positions")
    op.drop_table("arb_positions")

    op.execute("DROP TYPE IF EXISTS order_status")
    op.execute("DROP TYPE IF EXISTS risk_task_status")
    op.execute("DROP TYPE IF EXISTS risk_task_type")
    op.execute("DROP TYPE IF EXISTS arb_position_status")
