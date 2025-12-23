from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class LighterSymbolOrderRequest(BaseModel):
    symbol: str
    client_order_index: int = Field(..., ge=0)
    side: Literal["buy", "sell"]
    base_amount: float = Field(..., gt=0, description="Base amount in asset units")
    price: float = Field(..., gt=0, description="Limit price in quote units")
    reduce_only: bool = False
    time_in_force: Literal["post_only", "gtc", "ioc"] = "post_only"
    order_expiry_secs: Optional[int] = Field(
        None, description="Optional unix timestamp when the order expires"
    )
    api_key_index: Optional[int] = None


class LighterOrderResponse(BaseModel):
    tx_hash: str
    payload: dict


class OrderEvent(BaseModel):
    venue: str
    payload: dict
    created_at: datetime


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


class GrvtAssetBalance(BaseModel):
    currency: str
    total: float
    free: float
    used: float
    usd_value: float | None = None


class GrvtPositionBalance(BaseModel):
    instrument: str
    size: float
    notional: float
    entry_price: float
    mark_price: float
    unrealized_pnl: float
    realized_pnl: float
    total_pnl: float
    leverage: float | None = None


class GrvtBalanceSnapshot(BaseModel):
    sub_account_id: str
    settle_currency: str
    available_balance: float
    total_equity: float
    unrealized_pnl: float
    timestamp: datetime | None = None
    balances: list[GrvtAssetBalance] = Field(default_factory=list)
    positions: list[GrvtPositionBalance] = Field(default_factory=list)


class BalancesResponse(BaseModel):
    lighter: LighterBalanceSnapshot
    grvt: GrvtBalanceSnapshot


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class OrderBookLevel(BaseModel):
    """Single price level in the order book."""
    price: float
    size: float
    total: float  # Cumulative size


class OrderBookSide(BaseModel):
    """One side (bids or asks) of the order book."""
    levels: list[OrderBookLevel]


class VenueOrderBook(BaseModel):
    """Order book for a single venue."""
    venue: Literal["lighter", "grvt"]
    symbol: str
    bids: OrderBookSide
    asks: OrderBookSide
    timestamp: float


class OrderBookSnapshot(BaseModel):
    """Order book snapshot for available venues."""
    lighter: Optional[VenueOrderBook] = None
    grvt: Optional[VenueOrderBook] = None


class TradeEntry(BaseModel):
    venue: Literal["lighter", "grvt"]
    symbol: str
    price: float
    size: float
    is_buy: bool
    timestamp: float


class TradesSnapshot(BaseModel):
    lighter: list[TradeEntry] = Field(default_factory=list)
    grvt: list[TradeEntry] = Field(default_factory=list)


class OrderBookSubscription(BaseModel):
    """WebSocket subscription request for order book data."""
    symbol: str = Field(..., description="Trading symbol (e.g., BTC, ETH, SOL)")
    lighter_leverage: float = Field(..., gt=0, description="Leverage for Lighter")
    lighter_direction: Literal["long", "short"] = Field(..., description="Position direction for Lighter")
    grvt_leverage: float = Field(1, gt=0, description="Leverage for GRVT")
    grvt_direction: Literal["long", "short"] = Field("long", description="Position direction for GRVT")
    notional_value: float = Field(..., gt=0, description="Contract notional value in USD")
    depth: int = Field(10, ge=1, le=50, description="Number of price levels to include")
    throttle_ms: int = Field(500, ge=50, le=5000, description="Throttle interval in milliseconds for order book updates")


