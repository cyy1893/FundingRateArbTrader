from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class DriftOrderRequest(BaseModel):
    venue: Literal["drift"] = "drift"
    market_type: Literal["perp", "spot"] = Field(..., description="Drift market type to trade on")
    market_index: int = Field(..., ge=0)
    direction: Literal["long", "short"] = Field(..., description="Long = buy/base increase, Short = sell")
    order_type: Literal["market", "limit", "trigger_market", "trigger_limit", "oracle"] = Field("limit")
    base_amount: float = Field(..., gt=0, description="Base asset amount in natural units (e.g. SOL)")
    price: Optional[float] = Field(None, gt=0, description="Limit price in USD, ignored for market orders")
    user_order_id: int = Field(0, ge=0, description="Optional Drift client order ID")
    reduce_only: bool = False
    post_only: Literal["none", "must", "try", "slide"] = "none"
    immediate_or_cancel: bool = False
    trigger_price: Optional[float] = Field(None, gt=0)
    trigger_condition: Literal["above", "below", "triggered_above", "triggered_below"] = "above"
    oracle_price_offset: Optional[float] = Field(
        None, description="Optional offset (in USD) for oracle triggered orders"
    )
    max_ts: Optional[int] = Field(None, description="Optional unix timestamp after which the order expires")
    auction_duration: Optional[int] = None
    auction_start_price: Optional[float] = None
    auction_end_price: Optional[float] = None


class DriftOrderResponse(BaseModel):
    tx_signature: str
    market_index: int
    market_type: str
    direction: str
    order_type: str


class LighterOrderRequest(BaseModel):
    venue: Literal["lighter"] = "lighter"
    market_index: int = Field(..., ge=0)
    client_order_index: int = Field(..., ge=0)
    base_amount: int = Field(..., gt=0, description="Base amount, quoted with 1e4 precision (see Lighter docs)")
    is_ask: bool = Field(..., description="True for sell orders, False for buy orders")
    order_type: Literal["market", "limit"] = "limit"
    price: Optional[int] = Field(
        None, description="Price in quote precision (1e2). Required for limit orders."
    )
    avg_execution_price: Optional[int] = Field(
        None, description="Worst acceptable execution price for market orders"
    )
    reduce_only: bool = False
    time_in_force: Literal["ioc", "gtc", "post_only"] = "gtc"
    trigger_price: Optional[int] = Field(None, description="Trigger price for conditional orders")
    order_expiry_secs: Optional[int] = Field(
        None, description="Optional unix timestamp when the order expires"
    )
    nonce: Optional[int] = None
    api_key_index: Optional[int] = None

    @field_validator("price")
    @classmethod
    def validate_price(cls, value: Optional[int], info):
        if info.data["order_type"] == "limit" and value is None:
            raise ValueError("price is required for limit orders")
        return value

    @field_validator("avg_execution_price")
    @classmethod
    def validate_avg_execution_price(cls, value: Optional[int], info):
        if info.data["order_type"] == "market" and value is None:
            raise ValueError("avg_execution_price is required for market orders")
        return value


class LighterOrderResponse(BaseModel):
    tx_hash: str
    payload: dict


class OrderEvent(BaseModel):
    venue: str
    payload: dict
    created_at: datetime


class DriftSpotBalance(BaseModel):
    market_index: int
    market_name: str
    balance_type: Literal["deposit", "borrow"]
    amount: float
    raw_amount: int
    decimals: int


class DriftPerpBalance(BaseModel):
    market_index: int
    market_name: str
    base_asset_amount: float
    raw_base_asset_amount: int
    quote_break_even_amount: float
    raw_quote_break_even_amount: int


class DriftBalanceSnapshot(BaseModel):
    sub_account_id: int
    spot_positions: list[DriftSpotBalance]
    perp_positions: list[DriftPerpBalance]


class LighterPositionBalance(BaseModel):
    market_id: int
    symbol: str
    sign: int
    position: float
    avg_entry_price: float
    position_value: float
    unrealized_pnl: float
    realized_pnl: float
    allocated_margin: float


class LighterBalanceSnapshot(BaseModel):
    account_index: int
    available_balance: float
    collateral: float
    total_asset_value: float
    cross_asset_value: float
    positions: list[LighterPositionBalance]


class BalancesResponse(BaseModel):
    drift: DriftBalanceSnapshot
    lighter: LighterBalanceSnapshot
