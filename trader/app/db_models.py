from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
import os
import time
import uuid

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlmodel import Field, SQLModel


def uuid7() -> uuid.UUID:
    timestamp_ms = int(time.time() * 1000) & ((1 << 48) - 1)
    rand_a = int.from_bytes(os.urandom(2), "big") & 0x0FFF
    rand_b = int.from_bytes(os.urandom(8), "big") & ((1 << 62) - 1)
    value = (timestamp_ms << 80) | (0x7 << 76) | (rand_a << 64) | (0x2 << 62) | rand_b
    return uuid.UUID(int=value)


class ArbPositionStatus(str, Enum):
    idle = "idle"
    pending = "pending"
    partially_filled = "partially_filled"
    hedged = "hedged"
    exiting = "exiting"
    closed = "closed"
    failed = "failed"


class RiskTaskType(str, Enum):
    auto_close = "auto_close"
    liquidation_guard = "liquidation_guard"


class RiskTaskStatus(str, Enum):
    pending = "pending"
    triggered = "triggered"
    canceled = "canceled"
    failed = "failed"


class OrderStatus(str, Enum):
    sent = "sent"
    accepted = "accepted"
    rejected = "rejected"
    failed = "failed"


class ArbPosition(SQLModel, table=True):
    __tablename__ = "arb_positions"

    id: uuid.UUID = Field(
        default_factory=uuid7,
        sa_column=Column(PGUUID(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(PGUUID(as_uuid=True), nullable=False, index=True),
    )
    symbol: str = Field(index=True)
    left_venue: str
    right_venue: str
    left_side: str
    right_side: str
    notional: float
    leverage_left: float
    leverage_right: float
    status: ArbPositionStatus = Field(default=ArbPositionStatus.idle, index=True)
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    open_order_ids: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    close_order_ids: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    meta: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    deleted_at: Optional[datetime] = Field(default=None, index=True)


class RiskTask(SQLModel, table=True):
    __tablename__ = "risk_tasks"

    id: uuid.UUID = Field(
        default_factory=uuid7,
        sa_column=Column(PGUUID(as_uuid=True), primary_key=True, nullable=False),
    )
    arb_position_id: uuid.UUID = Field(
        sa_column=Column(PGUUID(as_uuid=True), nullable=False),
    )
    task_type: RiskTaskType
    enabled: bool = True
    threshold_pct: Optional[float] = None
    execute_at: Optional[datetime] = None
    triggered_at: Optional[datetime] = None
    status: RiskTaskStatus = Field(default=RiskTaskStatus.pending, index=True)
    trigger_reason: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    deleted_at: Optional[datetime] = Field(default=None, index=True)


class OrderLog(SQLModel, table=True):
    __tablename__ = "order_logs"

    id: uuid.UUID = Field(
        default_factory=uuid7,
        sa_column=Column(PGUUID(as_uuid=True), primary_key=True, nullable=False),
    )
    arb_position_id: uuid.UUID = Field(
        sa_column=Column(PGUUID(as_uuid=True), nullable=False),
    )
    venue: str
    side: str
    price: float
    size: float
    reduce_only: bool = False
    request_payload: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    response_payload: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    status: OrderStatus = Field(default=OrderStatus.sent, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    deleted_at: Optional[datetime] = Field(default=None, index=True)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: uuid.UUID = Field(
        default_factory=uuid7,
        sa_column=Column(PGUUID(as_uuid=True), primary_key=True, nullable=False),
    )
    username: str = Field(index=True)
    password_hash: str
    password_salt: str
    is_active: bool = True
    is_admin: bool = False
    failed_attempts: int = 0
    failed_first_at: Optional[datetime] = None
    locked_until: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    deleted_at: Optional[datetime] = Field(default=None, index=True)


class TradingProfile(SQLModel, table=True):
    __tablename__ = "trading_profiles"

    id: uuid.UUID = Field(
        default_factory=uuid7,
        sa_column=Column(PGUUID(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(PGUUID(as_uuid=True), nullable=False, unique=True, index=True),
    )
    lighter_account_index: Optional[int] = None
    lighter_api_key_index: Optional[int] = None
    lighter_private_key_enc: Optional[str] = None
    grvt_api_key_enc: Optional[str] = None
    grvt_private_key_enc: Optional[str] = None
    grvt_trading_account_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
