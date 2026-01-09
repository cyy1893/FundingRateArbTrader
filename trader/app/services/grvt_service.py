from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Any, Optional

import websockets

from pysdk.grvt_ccxt_env import GrvtEnv, GrvtWSEndpointType, get_grvt_ws_endpoint
from pysdk.grvt_ccxt_pro import GrvtCcxtPro

from app.config import Settings
from app.models import (
    GrvtAssetBalance,
    GrvtBalanceSnapshot,
    GrvtOrderRequest,
    GrvtOrderResponse,
    GrvtPositionBalance,
    OrderBookLevel,
    OrderBookSide,
    TradeEntry,
    VenueOrderBook,
)


class GrvtService:
    """
    Thin wrapper around the GRVT CCXT-style SDK to expose balance snapshots.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: GrvtCcxtPro | None = None
        self._lock = asyncio.Lock()
        self._client_cache: dict[tuple[str, str, str], GrvtCcxtPro] = {}
        self._client_cache_lock = asyncio.Lock()
        self._instrument_map: dict[str, str] = {}
        self._instrument_lock = asyncio.Lock()
        self._apply_env_overrides()

    async def start(self) -> None:
        return

    async def stop(self) -> None:
        if self._client is not None:
            session = getattr(self._client, "_session", None)
            if session is not None and not session.closed:
                await session.close()
            self._client = None
        if self._client_cache:
            for client in self._client_cache.values():
                session = getattr(client, "_session", None)
                if session is not None and not session.closed:
                    await session.close()
            self._client_cache = {}

    @property
    def is_ready(self) -> bool:
        return True

    async def get_balances(self) -> GrvtBalanceSnapshot:
        raise RuntimeError("Global GRVT credentials are disabled; use per-user credentials")

    async def get_balances_with_credentials(
        self,
        api_key: str,
        private_key: str,
        trading_account_id: str,
    ) -> GrvtBalanceSnapshot:
        client = await self._get_cached_client_for_credentials(api_key, private_key, trading_account_id)
        account_summary = await client.get_account_summary()
        if not account_summary:
            raise RuntimeError("GRVT account summary returned no data")

        return self._build_balance_snapshot(client, account_summary)

    async def stream_orderbook(self, symbol: str, depth: int) -> asyncio.AsyncIterator[VenueOrderBook]:
        """
        Stream GRVT order books over WebSocket (market data only).
        """
        raise RuntimeError("Global GRVT credentials are disabled; use per-user credentials")

    async def stream_orderbook_with_credentials(
        self,
        symbol: str,
        depth: int,
        api_key: str,
        private_key: str,
        trading_account_id: str,
    ) -> asyncio.AsyncIterator[VenueOrderBook]:
        client = await self._get_cached_client_for_credentials(api_key, private_key, trading_account_id)
        instrument = await self._get_instrument_with_client(client, symbol)
        await client.refresh_cookie()
        cookie = getattr(client, "_cookie", {}) or {}
        gravity = cookie.get("gravity")
        account_id = cookie.get("X-Grvt-Account-Id")
        headers = {}
        if gravity:
            headers["Cookie"] = f"gravity={gravity}"
        if account_id:
            headers["X-Grvt-Account-Id"] = account_id

        ws_url = get_grvt_ws_endpoint(self._settings.grvt_env, GrvtWSEndpointType.MARKET_DATA)
        version_prefix = self._settings.grvt_ws_stream_version
        stream = f"{version_prefix}.book.s" if version_prefix != "v0" else "book.s"
        rate_ms = 500
        selector = f"{instrument}@{rate_ms}-{depth}"
        subscribe_json = json.dumps(
            {
                "request_id": 1,
                "stream": stream,
                "feed": [selector],
                "method": "subscribe",
                "is_full": True,
            }
        )

        queue: asyncio.Queue[VenueOrderBook] = asyncio.Queue()
        ws_received = asyncio.Event()
        backoff = 0.5

        async def ws_loop() -> None:
            nonlocal backoff
            while True:
                try:
                    async with websockets.connect(ws_url, extra_headers=headers, open_timeout=5) as ws:
                        await ws.send(subscribe_json)
                        async for message in ws:
                            snapshot = self._parse_orderbook_message(json.loads(message), symbol)
                            if snapshot:
                                ws_received.set()
                                await queue.put(snapshot)
                                backoff = 0.5
                except asyncio.CancelledError:
                    raise
                except Exception:
                    backoff = min(backoff * 2, 5.0)
                    await asyncio.sleep(backoff)

        async def fallback_loop() -> None:
            while not ws_received.is_set():
                try:
                    raw = await client.fetch_order_book(instrument, limit=depth)
                    snapshot = self._parse_orderbook_message({"data": raw}, symbol)
                    if snapshot:
                        await queue.put(snapshot)
                except Exception:
                    pass
                await asyncio.sleep(rate_ms / 1000)

        ws_task = asyncio.create_task(ws_loop())
        fallback_task = asyncio.create_task(fallback_loop())

        try:
            while True:
                snapshot = await queue.get()
                yield snapshot
        finally:
            ws_task.cancel()
            fallback_task.cancel()
            await asyncio.gather(ws_task, fallback_task, return_exceptions=True)

    async def stream_trades(self, symbol: str, limit: int = 50) -> asyncio.AsyncIterator[list[TradeEntry]]:
        """
        Stream recent trades over WebSocket; falls back to HTTP if WS has not yielded yet.
        """
        raise RuntimeError("Global GRVT credentials are disabled; use per-user credentials")

    async def stream_trades_with_credentials(
        self,
        symbol: str,
        limit: int,
        api_key: str,
        private_key: str,
        trading_account_id: str,
    ) -> asyncio.AsyncIterator[list[TradeEntry]]:
        """
        Stream recent trades over WebSocket; falls back to HTTP if WS has not yielded yet.
        """

        client = await self._get_cached_client_for_credentials(api_key, private_key, trading_account_id)
        instrument = await self._get_instrument_with_client(client, symbol)
        await client.refresh_cookie()
        cookie = getattr(client, "_cookie", {}) or {}
        gravity = cookie.get("gravity")
        account_id = cookie.get("X-Grvt-Account-Id")
        headers = {}
        if gravity:
            headers["Cookie"] = f"gravity={gravity}"
        if account_id:
            headers["X-Grvt-Account-Id"] = account_id

        ws_url = get_grvt_ws_endpoint(self._settings.grvt_env, GrvtWSEndpointType.MARKET_DATA)
        version_prefix = self._settings.grvt_ws_stream_version
        stream = f"{version_prefix}.trade" if version_prefix != "v0" else "trade"
        selector = f"{instrument}@{limit}"
        subscribe_json = json.dumps(
            {
                "request_id": 2,
                "stream": stream,
                "feed": [selector],
                "method": "subscribe",
                "is_full": True,
            }
        )

        queue: asyncio.Queue[list[TradeEntry]] = asyncio.Queue()
        ws_received = asyncio.Event()
        backoff = 0.5

        async def ws_loop() -> None:
            nonlocal backoff
            while True:
                try:
                    async with websockets.connect(ws_url, extra_headers=headers, open_timeout=5) as ws:
                        await ws.send(subscribe_json)
                        async for message in ws:
                            trades = self._parse_trades_message(json.loads(message), symbol)
                            if trades:
                                ws_received.set()
                                await queue.put(trades)
                                backoff = 0.5
                except asyncio.CancelledError:
                    raise
                except Exception:
                    backoff = min(backoff * 2, 5.0)
                    await asyncio.sleep(backoff)

        async def fallback_loop() -> None:
            while not ws_received.is_set():
                try:
                    raw_trades = await client.fetch_recent_trades(instrument, limit=limit)
                    trades = self._parse_trades_message({"data": raw_trades}, symbol)
                    if trades:
                        await queue.put(trades)
                except Exception:
                    pass
                await asyncio.sleep(1.0)

        ws_task = asyncio.create_task(ws_loop())
        fallback_task = asyncio.create_task(fallback_loop())

        try:
            while True:
                trades = await queue.get()
                yield trades
        finally:
            ws_task.cancel()
            fallback_task.cancel()
            await asyncio.gather(ws_task, fallback_task, return_exceptions=True)

    async def place_order(self, request: GrvtOrderRequest) -> GrvtOrderResponse:
        raise RuntimeError("Global GRVT credentials are disabled; use per-user credentials")

    async def place_order_with_credentials(
        self,
        request: GrvtOrderRequest,
        api_key: str,
        private_key: str,
        trading_account_id: str,
    ) -> GrvtOrderResponse:
        client = await self._get_cached_client_for_credentials(api_key, private_key, trading_account_id)
        instrument = await self._get_instrument_with_client(client, request.symbol)
        market = (client.markets or {}).get(instrument, {})
        amount = self._normalize_amount(request.amount, market)
        price = self._normalize_price(request.price, market)
        params: dict[str, Any] = {
            "post_only": request.post_only,
            "reduce_only": request.reduce_only,
            "order_duration_secs": request.order_duration_secs,
            "time_in_force": "GOOD_TILL_TIME",
        }
        if request.client_order_id is not None:
            params["client_order_id"] = request.client_order_id

        response = await client.create_order(
            instrument,
            "limit",
            request.side,
            amount,
            price,
            params,
        )
        return GrvtOrderResponse(payload=response or {})

    async def _ensure_client(self) -> GrvtCcxtPro:
        raise RuntimeError("Global GRVT credentials are disabled; use per-user credentials")

    def _build_balance_snapshot(self, client: GrvtCcxtPro, account_summary: dict[str, Any]) -> GrvtBalanceSnapshot:
        # Reuse SDK helper to compute free/used totals and enrich with raw summary fields.
        ccxt_balances = client._get_balances_from_account_summary(account_summary)  # noqa: SLF001

        assets: list[GrvtAssetBalance] = []
        totals = ccxt_balances.get("total", {}) if isinstance(ccxt_balances, dict) else {}
        free_map = ccxt_balances.get("free", {}) if isinstance(ccxt_balances, dict) else {}
        used_map = ccxt_balances.get("used", {}) if isinstance(ccxt_balances, dict) else {}
        for currency, total in totals.items():
            free_value = free_map.get(currency)
            used_value = used_map.get(currency)
            usd_value = None
            for balance in account_summary.get("spot_balances", []) or []:
                if isinstance(balance, dict) and balance.get("currency") == currency:
                    usd_value = self._to_float(balance.get("index_price")) * self._to_float(balance.get("balance"))
                    break
            assets.append(
                GrvtAssetBalance(
                    currency=currency,
                    total=self._to_float(total),
                    free=self._to_float(free_value),
                    used=self._to_float(used_value),
                    usd_value=usd_value,
                )
            )

        positions: list[GrvtPositionBalance] = []
        for position in account_summary.get("positions", []) or []:
            if not isinstance(position, dict):
                continue
            positions.append(
                GrvtPositionBalance(
                    instrument=str(position.get("instrument", "")),
                    size=self._to_float(position.get("size")),
                    notional=self._to_float(position.get("notional")),
                    entry_price=self._to_float(position.get("entry_price")),
                    mark_price=self._to_float(position.get("mark_price")),
                    unrealized_pnl=self._to_float(position.get("unrealized_pnl")),
                    realized_pnl=self._to_float(position.get("realized_pnl")),
                    total_pnl=self._to_float(position.get("total_pnl")),
                    leverage=self._to_float(position.get("leverage")),
                )
            )

        return GrvtBalanceSnapshot(
            sub_account_id=str(account_summary.get("sub_account_id", "")),
            settle_currency=str(account_summary.get("settle_currency", "")),
            available_balance=self._to_float(account_summary.get("available_balance")),
            total_equity=self._to_float(account_summary.get("total_equity")),
            unrealized_pnl=self._to_float(account_summary.get("unrealized_pnl")),
            timestamp=self._parse_timestamp(account_summary.get("event_time")),
            balances=assets,
            positions=positions,
        )

    async def _build_client_for_credentials(
        self,
        api_key: str,
        private_key: str,
        trading_account_id: str,
    ) -> GrvtCcxtPro:
        try:
            env = GrvtEnv(self._settings.grvt_env)
        except ValueError as exc:
            raise RuntimeError(f"Invalid GRVT environment: {self._settings.grvt_env}") from exc

        parameters = {
            "trading_account_id": trading_account_id,
            "private_key": private_key,
            "api_key": api_key,
        }
        client = GrvtCcxtPro(env=env, parameters=parameters)
        await client.load_markets()
        return client

    async def _get_cached_client_for_credentials(
        self,
        api_key: str,
        private_key: str,
        trading_account_id: str,
    ) -> GrvtCcxtPro:
        cache_key = (api_key, private_key, trading_account_id)
        async with self._client_cache_lock:
            cached = self._client_cache.get(cache_key)
            if cached is not None:
                return cached
            client = await self._build_client_for_credentials(api_key, private_key, trading_account_id)
            self._client_cache[cache_key] = client
            return client

    async def get_best_prices_with_credentials(
        self,
        symbol: str,
        api_key: str,
        private_key: str,
        trading_account_id: str,
        depth: int = 1,
    ) -> tuple[float | None, float | None, str]:
        client = await self._get_cached_client_for_credentials(api_key, private_key, trading_account_id)
        instrument = await self._get_instrument_with_client(client, symbol)
        raw = await client.fetch_order_book(instrument, limit=max(1, depth))
        bids = raw.get("bids") if isinstance(raw, dict) else None
        asks = raw.get("asks") if isinstance(raw, dict) else None

        def extract_price(level: Any) -> float:
            if isinstance(level, (list, tuple)) and level:
                return self._to_float(level[0])
            if isinstance(level, dict):
                return self._to_float(level.get("price"))
            return 0.0

        best_bid = extract_price(bids[0]) if isinstance(bids, list) and bids else 0.0
        best_ask = extract_price(asks[0]) if isinstance(asks, list) and asks else 0.0
        return (best_bid or None), (best_ask or None), instrument

    async def _get_instrument_with_client(self, client: GrvtCcxtPro, symbol: str) -> str:
        normalized = symbol.strip().upper().replace("-PERP", "").replace("_PERP", "")
        async with self._instrument_lock:
            if normalized in self._instrument_map:
                return self._instrument_map[normalized]

            markets = await client.fetch_markets({"is_active": True, "kind": "PERPETUAL"})
            for entry in markets:
                base = str(entry.get("base", "")).upper()
                instrument = str(entry.get("instrument", "")).strip()
                if not base or not instrument:
                    continue
                self._instrument_map[base] = instrument

            if normalized not in self._instrument_map:
                raise ValueError(f"GRVT instrument not found for symbol {normalized}")
            return self._instrument_map[normalized]

    async def _get_instrument(self, symbol: str) -> str:
        normalized = symbol.strip().upper().replace("-PERP", "").replace("_PERP", "")
        async with self._instrument_lock:
            if normalized in self._instrument_map:
                return self._instrument_map[normalized]

            client = await self._ensure_client()
            markets = await client.fetch_markets({"is_active": True, "kind": "PERPETUAL"})
            for entry in markets:
                base = str(entry.get("base", "")).upper()
                instrument = str(entry.get("instrument", "")).strip()
                if not base or not instrument:
                    continue
                self._instrument_map[base] = instrument

            if normalized not in self._instrument_map:
                # Fall back to default convention if not found
                inferred = f"{normalized}_USDT_Perp"
                self._instrument_map[normalized] = inferred

            return self._instrument_map[normalized]

    def _apply_env_overrides(self) -> None:
        os.environ.setdefault("GRVT_END_POINT_VERSION", self._settings.grvt_endpoint_version)
        os.environ.setdefault("GRVT_WS_STREAM_VERSION", self._settings.grvt_ws_stream_version)

    @staticmethod
    def _parse_timestamp(value: Any) -> datetime | None:
        try:
            ns = int(value)
        except (TypeError, ValueError):
            return None
        if ns <= 0:
            return None
        return datetime.fromtimestamp(ns / 1_000_000_000, tz=timezone.utc)

    @staticmethod
    def _to_float(value: Any) -> float:
        try:
            return float(Decimal(str(value)))
        except (InvalidOperation, TypeError, ValueError):
            return 0.0

    @staticmethod
    def _parse_decimal(value: Any) -> Decimal:
        if value is None:
            return Decimal(0)
        try:
            return Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            return Decimal(0)

    @staticmethod
    def _quantize_to_step(value: Decimal, step: Decimal) -> Decimal:
        if step <= 0:
            return value
        return (value / step).to_integral_value(rounding=ROUND_DOWN) * step

    def _normalize_amount(self, raw_amount: float, market: dict[str, Any]) -> float:
        amount = self._parse_decimal(raw_amount)
        min_size = self._parse_decimal(market.get("min_size"))
        base_decimals = market.get("base_decimals")
        step = min_size if min_size > 0 else Decimal(0)
        if step <= 0:
            try:
                decimals = int(base_decimals)
            except (TypeError, ValueError):
                decimals = 0
            if decimals > 0:
                step = Decimal(1).scaleb(-decimals)
        if step > 0:
            amount = self._quantize_to_step(amount, step)
            if amount < step:
                raise ValueError(f"GRVT order amount below minimum step ({amount} < {step})")
        if amount <= 0:
            raise ValueError("Invalid GRVT order amount")
        return float(amount)

    def _normalize_price(self, raw_price: float, market: dict[str, Any]) -> float:
        price = self._parse_decimal(raw_price)
        tick_size = self._parse_decimal(market.get("tick_size"))
        if tick_size > 0:
            price = self._quantize_to_step(price, tick_size)
        if price <= 0:
            raise ValueError("Invalid GRVT order price")
        return float(price)

    @classmethod
    def _build_side(cls, levels: list[dict[str, Any]], descending: bool = False) -> OrderBookSide:
        ordered = sorted(levels or [], key=lambda l: cls._to_float(l.get("price")), reverse=descending)
        cumulative = 0.0
        parsed_levels: list[OrderBookLevel] = []
        for entry in ordered:
            price = cls._to_float(entry.get("price"))
            size = cls._to_float(entry.get("size"))
            if price <= 0 or size <= 0:
                continue
            cumulative += size
            parsed_levels.append(OrderBookLevel(price=price, size=size, total=cumulative))

        return OrderBookSide(levels=parsed_levels)

    def _parse_orderbook_message(self, message: Any, symbol: str) -> VenueOrderBook | None:
        payload: dict[str, Any] | None = None
        if isinstance(message, dict):
            payload = message.get("data") or message.get("result") or message
        if not isinstance(payload, dict):
            return None

        asks = payload.get("asks") or []
        bids = payload.get("bids") or []
        if not asks and not bids:
            return None

        asks_side = self._build_side(asks, descending=False)
        bids_side = self._build_side(bids, descending=True)
        ts = self._parse_timestamp(payload.get("event_time"))
        timestamp = ts.timestamp() if isinstance(ts, datetime) else datetime.now(tz=timezone.utc).timestamp()

        return VenueOrderBook(
            venue="grvt",
            symbol=symbol,
            bids=bids_side,
            asks=asks_side,
            timestamp=timestamp,
        )

    def _parse_trades_message(self, message: Any, symbol: str) -> list[TradeEntry] | None:
        payload = None
        if isinstance(message, dict):
            payload = message.get("data") or message.get("result") or message
        if payload is None:
            return None

        entries = payload.get("trades") if isinstance(payload, dict) else payload
        if not isinstance(entries, list):
            return None

        trades: list[TradeEntry] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            price = self._to_float(entry.get("price"))
            size = self._to_float(entry.get("size"))
            if price <= 0 or size <= 0:
                continue
            event_time = self._parse_timestamp(entry.get("event_time"))
            is_buyer = entry.get("is_taker_buyer") or entry.get("is_buyer")
            trades.append(
                TradeEntry(
                    venue="grvt",
                    symbol=symbol,
                    price=price,
                    size=size,
                    is_buy=bool(is_buyer),
                    timestamp=event_time.timestamp() if isinstance(event_time, datetime) else datetime.now(tz=timezone.utc).timestamp(),
                )
            )
        return trades or None
