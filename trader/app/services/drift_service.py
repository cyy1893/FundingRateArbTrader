from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

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
    is_variant,
)
from solana.rpc.async_api import AsyncClient

import httpx

from app.config import Settings
from app.models import (
    DriftBalanceSnapshot,
    DriftOrderRequest,
    DriftOrderResponse,
    DriftPerpBalance,
    DriftSpotBalance,
    OrderBookLevel,
    OrderBookSide,
    VenueOrderBook,
)

import websockets


class DriftService:
    """
    Thin wrapper around DriftClient that exposes a single place_order helper.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._connection: Optional[AsyncClient] = None
        self._client: Optional[DriftClient] = None
        self._lock = asyncio.Lock()
        self._http_client: Optional[httpx.AsyncClient] = None
        self._dlob_url = settings.drift_dlob_url.rstrip("/")
        self._dlob_ws_url = self._build_dlob_ws_url(settings)

    async def start(self) -> None:
        await self._ensure_client()

    async def stop(self) -> None:
        if self._client is not None:
            await self._client.unsubscribe()
            self._client = None
        if self._connection is not None:
            await self._connection.close()
            self._connection = None
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

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

    async def stream_orderbook(
        self,
        symbol: str,
        depth: int,
    ) -> AsyncIterator[VenueOrderBook]:
        """
        Stream normalized order book snapshots from the Drift DLOB websocket.
        """

        backoff = 1.0
        while True:
            try:
                async for snapshot in self._stream_orderbook_ws(symbol, depth):
                    backoff = 1.0
                    yield snapshot
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logging.warning("Failed to refresh Drift order book via websocket: %s", exc)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    async def _stream_orderbook_ws(self, symbol: str, depth: int) -> AsyncIterator[VenueOrderBook]:
        market_name = self._normalize_symbol(symbol)
        ws_url = self._dlob_ws_url
        subscribe_payload = {
            "type": "subscribe",
            "marketType": "perp",
            "channel": "orderbook",
            "market": market_name,
        }

        async with websockets.connect(ws_url, ping_interval=20, ping_timeout=20) as ws:
            await ws.send(json.dumps(subscribe_payload))
            async for raw_message in ws:
                message = json.loads(raw_message)

                # DLOB server may send pings or unrelated messages
                msg_type = message.get("type")
                if msg_type == "ping":
                    await ws.send(json.dumps({"type": "pong"}))
                    continue

                payload = self._extract_orderbook_payload(message, market_name)
                if payload is None:
                    continue

                snapshot = self._build_drift_orderbook(payload, depth, symbol)
                yield snapshot

    def _extract_orderbook_payload(self, message: dict[str, Any], market_name: str) -> Optional[dict[str, Any]]:
        """
        Normalize DLOB websocket responses across legacy and current formats.

        Legacy shape:
        {"channel": "orderbook", "market": "SOL-PERP", "bids": [...], "asks": [...]}

        Current shape:
        {"channel": "orderbook_perp_0_grouped_1", "data": "{\"bids\": [...], \"asks\": [...], \"marketName\": \"SOL-PERP\"}"}
        """
        # Legacy envelope
        if message.get("channel") == "orderbook":
            if message.get("market") == market_name:
                return message
            return None

        channel = message.get("channel")
        if not channel or "orderbook" not in str(channel):
            return None

        data = message.get("data")
        if data is None:
            return None

        if isinstance(data, str):
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                return None
        elif isinstance(data, dict):
            payload = data
        else:
            return None

        payload_market = payload.get("marketName") or payload.get("market")
        if payload_market and payload_market != market_name:
            return None

        return payload

    async def get_orderbook_snapshot(self, symbol: str, depth: int) -> VenueOrderBook:
        client = await self._ensure_client()
        market_name = self._normalize_symbol(symbol)
        market_info = client.get_market_index_and_type(market_name)
        if market_info is None:
            raise ValueError(f"Unknown Drift market: {market_name}")

        market_index, market_type = market_info
        if not is_variant(market_type, "Perp"):
            raise ValueError("Only perp markets are supported for order book streaming")

        http_client = await self._get_http_client()
        response = await http_client.get(
            f"{self._dlob_url}/l2",
            params={"marketType": "perp", "marketIndex": market_index},
        )
        response.raise_for_status()
        payload = response.json()
        return self._build_drift_orderbook(payload, depth, symbol)

    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=5.0)
        return self._http_client

    @staticmethod
    def _build_dlob_ws_url(settings: Settings) -> str:
        if settings.drift_env == "devnet":
            return "wss://master.dlob.drift.trade/ws"
        if settings.drift_env == "mainnet":
            return "wss://dlob.drift.trade/ws"

        parsed = urlparse(settings.drift_dlob_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        path = parsed.path if parsed.path.endswith("/ws") else f"{parsed.path.rstrip('/')}/ws"
        netloc = parsed.netloc or parsed.path
        return f"{scheme}://{netloc}{path}"

    @staticmethod
    def _normalize_symbol(symbol: str) -> str:
        normalized = symbol.strip().upper()
        return normalized if normalized.endswith("-PERP") else f"{normalized}-PERP"

    def _build_drift_orderbook(self, payload: dict[str, Any], depth: int, requested_symbol: str) -> VenueOrderBook:
        bids = self._build_drift_side(payload.get("bids", []), depth)
        asks = self._build_drift_side(payload.get("asks", []), depth)
        ts_value = payload.get("ts") or payload.get("timestamp")
        timestamp = self._to_timestamp(ts_value)

        symbol = payload.get("marketName") or self._normalize_symbol(requested_symbol)
        return VenueOrderBook(
            venue="drift",
            symbol=str(symbol),
            bids=bids,
            asks=asks,
            timestamp=timestamp,
        )

    @staticmethod
    def _build_drift_side(levels: list[dict[str, Any]], depth: int) -> OrderBookSide:
        formatted_levels: list[OrderBookLevel] = []
        cumulative = 0.0
        for raw in levels[:depth]:
            try:
                price = float(int(str(raw.get("price", 0))) / PRICE_PRECISION)
            except (TypeError, ValueError):
                continue
            try:
                size = float(int(str(raw.get("size", 0))) / BASE_PRECISION)
            except (TypeError, ValueError):
                continue
            if size <= 0:
                continue
            cumulative += size
            formatted_levels.append(OrderBookLevel(price=price, size=size, total=cumulative))

        return OrderBookSide(levels=formatted_levels)

    @staticmethod
    def _to_timestamp(value: Any) -> float:
        if value is None:
            return datetime.now(tz=timezone.utc).timestamp()
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return datetime.now(tz=timezone.utc).timestamp()
        # DLOB timestamps are in ms
        return numeric / 1000 if numeric > 1e11 else numeric

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
