from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from lighter import nonce_manager
from lighter.api.account_api import AccountApi
from lighter.signer_client import SignerClient
import websockets

from app.config import Settings
from app.models import (
    LighterBalanceSnapshot,
    LighterOrderRequest,
    LighterOrderResponse,
    LighterPositionBalance,
    OrderBookLevel,
    OrderBookSide,
    VenueOrderBook,
)


class LighterService:
    """
    Wraps the Lighter SignerClient to expose a coroutine for creating orders.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Optional[SignerClient] = None
        self._lock = asyncio.Lock()
        self._http_client: Optional[httpx.AsyncClient] = None
        self._market_cache: dict[str, int] = {}
        self._market_cache_lock = asyncio.Lock()
        self._ws_endpoint = self._build_ws_endpoint(settings.lighter_base_url)

    async def start(self) -> None:
        await self._ensure_client()

    async def stop(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def _ensure_client(self) -> SignerClient:
        if self._client is not None:
            return self._client

        async with self._lock:
            if self._client is not None:
                return self._client

            nonce_type = nonce_manager.NonceManagerType.OPTIMISTIC
            if self._settings.lighter_nonce_manager.lower() == "api":
                nonce_type = nonce_manager.NonceManagerType.API

            api_private_keys = {
                self._settings.lighter_api_key_index: self._settings.lighter_private_key,
            }

            client = SignerClient(
                url=self._settings.lighter_base_url,
                private_key=self._settings.lighter_private_key,
                api_key_index=self._settings.lighter_api_key_index,
                account_index=self._settings.lighter_account_index,
                max_api_key_index=self._settings.lighter_max_api_key_index or -1,
                private_keys=api_private_keys,
                nonce_management_type=nonce_type,
            )

            err = client.check_client()
            if err is not None:
                raise RuntimeError(f"Lighter API key validation failed: {err}")
            self._client = client

        return self._client

    async def place_order(self, request: LighterOrderRequest) -> LighterOrderResponse:
        client = await self._ensure_client()

        if request.order_type == "market":
            payload, tx_hash, err = await client.create_market_order(
                market_index=request.market_index,
                client_order_index=request.client_order_index,
                base_amount=request.base_amount,
                avg_execution_price=request.avg_execution_price,  # type: ignore[arg-type]
                is_ask=request.is_ask,
                reduce_only=request.reduce_only,
                nonce=request.nonce or -1,
                api_key_index=request.api_key_index or -1,
            )
        else:
            time_in_force = {
                "ioc": SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
                "gtc": SignerClient.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME,
                "post_only": SignerClient.ORDER_TIME_IN_FORCE_POST_ONLY,
            }[request.time_in_force]

            payload, tx_hash, err = await client.create_order(
                market_index=request.market_index,
                client_order_index=request.client_order_index,
                base_amount=request.base_amount,
                price=request.price,  # type: ignore[arg-type]
                is_ask=request.is_ask,
                order_type=SignerClient.ORDER_TYPE_LIMIT,
                time_in_force=time_in_force,
                reduce_only=request.reduce_only,
                trigger_price=request.trigger_price or SignerClient.NIL_TRIGGER_PRICE,
                order_expiry=request.order_expiry_secs or SignerClient.DEFAULT_28_DAY_ORDER_EXPIRY,
                nonce=request.nonce or -1,
                api_key_index=request.api_key_index or -1,
            )

        if err is not None:
            raise RuntimeError(f"Lighter create order failed: {err}")

        payload_dict = json.loads(payload.to_json()) if payload is not None else {}
        tx_hash_value = tx_hash.tx_hash if tx_hash is not None else ""

        return LighterOrderResponse(
            tx_hash=tx_hash_value,
            payload=payload_dict,
        )

    async def get_balances(self) -> LighterBalanceSnapshot:
        client = await self._ensure_client()
        account_api = AccountApi(client.api_client)
        account_response = await account_api.account(
            by="index", value=str(self._settings.lighter_account_index)
        )

        if not account_response.accounts:
            raise RuntimeError("Lighter account response did not include any accounts")

        account = account_response.accounts[0]
        positions = [
            LighterPositionBalance(
                market_id=position.market_id,
                symbol=position.symbol,
                sign=position.sign,
                position=self._to_float(position.position),
                avg_entry_price=self._to_float(position.avg_entry_price),
                position_value=self._to_float(position.position_value),
                unrealized_pnl=self._to_float(position.unrealized_pnl),
                realized_pnl=self._to_float(position.realized_pnl),
                allocated_margin=self._to_float(position.allocated_margin),
            )
            for position in (account.positions or [])
        ]

        return LighterBalanceSnapshot(
            account_index=account.account_index,
            available_balance=self._to_float(account.available_balance),
            collateral=self._to_float(account.collateral),
            total_asset_value=self._to_float(account.total_asset_value),
            cross_asset_value=self._to_float(account.cross_asset_value),
            positions=positions,
        )

    async def stream_orderbook(
        self,
        symbol: str,
        depth: int,
    ) -> AsyncIterator[VenueOrderBook]:
        """
        Connect to the public Lighter websocket and yield merged order book states.
        """

        market_id = await self._get_market_id(symbol)
        normalized_symbol = symbol.strip().upper()
        backoff = 1.0

        while True:
            try:
                async for snapshot in self._run_lighter_ws_loop(
                    market_id=market_id,
                    normalized_symbol=normalized_symbol,
                    depth=depth,
                ):
                    backoff = 1.0
                    yield snapshot
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logging.warning("Lighter order book stream error: %s", exc)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    @property
    def is_ready(self) -> bool:
        return self._client is not None

    @staticmethod
    def _to_float(value: Optional[str]) -> float:
        if value is None:
            return 0.0
        return float(Decimal(value))

    async def _run_lighter_ws_loop(
        self,
        market_id: int,
        normalized_symbol: str,
        depth: int,
    ) -> AsyncIterator[VenueOrderBook]:
        order_book_state: dict[str, list[dict[str, str]]] = {"asks": [], "bids": []}
        ws_url = self._ws_endpoint

        async with websockets.connect(
            ws_url,
            ping_interval=20,
            ping_timeout=20,
        ) as ws:
            await ws.send(json.dumps({"type": "subscribe", "channel": f"order_book/{market_id}"}))

            async for raw_message in ws:
                data = json.loads(raw_message)
                message_type = data.get("type")
                if message_type not in {"subscribed/order_book", "update/order_book"}:
                    continue

                order_book = data.get("order_book")
                if not order_book:
                    continue

                if message_type == "subscribed/order_book":
                    order_book_state = {
                        "asks": list(order_book.get("asks", [])),
                        "bids": list(order_book.get("bids", [])),
                    }
                else:
                    self._apply_lighter_updates(order_book_state, order_book)

                timestamp = self._parse_timestamp(data.get("timestamp"))
                yield self._build_lighter_orderbook(
                    normalized_symbol=normalized_symbol,
                    state=order_book_state,
                    depth=depth,
                    timestamp=timestamp,
                )

    def _apply_lighter_updates(
        self,
        order_book_state: dict[str, list[dict[str, str]]],
        updates: dict[str, Any],
    ) -> None:
        for side in ("asks", "bids"):
            if side not in updates:
                continue
            existing = order_book_state.setdefault(side, [])
            for new_order in updates[side]:
                price = str(new_order.get("price"))
                size = str(new_order.get("size"))
                matched = False
                for entry in existing:
                    if entry.get("price") == price:
                        entry["size"] = size
                        matched = True
                        break
                if not matched and self._parse_decimal(size) > 0:
                    existing.append({"price": price, "size": size})

            reverse = side == "bids"
            existing[:] = [
                entry for entry in existing if self._parse_decimal(entry.get("size")) > 0
            ]
            existing.sort(key=lambda item: self._parse_decimal(item.get("price")), reverse=reverse)

    def _build_lighter_orderbook(
        self,
        normalized_symbol: str,
        state: dict[str, list[dict[str, str]]],
        depth: int,
        timestamp: float,
    ) -> VenueOrderBook:
        bids = self._build_lighter_side(state.get("bids", []), depth, reverse=True)
        asks = self._build_lighter_side(state.get("asks", []), depth, reverse=False)
        return VenueOrderBook(
            venue="lighter",
            symbol=normalized_symbol,
            bids=bids,
            asks=asks,
            timestamp=timestamp,
        )

    def _build_lighter_side(
        self,
        raw_levels: list[dict[str, str]],
        depth: int,
        reverse: bool,
    ) -> OrderBookSide:
        levels: list[OrderBookLevel] = []
        cumulative = 0.0

        ordered = sorted(
            raw_levels,
            key=lambda entry: self._parse_decimal(entry.get("price")),
            reverse=reverse,
        )[:depth]

        for entry in ordered:
            price = self._parse_decimal(entry.get("price"))
            size = self._parse_decimal(entry.get("size"))
            if price <= 0 or size <= 0:
                continue
            cumulative += size
            levels.append(OrderBookLevel(price=float(price), size=float(size), total=float(cumulative)))

        return OrderBookSide(levels=levels)

    async def _get_market_id(self, symbol: str) -> int:
        normalized = symbol.strip().upper()
        async with self._market_cache_lock:
            if normalized in self._market_cache:
                return self._market_cache[normalized]

            await self._refresh_market_cache()
            if normalized not in self._market_cache:
                raise ValueError(f"Lighter market not found for symbol {normalized}")
            return self._market_cache[normalized]

    async def _refresh_market_cache(self) -> None:
        http_client = await self._get_http_client()
        response = await http_client.get(f"{self._settings.lighter_base_url.rstrip('/')}/api/v1/orderBooks")
        response.raise_for_status()
        payload = response.json()
        order_books = payload.get("order_books", [])
        for entry in order_books:
            symbol = str(entry.get("symbol", "")).strip().upper()
            market_id = entry.get("market_id")
            if not symbol or market_id is None:
                continue
            try:
                self._market_cache[symbol] = int(market_id)
            except (TypeError, ValueError):
                continue

    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=5.0)
        return self._http_client

    @staticmethod
    def _build_ws_endpoint(base_url: str) -> str:
        parsed = urlparse(base_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        netloc = parsed.netloc or parsed.path
        return f"{scheme}://{netloc}/stream"

    @staticmethod
    def _parse_decimal(value: Optional[str]) -> Decimal:
        if value is None:
            return Decimal(0)
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError):
            return Decimal(0)

    @staticmethod
    def _parse_timestamp(value: Any) -> float:
        if value is None:
            return time.time()
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return time.time()
        return numeric / 1000 if numeric > 1e11 else numeric
