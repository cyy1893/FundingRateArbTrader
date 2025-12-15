from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

import websockets

from pysdk.grvt_ccxt_env import GrvtEnv, GrvtWSEndpointType, get_grvt_ws_endpoint
from pysdk.grvt_ccxt_pro import GrvtCcxtPro

from app.config import Settings
from app.models import GrvtAssetBalance, GrvtBalanceSnapshot, GrvtPositionBalance, OrderBookLevel, OrderBookSide, TradeEntry, VenueOrderBook


class GrvtService:
    """
    Thin wrapper around the GRVT CCXT-style SDK to expose balance snapshots.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: GrvtCcxtPro | None = None
        self._lock = asyncio.Lock()
        self._instrument_map: dict[str, str] = {}
        self._instrument_lock = asyncio.Lock()
        self._apply_env_overrides()

    async def start(self) -> None:
        await self._ensure_client()

    async def stop(self) -> None:
        if self._client is not None:
            session = getattr(self._client, "_session", None)
            if session is not None and not session.closed:
                await session.close()
            self._client = None

    @property
    def is_ready(self) -> bool:
        return self._client is not None

    async def get_balances(self) -> GrvtBalanceSnapshot:
        client = await self._ensure_client()
        account_summary = await client.get_account_summary()
        if not account_summary:
            raise RuntimeError("GRVT account summary returned no data")

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

    async def stream_orderbook(self, symbol: str, depth: int) -> asyncio.AsyncIterator[VenueOrderBook]:
        """
        Stream GRVT order books over WebSocket (market data only).
        """

        instrument = await self._get_instrument(symbol)
        client = await self._ensure_client()
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

        instrument = await self._get_instrument(symbol)
        client = await self._ensure_client()
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

    async def _ensure_client(self) -> GrvtCcxtPro:
        if self._client is not None:
            return self._client

        async with self._lock:
            if self._client is not None:
                return self._client

            missing: list[str] = []
            if not self._settings.grvt_api_key:
                missing.append("GRVT_API_KEY")
            if not self._settings.grvt_private_key:
                missing.append("GRVT_PRIVATE_KEY")
            if not self._settings.grvt_trading_account_id:
                missing.append("GRVT_TRADING_ACCOUNT_ID")
            if missing:
                raise RuntimeError(f"Missing GRVT configuration: {', '.join(missing)}")

            try:
                env = GrvtEnv(self._settings.grvt_env)
            except ValueError as exc:
                raise RuntimeError(f"Invalid GRVT environment: {self._settings.grvt_env}") from exc

            parameters = {
                "trading_account_id": self._settings.grvt_trading_account_id,
                "private_key": self._settings.grvt_private_key,
                "api_key": self._settings.grvt_api_key,
            }
            self._client = GrvtCcxtPro(env=env, parameters=parameters)

        return self._client

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
