from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_UP
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
    LighterLeverageRequest,
    LighterLeverageResponse,
    LighterPositionBalance,
    LighterSymbolOrderRequest,
    OrderBookLevel,
    OrderBookSide,
    TradeEntry,
    VenueOrderBook,
)


@dataclass(frozen=True)
class LighterMarketMeta:
    min_base_amount: Decimal
    min_quote_amount: Decimal
    size_decimals: int
    price_decimals: int


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
        self._market_meta_cache: dict[str, LighterMarketMeta] = {}
        self._market_cache_lock = asyncio.Lock()
        self._ws_endpoint = self._build_ws_endpoint(settings.lighter_base_url)
        self._logger = logging.getLogger(__name__)

    async def start(self) -> None:
        return

    async def stop(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def _ensure_client(self) -> SignerClient:
        raise RuntimeError("Global Lighter credentials are disabled; use per-user credentials")

    async def place_order(self, request: LighterOrderRequest) -> LighterOrderResponse:
        raise RuntimeError("Global Lighter credentials are disabled; use per-user credentials")

    async def place_order_by_symbol(self, request: LighterSymbolOrderRequest) -> LighterOrderResponse:
        raise RuntimeError("Global Lighter credentials are disabled; use per-user credentials")

    async def place_order_by_symbol_with_credentials(
        self,
        request: LighterSymbolOrderRequest,
        account_index: int,
        api_key_index: int,
        private_key: str,
    ) -> LighterOrderResponse:
        market_index = await self._get_market_id(request.symbol)
        meta = await self._get_market_meta(request.symbol)

        base_amount_value = self._quantize_amount(Decimal(str(request.base_amount)), meta.size_decimals, ROUND_DOWN)
        price_rounding = ROUND_DOWN if request.side == "buy" else ROUND_UP
        price_value = self._quantize_amount(Decimal(str(request.price)), meta.price_decimals, price_rounding)

        if base_amount_value <= 0 or price_value <= 0:
            raise ValueError("Invalid base amount or price for Lighter order")

        if meta.min_base_amount > 0 and base_amount_value < meta.min_base_amount:
            raise ValueError(
                f"Lighter base amount below minimum ({base_amount_value} < {meta.min_base_amount})"
            )

        quote_amount = base_amount_value * price_value
        if meta.min_quote_amount > 0 and quote_amount < meta.min_quote_amount:
            raise ValueError(
                f"Lighter quote amount below minimum ({quote_amount} < {meta.min_quote_amount})"
            )

        base_multiplier = Decimal(1).scaleb(meta.size_decimals)
        base_amount = int((base_amount_value * base_multiplier).to_integral_value(rounding=ROUND_DOWN))
        price_multiplier = Decimal(1).scaleb(meta.price_decimals)
        price = int((price_value * price_multiplier).to_integral_value(rounding=price_rounding))
        if base_amount <= 0 or price <= 0:
            raise ValueError("Invalid base amount or price for Lighter order")

        self._logger.info(
            "lighter order sizing symbol=%s market_index=%s base=%s price=%s size_decimals=%s price_decimals=%s "
            "base_value=%s price_value=%s base_amount_int=%s price_int=%s quote_value=%s",
            request.symbol,
            market_index,
            request.base_amount,
            request.price,
            meta.size_decimals,
            meta.price_decimals,
            base_amount_value,
            price_value,
            base_amount,
            price,
            quote_amount,
        )

        client = await self._build_client_for_credentials(account_index, api_key_index, private_key)
        try:
            time_in_force = {
                "ioc": SignerClient.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL,
                "gtc": SignerClient.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME,
                "post_only": SignerClient.ORDER_TIME_IN_FORCE_POST_ONLY,
            }[request.time_in_force]
            effective_api_key_index = request.api_key_index if request.api_key_index is not None else api_key_index

            payload, tx_hash, err = await client.create_order(
                market_index=market_index,
                client_order_index=request.client_order_index,
                base_amount=base_amount,
                price=price,
                is_ask=request.side == "sell",
                order_type=SignerClient.ORDER_TYPE_LIMIT,
                time_in_force=time_in_force,
                reduce_only=request.reduce_only,
                trigger_price=request.trigger_price or SignerClient.NIL_TRIGGER_PRICE,
                order_expiry=request.order_expiry_secs or SignerClient.DEFAULT_28_DAY_ORDER_EXPIRY,
                nonce=request.nonce if request.nonce is not None else SignerClient.DEFAULT_NONCE,
                api_key_index=effective_api_key_index,
            )
            if err is not None:
                raise RuntimeError(f"Lighter create order failed: {err}")

            payload_dict = json.loads(payload.to_json()) if payload is not None else {}
            tx_hash_value = tx_hash.tx_hash if tx_hash is not None else ""
            return LighterOrderResponse(
                tx_hash=tx_hash_value,
                payload=payload_dict,
            )
        finally:
            await client.close()

    async def place_order_with_credentials(
        self,
        request: LighterOrderRequest,
        account_index: int,
        api_key_index: int,
        private_key: str,
    ) -> LighterOrderResponse:
        client = await self._build_client_for_credentials(account_index, api_key_index, private_key)
        try:
            if request.order_type == "market":
                payload, tx_hash, err = await client.create_market_order(
                    market_index=request.market_index,
                    client_order_index=request.client_order_index,
                    base_amount=request.base_amount,
                    avg_execution_price=request.avg_execution_price,  # type: ignore[arg-type]
                    is_ask=request.is_ask,
                    reduce_only=request.reduce_only,
                    nonce=request.nonce if request.nonce is not None else SignerClient.DEFAULT_NONCE,
                    api_key_index=request.api_key_index if request.api_key_index is not None else api_key_index,
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
                    nonce=request.nonce if request.nonce is not None else SignerClient.DEFAULT_NONCE,
                    api_key_index=request.api_key_index if request.api_key_index is not None else api_key_index,
                )

            if err is not None:
                raise RuntimeError(f"Lighter create order failed: {err}")

            payload_dict = json.loads(payload.to_json()) if payload is not None else {}
            tx_hash_value = tx_hash.tx_hash if tx_hash is not None else ""

            return LighterOrderResponse(
                tx_hash=tx_hash_value,
                payload=payload_dict,
            )
        finally:
            await client.close()

    async def update_leverage_by_symbol(self, request: LighterLeverageRequest) -> LighterLeverageResponse:
        raise RuntimeError("Global Lighter credentials are disabled; use per-user credentials")

    async def update_leverage_by_symbol_with_credentials(
        self,
        request: LighterLeverageRequest,
        account_index: int,
        api_key_index: int,
        private_key: str,
    ) -> LighterLeverageResponse:
        if request.leverage <= 0:
            raise ValueError("Invalid leverage for Lighter")

        client = await self._build_client_for_credentials(account_index, api_key_index, private_key)
        try:
            market_index = await self._get_market_id(request.symbol)
            margin_mode = (
                SignerClient.CROSS_MARGIN_MODE
                if request.margin_mode == "cross"
                else SignerClient.ISOLATED_MARGIN_MODE
            )

            payload, response, err = await client.update_leverage(
                market_index=market_index,
                margin_mode=margin_mode,
                leverage=request.leverage,
                nonce=request.nonce if request.nonce is not None else SignerClient.DEFAULT_NONCE,
                api_key_index=request.api_key_index if request.api_key_index is not None else api_key_index,
            )
            if err is not None:
                raise RuntimeError(f"Lighter update leverage failed: {err}")

            payload_dict: dict[str, Any]
            if isinstance(payload, str):
                try:
                    payload_dict = json.loads(payload)
                except json.JSONDecodeError:
                    payload_dict = {"payload": payload}
            else:
                payload_dict = payload.to_json() if payload is not None else {}
                if isinstance(payload_dict, str):
                    try:
                        payload_dict = json.loads(payload_dict)
                    except json.JSONDecodeError:
                        payload_dict = {"payload": payload_dict}

            response_dict: dict[str, Any]
            if isinstance(response, dict):
                response_dict = response
            else:
                response_dict = {"response": str(response)} if response is not None else {}

            return LighterLeverageResponse(payload=payload_dict, response=response_dict)
        finally:
            await client.close()

    async def get_balances(self) -> LighterBalanceSnapshot:
        raise RuntimeError("Global Lighter credentials are disabled; use per-user credentials")

    async def get_balances_with_credentials(
        self,
        account_index: int,
        api_key_index: int,
        private_key: str,
    ) -> LighterBalanceSnapshot:
        client = await self._build_client_for_credentials(account_index, api_key_index, private_key)
        try:
            account_api = AccountApi(client.api_client)
            account_response = await account_api.account(
                by="index", value=str(account_index)
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
        finally:
            await client.close()

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
        return True

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
            # Wait for server handshake before subscribing (mirrors lighter-python client)
            try:
                first_msg = await ws.recv()
                data = json.loads(first_msg)
                if data.get("type") == "connected":
                    await ws.send(json.dumps({"type": "subscribe", "channel": f"order_book/{market_id}"}))
                else:
                    # Fallback: still attempt subscription if handshake is unexpected
                    await ws.send(json.dumps({"type": "subscribe", "channel": f"order_book/{market_id}"}))
            except Exception:
                await ws.send(json.dumps({"type": "subscribe", "channel": f"order_book/{market_id}"}))

            async for raw_message in ws:
                data = json.loads(raw_message)
                message_type = data.get("type")
                if message_type == "ping":
                    await ws.send(json.dumps({"type": "pong"}))
                    continue

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
                    self._apply_lighter_updates(order_book_state, order_book, depth)

                timestamp = self._parse_timestamp(data.get("timestamp"))
                yield self._build_lighter_orderbook(
                    normalized_symbol=normalized_symbol,
                    state=order_book_state,
                    depth=depth,
                    timestamp=timestamp,
                )

    async def stream_trades(self, symbol: str, limit: int = 50) -> AsyncIterator[list[TradeEntry]]:
        market_id = await self._get_market_id(symbol)
        normalized_symbol = symbol.strip().upper()
        ws_url = self._ws_endpoint
        backoff = 1.0

        while True:
            try:
                async with websockets.connect(
                    ws_url,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    try:
                        first_msg = await ws.recv()
                        data = json.loads(first_msg)
                        if data.get("type") == "connected":
                            await ws.send(json.dumps({"type": "subscribe", "channel": f"trade/{market_id}", "limit": limit}))
                        else:
                            await ws.send(json.dumps({"type": "subscribe", "channel": f"trade/{market_id}", "limit": limit}))
                    except Exception:
                        await ws.send(json.dumps({"type": "subscribe", "channel": f"trade/{market_id}", "limit": limit}))

                    async for raw_message in ws:
                        data = json.loads(raw_message)
                        message_type = data.get("type")
                        if message_type == "ping":
                            await ws.send(json.dumps({"type": "pong"}))
                            continue
                        # trade channel returns types like subscribed/trade, update/trade, or others with trade payloads
                        if "trade" not in (message_type or ""):
                            continue
                        trades_payload = data.get("trades") or data.get("trade") or data.get("liquidation_trades")
                        trades: list[TradeEntry] = []
                        if isinstance(trades_payload, list):
                            for entry in trades_payload:
                                parsed = self._parse_trade_entry(entry, normalized_symbol)
                                if parsed:
                                    trades.append(parsed)
                        elif isinstance(trades_payload, dict):
                            parsed = self._parse_trade_entry(trades_payload, normalized_symbol)
                            if parsed:
                                trades.append(parsed)
                        if trades:
                            yield trades
                    backoff = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logging.warning("Lighter trades stream error: %s", exc)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    def _apply_lighter_updates(
        self,
        order_book_state: dict[str, list[dict[str, str]]],
        updates: dict[str, Any],
        depth_limit: int,
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
            if len(existing) > depth_limit * 3:
                del existing[depth_limit * 3 :]

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
            cumulative += float(size)  # Convert Decimal to float before adding
            levels.append(OrderBookLevel(price=float(price), size=float(size), total=cumulative))

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

    async def _get_market_meta(self, symbol: str) -> "LighterMarketMeta":
        normalized = symbol.strip().upper()
        async with self._market_cache_lock:
            if normalized in self._market_meta_cache:
                return self._market_meta_cache[normalized]

            await self._refresh_market_cache()
            if normalized not in self._market_meta_cache:
                raise ValueError(f"Lighter market metadata not found for symbol {normalized}")
            return self._market_meta_cache[normalized]

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
            self._market_meta_cache[symbol] = LighterMarketMeta(
                min_base_amount=self._parse_decimal(entry.get("min_base_amount")),
                min_quote_amount=self._parse_decimal(entry.get("min_quote_amount")),
                size_decimals=self._parse_int(entry.get("supported_size_decimals")),
                price_decimals=self._parse_int(entry.get("supported_price_decimals")),
            )

    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=5.0)
        return self._http_client

    async def _build_client_for_credentials(
        self,
        account_index: int,
        api_key_index: int,
        private_key: str,
    ) -> SignerClient:
        nonce_type = nonce_manager.NonceManagerType.OPTIMISTIC
        if self._settings.lighter_nonce_manager.lower() == "api":
            nonce_type = nonce_manager.NonceManagerType.API

        client = SignerClient(
            url=self._settings.lighter_base_url,
            account_index=account_index,
            api_private_keys={api_key_index: private_key},
            nonce_management_type=nonce_type,
        )
        err = client.check_client()
        if err is not None:
            raise RuntimeError(f"Lighter API key validation failed: {err}")
        return client

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
    def _parse_int(value: Any) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _quantize_amount(value: Decimal, decimals: int, rounding: str) -> Decimal:
        if decimals <= 0:
            return value.to_integral_value(rounding=rounding)
        quant = Decimal(1).scaleb(-decimals)
        return value.quantize(quant, rounding=rounding)

    def _parse_trade_entry(self, entry: dict[str, Any], symbol: str) -> TradeEntry | None:
        try:
            price = float(self._parse_decimal(entry.get("price")))
            size = float(self._parse_decimal(entry.get("size")))
        except Exception:
            return None
        if price <= 0 or size <= 0:
            return None
        is_buy = bool(entry.get("is_buy") or entry.get("is_buyer"))
        if not is_buy and "is_maker_ask" in entry:
            is_buy = not bool(entry.get("is_maker_ask"))
        timestamp_raw = entry.get("timestamp") or entry.get("event_time")
        try:
            ts_float = float(timestamp_raw) / 1000.0 if timestamp_raw else 0.0
        except Exception:
            ts_float = 0.0
        return TradeEntry(
            venue="lighter",
            symbol=symbol,
            price=price,
            size=size,
            is_buy=is_buy,
            timestamp=ts_float,
        )

    @staticmethod
    def _parse_timestamp(value: Any) -> float:
        if value is None:
            return time.time()
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return time.time()
        return numeric / 1000 if numeric > 1e11 else numeric
