from __future__ import annotations

import asyncio
from typing import Optional

from anchorpy.provider import Wallet
from driftpy.constants.numeric_constants import BASE_PRECISION, PRICE_PRECISION
from driftpy.drift_client import DriftClient
from driftpy.keypair import load_keypair
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
from app.models import DriftOrderRequest, DriftOrderResponse


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
