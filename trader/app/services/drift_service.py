from __future__ import annotations

import asyncio
from typing import Optional

from anchorpy.provider import Wallet
from driftpy.constants.numeric_constants import BASE_PRECISION, PRICE_PRECISION, QUOTE_PRECISION
from driftpy.drift_client import DriftClient
from driftpy.decode.utils import decode_name
from driftpy.keypair import load_keypair
from driftpy.math.perp_position import is_available as is_perp_position_available
from driftpy.math.spot_position import is_spot_position_available
from driftpy.types import (
    MarketType,
    OrderParams,
    OrderParamsBitFlag,
    OrderTriggerCondition,
    OrderType,
    PositionDirection,
    PostOnlyParams,
)
from solana.rpc.async_api import AsyncClient

from app.config import Settings
from app.models import (
    DriftBalanceSnapshot,
    DriftOrderRequest,
    DriftOrderResponse,
    DriftPerpBalance,
    DriftSpotBalance,
)


class DriftService:
    """
    Thin wrapper around DriftClient that exposes a single place_order helper.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._connection: Optional[AsyncClient] = None
        self._client: Optional[DriftClient] = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        await self._ensure_client()

    async def stop(self) -> None:
        if self._client is not None:
            await self._client.unsubscribe()
            self._client = None
        if self._connection is not None:
            await self._connection.close()
            self._connection = None

    async def _ensure_client(self) -> DriftClient:
        if self._client is not None:
            return self._client

        async with self._lock:
            if self._client is not None:
                return self._client

            connection = AsyncClient(self._settings.drift_rpc_url)
            wallet = Wallet(load_keypair(self._settings.drift_private_key))

            self._connection = connection
            try:
                self._client = DriftClient(
                    connection=connection,
                    wallet=wallet,
                    env=self._settings.drift_env,
                )
                await self._client.subscribe()
            except Exception:
                await connection.close()
                self._connection = None
                self._client = None
                raise

        return self._client

    async def place_order(self, request: DriftOrderRequest) -> DriftOrderResponse:
        client = await self._ensure_client()
        params = self._build_order_params(request)

        if request.market_type == "perp":
            signature = await client.place_perp_order(params, sub_account_id=self._settings.drift_sub_account_id)
        else:
            signature = await client.place_spot_order(params, sub_account_id=self._settings.drift_sub_account_id)

        return DriftOrderResponse(
            tx_signature=signature,
            market_index=request.market_index,
            market_type=request.market_type,
            direction=request.direction,
            order_type=request.order_type,
        )

    async def get_balances(self) -> DriftBalanceSnapshot:
        client = await self._ensure_client()
        user = client.get_user(self._settings.drift_sub_account_id)
        user_account = user.get_user_account()

        spot_positions: list[DriftSpotBalance] = []
        for position in user_account.spot_positions:
            if is_spot_position_available(position):
                continue

            spot_market = client.get_spot_market_account(position.market_index)
            if spot_market is None:
                continue

            raw_amount = user.get_token_amount(position.market_index)
            decimals = getattr(spot_market, "decimals", 0)
            divisor = 10**decimals if decimals > 0 else 1
            amount = raw_amount / divisor
            balance_type_value = position.balance_type.__class__.__name__.lower()
            balance_type = "deposit" if "deposit" in balance_type_value else "borrow"
            market_name = decode_name(spot_market.name).strip("\x00")

            spot_positions.append(
                DriftSpotBalance(
                    market_index=position.market_index,
                    market_name=market_name,
                    balance_type=balance_type,
                    amount=amount,
                    raw_amount=raw_amount,
                    decimals=decimals,
                )
            )

        perp_positions: list[DriftPerpBalance] = []
        for position in user_account.perp_positions:
            if is_perp_position_available(position):
                continue

            perp_market = client.get_perp_market_account(position.market_index)
            if perp_market is None:
                continue

            market_name = decode_name(perp_market.name).strip("\x00")
            base_raw = position.base_asset_amount
            quote_raw = position.quote_break_even_amount

            perp_positions.append(
                DriftPerpBalance(
                    market_index=position.market_index,
                    market_name=market_name,
                    base_asset_amount=base_raw / BASE_PRECISION,
                    raw_base_asset_amount=base_raw,
                    quote_break_even_amount=quote_raw / QUOTE_PRECISION,
                    raw_quote_break_even_amount=quote_raw,
                )
            )

        return DriftBalanceSnapshot(
            sub_account_id=self._settings.drift_sub_account_id,
            spot_positions=spot_positions,
            perp_positions=perp_positions,
        )

    def _build_order_params(self, request: DriftOrderRequest) -> OrderParams:
        order_type = {
            "market": OrderType.Market,
            "limit": OrderType.Limit,
            "trigger_market": OrderType.TriggerMarket,
            "trigger_limit": OrderType.TriggerLimit,
            "oracle": OrderType.Oracle,
        }[request.order_type]()

        trigger_condition = {
            "above": OrderTriggerCondition.Above,
            "below": OrderTriggerCondition.Below,
            "triggered_above": OrderTriggerCondition.TriggeredAbove,
            "triggered_below": OrderTriggerCondition.TriggeredBelow,
        }[request.trigger_condition]()

        post_only = {
            "none": PostOnlyParams.NONE,
            "must": PostOnlyParams.MustPostOnly,
            "try": PostOnlyParams.TryPostOnly,
            "slide": PostOnlyParams.Slide,
        }[request.post_only]()

        price = self._to_price_precision(request.price)
        trigger_price = self._to_price_precision(request.trigger_price)
        oracle_offset = self._to_price_precision(request.oracle_price_offset)
        auction_start = self._to_price_precision(request.auction_start_price)
        auction_end = self._to_price_precision(request.auction_end_price)

        params = OrderParams(
            order_type=order_type,
            market_index=request.market_index,
            base_asset_amount=self._to_base_precision(request.base_amount),
            direction=PositionDirection.Long() if request.direction == "long" else PositionDirection.Short(),
            market_type=MarketType.Perp() if request.market_type == "perp" else MarketType.Spot(),
            price=price or 0,
            user_order_id=request.user_order_id,
            reduce_only=request.reduce_only,
            post_only=post_only,
            trigger_price=trigger_price,
            trigger_condition=trigger_condition,
            oracle_price_offset=oracle_offset,
            max_ts=request.max_ts,
            auction_duration=request.auction_duration,
            auction_start_price=auction_start,
            auction_end_price=auction_end,
        )

        bit_flags = 0
        if request.immediate_or_cancel:
            bit_flags |= OrderParamsBitFlag.IMMEDIATE_OR_CANCEL
        params.bit_flags = bit_flags

        return params

    @property
    def is_ready(self) -> bool:
        return self._client is not None

    @staticmethod
    def _to_base_precision(value: float) -> int:
        return int(value * BASE_PRECISION)

    @staticmethod
    def _to_price_precision(value: Optional[float]) -> Optional[int]:
        if value is None:
            return None
        return int(value * PRICE_PRECISION)