class GrvtOrderRequest(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    amount: float = Field(..., gt=0, description="Base amount in asset units")
    price: float = Field(..., gt=0, description="Limit price in quote units")
    post_only: bool = True
    reduce_only: bool = False
    order_duration_secs: int = Field(10, ge=1, le=3600, description="Order lifetime in seconds")
    client_order_id: Optional[int] = None


class GrvtOrderResponse(BaseModel):
    payload: dict


class ApiError(BaseModel):
    source: str
    message: str


class ExchangeMarketMetrics(BaseModel):
    base_symbol: str | None = None
    symbol: str
    display_name: str
    mark_price: float | None = None
    price_change_1h: float | None = None
    price_change_24h: float | None = None
    price_change_7d: float | None = None
    max_leverage: float | None = None
    funding_rate_hourly: float | None = None
    funding_period_hours: float | None = None
    day_notional_volume: float | None = None
    open_interest: float | None = None
    volume_usd: float | None = None


class ExchangeSnapshot(BaseModel):
    markets: list[ExchangeMarketMetrics]
    errors: list[ApiError] = Field(default_factory=list)


class MarketRow(BaseModel):
    left_provider: str
    right_provider: str
    left_symbol: str
    left_funding_period_hours: float | None = None
    symbol: str | None = None
    display_name: str | None = None
    icon_url: str | None = None
    coingecko_id: str | None = None
    mark_price: float | None = None
    price_change_1h: float | None = None
    price_change_24h: float | None = None
    price_change_7d: float | None = None
    max_leverage: float | None = None
    funding_rate: float | None = None
    day_notional_volume: float | None = None
    open_interest: float | None = None
    volume_usd: float | None = None
    right: dict | None = None


class PerpSnapshot(BaseModel):
    rows: list[MarketRow]
    fetched_at: datetime
    errors: list[ApiError] = Field(default_factory=list)


class PerpSnapshotRequest(BaseModel):
    primary_source: str
    secondary_source: str


class FundingHistoryRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    left_symbol: str = Field(..., alias="leftSymbol")
    right_symbol: str | None = Field(None, alias="rightSymbol")
    days: int = 7
    left_funding_period_hours: float | None = Field(None, alias="leftFundingPeriodHours")
    right_funding_period_hours: float | None = Field(None, alias="rightFundingPeriodHours")
    left_source: str | None = Field(None, alias="leftSourceId")
    right_source: str | None = Field(None, alias="rightSourceId")


class FundingHistoryPoint(BaseModel):
    time: int
    left: float | None
    right: float | None
    spread: float | None


class FundingHistoryResponse(BaseModel):
    dataset: list[FundingHistoryPoint]


class FundingPredictionEntry(BaseModel):
    symbol: str
    display_name: str
    left_symbol: str
    right_symbol: str
    predicted_left_24h: float | None = None
    predicted_right_24h: float | None = None
    predicted_spread_24h: float
    average_left_hourly: float | None = None
    average_right_hourly: float | None = None
    average_spread_hourly: float
    total_decimal: float
    annualized_decimal: float
    sample_count: int
    direction: Literal["leftLong", "rightLong", "unknown"]


class FundingPredictionFailure(BaseModel):
    symbol: str
    reason: str


class FundingPredictionRequest(BaseModel):
    primary_source: str
    secondary_source: str
    volume_threshold: float = 0.0
    force_refresh: bool = False


class FundingPredictionResponse(BaseModel):
    entries: list[FundingPredictionEntry]
    failures: list[FundingPredictionFailure]
    fetched_at: datetime | None = None
    errors: list[ApiError] = Field(default_factory=list)


class ArbitrageAnnualizedEntry(BaseModel):
    symbol: str
    display_name: str
    left_symbol: str
    right_symbol: str
    total_decimal: float
    average_hourly_decimal: float
    annualized_decimal: float
    sample_count: int
    direction: Literal["leftLong", "rightLong", "unknown"]


class ArbitrageFailure(BaseModel):
    symbol: str
    reason: str


class ArbitrageSnapshotRequest(BaseModel):
    primary_source: str
    secondary_source: str
    volume_threshold: float = 0.0
    force_refresh: bool = False


class ArbitrageSnapshotResponse(BaseModel):
    entries: list[ArbitrageAnnualizedEntry]
    failures: list[ArbitrageFailure]
    fetched_at: datetime | None = None
    errors: list[ApiError] = Field(default_factory=list)
