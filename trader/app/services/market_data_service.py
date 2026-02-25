from __future__ import annotations

import math
import asyncio
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from time import time
from typing import Any, Awaitable, Callable

import httpx
from sqlmodel import Session, select

from app.config import Settings
from app.db_models import AssetIcon
from app.db_session import get_engine
from app.services.lighter_service import LighterService
from app.models import (
    ArbitrageSnapshotResponse,
    ApiError,
    AvailableSymbolEntry,
    ExchangeMarketMetrics,
    ExchangeSnapshot,
    FundingHistoryPoint,
    FundingPredictionResponse,
    MarketRow,
    PerpSnapshot,
)

DEFAULT_FUNDING_PERIOD_HOURS = 1.0
LIGHTER_FUNDING_PERIOD_HOURS = 8.0
MS_PER_HOUR = 60 * 60 * 1000
MAX_HYPER_FUNDING_POINTS = 500
MAX_HYPER_LOOKBACK_MS = MAX_HYPER_FUNDING_POINTS * MS_PER_HOUR
DEFAULT_LEFT_SOURCE = "lighter"
DEFAULT_RIGHT_SOURCE = "grvt"
ARBITRAGE_LOOKBACK_DAYS = 1
ARBITRAGE_LOOKBACK_HOURS = 24
ARBITRAGE_HOURS_PER_YEAR = 24 * 365
MAX_ARBITRAGE_WORKERS = 5
PREDICTION_LOOKBACK_DAYS = 3
PREDICTION_LOOKBACK_HOURS = 72
PREDICTION_FORECAST_HOURS = 24
PREDICTION_HOURS_PER_YEAR = 24 * 365
MAX_PREDICTION_WORKERS = 5
PREDICTION_HALF_LIFE_HOURS = 16.0
PREDICTION_VOLATILITY_WINDOW_HOURS = 24
RECOMMENDATION_APR_WEIGHT = 0.70
RECOMMENDATION_FUNDING_VOLATILITY_WEIGHT = 0.10
RECOMMENDATION_PRICE_VOLATILITY_WEIGHT = 0.10
SPREAD_INTOLERABLE_BPS = 15.0
SPREAD_STEEPNESS_BPS = 1.5
DEFAULT_FALLBACK_BID_ASK_SPREAD_BPS = 12.0
DEFAULT_FALLBACK_PRICE_VOLATILITY_PCT = 5.0
MAX_ACCEPTABLE_PRICE_VOLATILITY_PCT = 10.0
# Spread sampling window for recommendation scoring/details.
SPREAD_SAMPLING_DURATION_SECONDS = 3
SPREAD_SAMPLING_INTERVAL_SECONDS = 1
LIGHTER_SPREAD_FETCH_CONCURRENCY = 8
CACHE_TTL_SECONDS = 10 * 60
PREDICTION_CACHE_TTL_SECONDS = 10 * 60
AVAILABLE_SYMBOLS_CACHE_TTL_SECONDS = 60 * 60
BINANCE_PRICE_CACHE_TTL_SECONDS = 5 * 60
ICON_URL_CACHE_TTL_SECONDS = 60 * 60
ICON_DISCOVERY_CONCURRENCY = 8
COINGECKO_SYMBOL_MAP_TTL_SECONDS = 6 * 60 * 60
SYMBOL_RENAMES: dict[str, str] = {
    "1000PEPE": "kPEPE",
    "1000SHIB": "kSHIB",
    "1000BONK": "kBONK",
}


class MarketDataService:
    def __init__(self, settings: Settings, lighter_service: LighterService | None = None) -> None:
        self._lighter_base_url = settings.lighter_base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=10.0)
        self._lighter_service = lighter_service
        self._lighter_leverage_map: dict[str, float] | None = None
        self._grvt_market_data_base, _ = self._build_grvt_endpoints(settings.grvt_env)
        self._arbitrage_cache: dict[tuple[str, str, float], tuple[float, ArbitrageSnapshotResponse]] = {}
        self._prediction_cache: dict[tuple[str, str, float], tuple[float, FundingPredictionResponse]] = {}
        self._available_symbols_cache: dict[tuple[str, str], tuple[float, list[AvailableSymbolEntry], datetime]] = {}
        self._binance_price_cache: dict[str, tuple[float, dict[str, float | None]]] = {}
        self._icon_url_cache: dict[str, tuple[float, str | None]] = {}
        self._coingecko_symbol_to_ids_cache: tuple[float, dict[str, list[str]]] | None = None
        self._coingecko_api_key = os.getenv("COINGECKO_API_KEY", "").strip()

    async def close(self) -> None:
        await self._client.aclose()

    async def _fetch_hyperliquid_markets(self) -> ExchangeSnapshot:
        errors: list[ApiError] = []
        try:
            response = await self._client.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "metaAndAssetCtxs"},
            )
            response.raise_for_status()
            raw = response.json()
        except Exception as exc:  # noqa: BLE001
            errors.append(ApiError(source="Hyperliquid API", message=_format_exception(exc)))
            return ExchangeSnapshot(markets=[], errors=errors)

        if not isinstance(raw, list) or len(raw) < 2:
            errors.append(ApiError(source="Hyperliquid API", message="Unexpected payload"))
            return ExchangeSnapshot(markets=[], errors=errors)

        meta, contexts = raw
        markets: list[ExchangeMarketMetrics] = []
        universe = meta.get("universe") if isinstance(meta, dict) else None
        if not isinstance(universe, list) or not isinstance(contexts, list):
            errors.append(ApiError(source="Hyperliquid API", message="Malformed universe"))
            return ExchangeSnapshot(markets=[], errors=errors)

        for idx, asset in enumerate(universe):
            if not isinstance(asset, dict) or asset.get("isDelisted"):
                continue
            ctx = contexts[idx] if idx < len(contexts) else None
            if not isinstance(ctx, dict):
                continue

            mark_px = _parse_float(ctx.get("markPx"))
            day_ntl_vlm = _parse_float(ctx.get("dayNtlVlm"))
            funding_rate = _parse_float(ctx.get("funding"))
            open_interest = _parse_float(ctx.get("openInterest"))
            base_symbol = _normalize_base_symbol(str(asset.get("name", "") or ""))

            markets.append(
                ExchangeMarketMetrics(
                    base_symbol=base_symbol,
                    symbol=str(asset.get("name", "") or ""),
                    display_name=base_symbol or str(asset.get("name", "") or ""),
                    mark_price=mark_px,
                    price_change_1h=None,
                    price_change_24h=None,
                    price_change_7d=None,
                    max_leverage=_parse_float(asset.get("maxLeverage")),
                    funding_rate_hourly=funding_rate,
                    funding_period_hours=DEFAULT_FUNDING_PERIOD_HOURS,
                    day_notional_volume=day_ntl_vlm,
                    open_interest=open_interest,
                    volume_usd=day_ntl_vlm,
                )
            )

        return ExchangeSnapshot(markets=markets, errors=errors)

    async def _fetch_lighter_markets(self) -> ExchangeSnapshot:
        errors: list[ApiError] = []
        leverage_map = await self._get_lighter_leverage_map()
        order_books: dict[str, Any] = {}
        funding_rates: dict[str, Any] = {}
        exchange_stats: dict[str, Any] = {}

        async def _fetch_json(path: str) -> dict[str, Any]:
            last_exc: Exception | None = None
            for attempt in range(5):
                try:
                    response = await self._client.get(f"{self._lighter_base_url}{path}")
                    response.raise_for_status()
                    payload = response.json()
                    if isinstance(payload, dict):
                        return payload
                    return {}
                except httpx.HTTPStatusError as exc:
                    last_exc = exc
                    status = exc.response.status_code
                    if status < 500:
                        break
                except httpx.RequestError as exc:
                    last_exc = exc
                if attempt < 4:
                    await asyncio.sleep(0.4 * (attempt + 1))
            if last_exc is not None:
                raise last_exc
            return {}

        fetches = await asyncio.gather(
            _fetch_json("/api/v1/orderBooks"),
            _fetch_json("/api/v1/funding-rates"),
            _fetch_json("/api/v1/exchangeStats"),
            return_exceptions=True,
        )
        order_books_result, funding_result, stats_result = fetches

        if isinstance(order_books_result, Exception):
            errors.append(ApiError(source="Lighter API", message=_format_exception(order_books_result)))
        else:
            order_books = order_books_result

        if isinstance(funding_result, Exception):
            errors.append(ApiError(source="Lighter API", message=_format_exception(funding_result)))
        else:
            funding_rates = funding_result

        if isinstance(stats_result, Exception):
            errors.append(ApiError(source="Lighter API", message=_format_exception(stats_result)))
        else:
            exchange_stats = stats_result

        volume_by_symbol: dict[str, float] = {}
        price_changes_by_symbol: dict[str, tuple[float | None, float | None, float | None]] = {}
        markets: list[ExchangeMarketMetrics] = []

        if isinstance(order_books, dict):
            for entry in order_books.get("order_books", []) or []:
                if not isinstance(entry, dict):
                    continue
                symbol = str(entry.get("symbol", "")).upper()
                base_symbol = _normalize_derivatives_base(symbol)
                mark_price = _parse_float(entry.get("price"))
                best_bid, best_ask = _extract_best_bid_ask(entry)
                markets.append(
                    ExchangeMarketMetrics(
                        base_symbol=base_symbol,
                        symbol=symbol,
                        display_name=base_symbol or symbol,
                        mark_price=mark_price,
                        price_change_1h=None,
                        price_change_24h=None,
                        price_change_7d=None,
                        max_leverage=None,
                        funding_rate_hourly=None,
                        funding_period_hours=LIGHTER_FUNDING_PERIOD_HOURS,
                        day_notional_volume=None,
                        open_interest=None,
                        volume_usd=None,
                        best_bid=best_bid,
                        best_ask=best_ask,
                    )
                )

        funding_map: dict[str, float] = {}
        if isinstance(funding_rates, dict):
            for entry in funding_rates.get("funding_rates", []) or []:
                if not isinstance(entry, dict):
                    continue
                if (entry.get("exchange") or "").lower() != "lighter":
                    continue
                symbol = str(entry.get("symbol", "")).upper()
                rate = _parse_float(entry.get("rate"))
                if rate is not None:
                    funding_map[symbol] = rate

        if isinstance(exchange_stats, dict):
            # Lighter returns daily stats under "order_book_stats" with quote volume already in USD.
            for entry in exchange_stats.get("order_book_stats", []) or []:
                if not isinstance(entry, dict):
                    continue
                symbol = str(entry.get("symbol", "")).upper()
                volume_usd = _parse_float(entry.get("daily_quote_token_volume"))
                if volume_usd is not None:
                    volume_by_symbol[symbol] = volume_usd
                price_changes_by_symbol[symbol] = _extract_price_change_fields(entry)

        # Merge funding + volume into markets list
        symbol_to_market = {m.symbol: m for m in markets}
        for symbol, rate in funding_map.items():
            market = symbol_to_market.get(symbol) or symbol_to_market.get(f"{symbol}-PERP")
            if market:
                market.funding_rate_hourly = rate / max(LIGHTER_FUNDING_PERIOD_HOURS, 1)
        for symbol, volume in volume_by_symbol.items():
            market = symbol_to_market.get(symbol) or symbol_to_market.get(f"{symbol}-PERP")
            if market:
                market.volume_usd = volume
                market.day_notional_volume = volume
        for symbol, changes in price_changes_by_symbol.items():
            market = symbol_to_market.get(symbol) or symbol_to_market.get(f"{symbol}-PERP")
            if market:
                market.price_change_1h = changes[0]
                market.price_change_24h = changes[1]
                market.price_change_7d = changes[2]
        for symbol, leverage in leverage_map.items():
            market = symbol_to_market.get(symbol) or symbol_to_market.get(f"{symbol}-PERP")
            if market and leverage is not None:
                market.max_leverage = leverage

        markets_result = list(symbol_to_market.values())
        if not markets_result and errors:
            return ExchangeSnapshot(markets=[], errors=errors)
        return ExchangeSnapshot(markets=markets_result, errors=errors)

    async def _fetch_grvt_markets(self, candidate_bases: set[str] | None = None) -> ExchangeSnapshot:
        errors: list[ApiError] = []
        instruments: list[dict[str, Any]] = []
        try:
            resp = await self._client.post(
                f"{self._grvt_market_data_base}/full/v1/all_instruments",
                json={"is_active": True},
            )
            resp.raise_for_status()
            payload = resp.json()
            instruments = payload.get("result", []) or []
        except Exception as exc:  # noqa: BLE001
            errors.append(ApiError(source="GRVT API", message=_format_exception(exc)))
            return ExchangeSnapshot(markets=[], errors=errors)

        # Filter perpetual instruments.
        perp_instruments = [inst for inst in instruments if isinstance(inst, dict) and inst.get("kind") == "PERPETUAL"]
        if candidate_bases:
            normalized_candidates = {symbol.upper() for symbol in candidate_bases if symbol}
            perp_instruments = [
                inst
                for inst in perp_instruments
                if str(inst.get("base", "")).upper() in normalized_candidates
            ]
        tickers: dict[str, dict[str, Any]] = {}

        async def fetch_ticker(instrument: str) -> None:
            try:
                resp = await self._client.post(
                    f"{self._grvt_market_data_base}/full/v1/ticker",
                    json={"instrument": instrument},
                )
                resp.raise_for_status()
                data = resp.json()
                result = data.get("result") if isinstance(data, dict) else None
                if isinstance(result, dict):
                    tickers[instrument] = result
            except Exception:
                # ignore individual failures; we will still return partial data
                return

        # Limit concurrency to avoid hammering the API
        semaphore = asyncio.Semaphore(10)

        async def bounded_fetch(instr: str) -> None:
            async with semaphore:
                await fetch_ticker(instr)

        await asyncio.gather(*(bounded_fetch(inst["instrument"]) for inst in perp_instruments if "instrument" in inst))

        markets: list[ExchangeMarketMetrics] = []
        for inst in perp_instruments:
            symbol = str(inst.get("instrument", "")).replace("_Perp", "").replace("_PERP", "")
            base_symbol = str(inst.get("base", "")).upper()
            ticker = tickers.get(inst.get("instrument", ""))
            mark_price = _parse_float(ticker.get("mark_price")) if ticker else None
            best_bid, best_ask = _extract_best_bid_ask(ticker if isinstance(ticker, dict) else {})
            price_change_1h, price_change_24h, price_change_7d = _extract_price_change_fields(
                ticker if isinstance(ticker, dict) else {},
                mark_price=mark_price,
            )
            funding_rate_pct = (
                _parse_float(ticker.get("funding_rate_8h_curr") or ticker.get("funding_rate"))
                if ticker
                else None
            )
            interval_hours = _parse_float(inst.get("funding_interval_hours")) or 8.0
            funding_rate_hourly = (
                (funding_rate_pct / 100.0) / max(interval_hours, 1.0) if funding_rate_pct is not None else None
            )
            buy_q = _parse_float(ticker.get("buy_volume_24h_q")) if ticker else None
            sell_q = _parse_float(ticker.get("sell_volume_24h_q")) if ticker else None
            volume_q = (buy_q or 0) + (sell_q or 0)
            open_interest = _parse_float(ticker.get("open_interest")) if ticker else None

            markets.append(
                ExchangeMarketMetrics(
                    base_symbol=base_symbol or symbol,
                    symbol=f"{base_symbol}-PERP" if base_symbol else symbol,
                    display_name=base_symbol or symbol,
                    mark_price=mark_price,
                    price_change_1h=price_change_1h,
                    price_change_24h=price_change_24h,
                    price_change_7d=price_change_7d,
                    max_leverage=50.0,
                    funding_rate_hourly=funding_rate_hourly,
                    funding_period_hours=interval_hours,
                    day_notional_volume=volume_q if volume_q > 0 else None,
                    open_interest=open_interest,
                    volume_usd=volume_q if volume_q > 0 else None,
                    best_bid=best_bid,
                    best_ask=best_ask,
                )
            )

        return ExchangeSnapshot(markets=markets, errors=errors)

    async def _fetch_hyperliquid_funding_history(self, symbol: str, start_time_ms: int) -> list[tuple[int, float]]:
        """Fetch hourly funding history points from Hyperliquid."""
        response = await self._client.post(
            "https://api.hyperliquid.xyz/info",
            json={"type": "fundingHistory", "coin": symbol, "startTime": start_time_ms},
        )
        response.raise_for_status()
        raw = response.json()
        series: list[tuple[int, float]] = []
        if isinstance(raw, list):
            for entry in raw:
                if not isinstance(entry, dict):
                    continue
                normalized_time = _normalize_timestamp_to_hour(entry.get("time"))
                rate = _parse_float(entry.get("fundingRate"))
                if normalized_time is not None and rate is not None:
                    series.append((normalized_time, rate * 100.0))
        return series

    async def _fetch_lighter_funding_history(self, symbol: str, start_time_ms: int) -> list[tuple[int, float]]:
        """Fetch hourly funding history points from Lighter."""
        normalized_symbol = _normalize_lighter_symbol(symbol)
        base_symbol = normalized_symbol[:-5] if normalized_symbol.endswith("-PERP") else normalized_symbol
        if not base_symbol:
            raise ValueError("Invalid Lighter symbol requested.")

        order_books_res = await self._client.get(f"{self._lighter_base_url}/api/v1/orderBooks")
        order_books_res.raise_for_status()
        order_books = order_books_res.json()
        market_id: int | None = None
        if isinstance(order_books, dict):
            for market in order_books.get("order_books", []) or []:
                if not isinstance(market, dict):
                    continue
                if _normalize_lighter_symbol(str(market.get("symbol") or "")) == base_symbol:
                    market_id_value = _parse_float(market.get("market_id"))
                    if market_id_value is not None and market_id_value > 0:
                        market_id = int(market_id_value)
                    break
        if market_id is None or market_id <= 0:
            raise ValueError("Unknown Lighter market.")

        end_timestamp_seconds = math.floor(datetime.now(tz=timezone.utc).timestamp())
        start_timestamp_seconds = max(math.floor(start_time_ms / 1000), 0)
        duration_hours = max(1, math.ceil((end_timestamp_seconds - start_timestamp_seconds) / 3600))
        params = {
            "market_id": str(market_id),
            "resolution": "1h",
            "start_timestamp": str(start_timestamp_seconds),
            "end_timestamp": str(end_timestamp_seconds),
            "count_back": str(min(duration_hours, 1000)),
        }
        funding_res = await self._client.get(f"{self._lighter_base_url}/api/v1/fundings", params=params)
        funding_res.raise_for_status()
        payload = funding_res.json()
        series: list[tuple[int, float]] = []
        if isinstance(payload, dict):
            for entry in payload.get("fundings", []) or []:
                if not isinstance(entry, dict):
                    continue
                timestamp_seconds = _parse_float(entry.get("timestamp"))
                rate_value = _parse_float(entry.get("rate")) or _parse_float(entry.get("value"))
                if timestamp_seconds is None or rate_value is None:
                    continue
                direction = str(entry.get("direction") or "").lower()
                signed_rate = -rate_value if direction == "short" else rate_value
                timestamp_ms = int(timestamp_seconds * 1000)
                normalized_time = _normalize_timestamp_to_hour(timestamp_ms)
                if normalized_time is not None:
                    series.append((normalized_time, signed_rate))
        return series

    async def _fetch_grvt_funding_history(
        self,
        symbol: str,
        start_time_ms: int,
        funding_period_hours: float | None = None,
    ) -> list[tuple[int, float]]:
        """Fetch hourly funding history points from GRVT, normalized to 1h."""
        base = _normalize_grvt_base_symbol(symbol)
        if not base:
            raise ValueError("Invalid GRVT symbol requested.")
        instrument = f"{base}_USDT_Perp"
        start_ns = max(0, int(start_time_ms * 1_000_000))
        body = {"instrument": instrument, "start_time": str(start_ns), "limit": 1000}
        period_hours = funding_period_hours or 8.0
        normalized_hours = max(period_hours, 1.0)
        response = await self._client.post(
            f"{self._grvt_market_data_base}/full/v1/funding",
            json=body,
        )
        response.raise_for_status()
        payload = response.json()
        series: list[tuple[int, float]] = []
        if isinstance(payload, dict):
            for entry in payload.get("result", []) or []:
                if not isinstance(entry, dict):
                    continue
                rate = _parse_float(entry.get("funding_rate"))
                time_ns = _parse_float(entry.get("funding_time"))
                if rate is None or time_ns is None:
                    continue
                hourly_rate = rate / normalized_hours
                time_ms = math.floor(time_ns / 1_000_000)
                normalized_time = _normalize_timestamp_to_hour(time_ms)
                if normalized_time is not None:
                    series.append((normalized_time, hourly_rate))
        return series

    async def _fetch_history_series_for_source(
        self,
        source: str,
        symbol: str,
        start_time_ms: int,
        funding_period_hours: float | None = None,
    ) -> list[tuple[int, float]]:
        """Fetch funding history series for a given provider."""
        provider = source.lower()
        if provider == "hyperliquid":
            return await self._fetch_hyperliquid_funding_history(symbol, start_time_ms)
        if provider == "lighter":
            return await self._fetch_lighter_funding_history(symbol, start_time_ms)
        if provider == "grvt":
            return await self._fetch_grvt_funding_history(symbol, start_time_ms, funding_period_hours)
        raise ValueError(f"Unsupported provider: {source}")

    def _merge_funding_history_series(
        self,
        left_history: list[tuple[int, float]],
        right_history: list[tuple[int, float]],
    ) -> list[FundingHistoryPoint]:
        """Merge left/right funding series into a unified dataset."""
        sorted_left = sorted(left_history, key=lambda entry: entry[0])
        sorted_right = sorted(right_history, key=lambda entry: entry[0])

        if not sorted_left and sorted_right:
            return [
                FundingHistoryPoint(time=time, left=None, right=rate, spread=None)
                for time, rate in sorted_right
            ]

        dataset: list[FundingHistoryPoint] = []
        right_index = 0
        current_right: float | None = None

        for time, left_rate in sorted_left:
            while right_index < len(sorted_right) and sorted_right[right_index][0] <= time:
                next_right = sorted_right[right_index][1]
                if next_right is not None and math.isfinite(next_right):
                    current_right = next_right
                right_index += 1
            spread = current_right - left_rate if current_right is not None else None
            dataset.append(
                FundingHistoryPoint(
                    time=time,
                    left=left_rate,
                    right=current_right,
                    spread=spread,
                )
            )
        return dataset

    async def get_funding_history(
        self,
        left_source: str | None,
        right_source: str | None,
        left_symbol: str,
        right_symbol: str | None,
        days: int,
        left_funding_period_hours: float | None = None,
        right_funding_period_hours: float | None = None,
    ) -> list[FundingHistoryPoint]:
        """
        Fetch funding history for the given symbols and sources, merging them into a dataset.
        """
        if not left_symbol:
            raise ValueError("left_symbol is required")

        normalized_days = max(days, 1)
        now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
        desired_start = now_ms - normalized_days * 24 * MS_PER_HOUR
        start_time_ms = max(desired_start, now_ms - MAX_HYPER_LOOKBACK_MS)

        left_provider = (left_source or DEFAULT_LEFT_SOURCE).lower()
        right_provider = (right_source or DEFAULT_RIGHT_SOURCE).lower()

        left_history: list[tuple[int, float]] = []
        right_history: list[tuple[int, float]] = []

        try:
            left_history = await self._fetch_history_series_for_source(
                left_provider,
                left_symbol,
                start_time_ms,
                left_funding_period_hours,
            )
        except Exception:
            left_history = []

        if right_symbol:
            try:
                right_history = await self._fetch_history_series_for_source(
                    right_provider,
                    right_symbol,
                    start_time_ms,
                    right_funding_period_hours,
                )
            except Exception:
                right_history = []

        if not left_history and not right_history:
            raise ValueError("暂无可用的资金费率历史数据")

        return self._merge_funding_history_series(left_history, right_history)

    async def get_available_symbols(
        self,
        primary: str,
        secondary: str,
    ) -> tuple[list[AvailableSymbolEntry], datetime]:
        cache_key = (primary, secondary)
        cached = self._available_symbols_cache.get(cache_key)
        if cached and time() - cached[0] < AVAILABLE_SYMBOLS_CACHE_TTL_SECONDS:
            return cached[1], cached[2]

        snapshot = await self.get_perp_snapshot(primary, secondary)
        symbols: list[AvailableSymbolEntry] = []
        seen: set[str] = set()
        for row in snapshot.rows:
            symbol = (row.symbol or "").upper()
            if not symbol or not (row.right and row.right.get("symbol")):
                continue
            if symbol in seen:
                continue
            seen.add(symbol)
            symbols.append(
                AvailableSymbolEntry(
                    symbol=symbol,
                    display_name=row.display_name or symbol,
                )
            )
        symbols.sort(key=lambda entry: entry.display_name)
        self._available_symbols_cache[cache_key] = (time(), symbols, snapshot.fetched_at)
        return symbols, snapshot.fetched_at

    async def _sample_average_bid_ask_spreads(
        self,
        primary: str,
        secondary: str,
        symbols: set[str],
        duration_seconds: int,
        interval_seconds: int,
        progress_callback: Callable[[float, str], Awaitable[None] | None] | None = None,
    ) -> dict[str, dict[str, Any]]:
        if not symbols:
            return {}

        sample_count = max(duration_seconds // max(interval_seconds, 1), 1)
        sums: dict[str, dict[str, float]] = {}
        counts: dict[str, int] = {}
        mid_samples: dict[str, list[float]] = {}
        spread_samples: dict[str, dict[str, list[float]]] = defaultdict(
            lambda: {"left": [], "right": [], "combined": []}
        )

        for index in range(sample_count):
            try:
                snapshot = await self.get_perp_snapshot(primary, secondary)
            except Exception:  # noqa: BLE001
                if index + 1 < sample_count:
                    await asyncio.sleep(interval_seconds)
                continue

            snapshot_by_symbol = {
                (row.symbol or row.left_symbol or "").upper(): row
                for row in snapshot.rows
                if (row.symbol or row.left_symbol)
            }

            primary_lighter_map: dict[str, tuple[float | None, float | None]] = {}
            secondary_lighter_map: dict[str, tuple[float | None, float | None]] = {}
            if primary.lower() == "lighter":
                primary_lighter_map = await self._fetch_lighter_best_prices_map(symbols)
            if secondary.lower() == "lighter":
                secondary_lighter_map = await self._fetch_lighter_best_prices_map(symbols)

            for symbol_key in symbols:
                row = snapshot_by_symbol.get(symbol_key)
                if row is None:
                    continue
                right_payload = row.right if isinstance(row.right, dict) else {}
                if not right_payload:
                    continue

                if primary.lower() == "lighter":
                    left_bid, left_ask = primary_lighter_map.get(symbol_key, (None, None))
                else:
                    left_bid = _parse_float(row.best_bid)
                    left_ask = _parse_float(row.best_ask)

                if secondary.lower() == "lighter":
                    right_bid, right_ask = secondary_lighter_map.get(symbol_key, (None, None))
                else:
                    right_bid = _parse_float(right_payload.get("best_bid"))
                    right_ask = _parse_float(right_payload.get("best_ask"))

                left_spread_bps = _compute_bid_ask_spread_bps(
                    left_bid,
                    left_ask,
                    default_bps=DEFAULT_FALLBACK_BID_ASK_SPREAD_BPS,
                )
                right_spread_bps = _compute_bid_ask_spread_bps(
                    right_bid,
                    right_ask,
                    default_bps=DEFAULT_FALLBACK_BID_ASK_SPREAD_BPS,
                )
                bucket = sums.setdefault(symbol_key, {"left": 0.0, "right": 0.0, "combined": 0.0})
                bucket["left"] += left_spread_bps
                bucket["right"] += right_spread_bps
                bucket["combined"] += left_spread_bps + right_spread_bps
                counts[symbol_key] = counts.get(symbol_key, 0) + 1
                spread_samples[symbol_key]["left"].append(left_spread_bps)
                spread_samples[symbol_key]["right"].append(right_spread_bps)
                spread_samples[symbol_key]["combined"].append(left_spread_bps + right_spread_bps)

                left_mid = _compute_mid_price(left_bid, left_ask, _parse_float(row.mark_price))
                right_mid = _compute_mid_price(
                    right_bid,
                    right_ask,
                    _parse_float(right_payload.get("mark_price")),
                )
                combined_mid = _combine_mid_prices(left_mid, right_mid)
                if combined_mid is not None and combined_mid > 0:
                    mid_samples.setdefault(symbol_key, []).append(combined_mid)

            if index + 1 < sample_count:
                await asyncio.sleep(interval_seconds)

            await _invoke_progress_callback(
                progress_callback,
                5 + ((index + 1) / max(sample_count, 1)) * 85,
                f"盘口采样 {index + 1}/{sample_count}",
            )

        averages: dict[str, dict[str, Any]] = {}
        for symbol_key, total_values in sums.items():
            count = counts.get(symbol_key, 0)
            if count <= 0:
                continue
            averages[symbol_key] = {
                "left": total_values["left"] / count,
                "right": total_values["right"] / count,
                "combined": total_values["combined"] / count,
                "price_volatility_24h_pct": _compute_price_volatility_24h_pct(
                    mid_samples.get(symbol_key, []),
                    interval_seconds=interval_seconds,
                    default_value=DEFAULT_FALLBACK_PRICE_VOLATILITY_PCT,
                ),
                "left_spread_samples_bps": spread_samples[symbol_key]["left"],
                "right_spread_samples_bps": spread_samples[symbol_key]["right"],
                "combined_spread_samples_bps": spread_samples[symbol_key]["combined"],
            }
        return averages

    async def _fetch_lighter_best_prices_map(
        self,
        symbols: set[str],
    ) -> dict[str, tuple[float | None, float | None]]:
        if self._lighter_service is None or not symbols:
            return {}

        semaphore = asyncio.Semaphore(LIGHTER_SPREAD_FETCH_CONCURRENCY)
        results: dict[str, tuple[float | None, float | None]] = {}

        async def _fetch_one(symbol_key: str) -> None:
            symbol_for_lighter = _normalize_lighter_symbol_for_book(symbol_key)
            async with semaphore:
                try:
                    bid, ask = await self._lighter_service.get_best_prices(symbol_for_lighter, depth=1)
                    results[symbol_key] = (bid, ask)
                except Exception:  # noqa: BLE001
                    results[symbol_key] = (None, None)

        await asyncio.gather(*(_fetch_one(symbol_key) for symbol_key in symbols))
        return results

    async def get_funding_prediction_snapshot(
        self,
        primary: str,
        secondary: str,
        volume_threshold: float = 0.0,
        force_refresh: bool = False,
        progress_callback: Callable[[float, str], Awaitable[None] | None] | None = None,
    ) -> FundingPredictionResponse:
        """
        Predict 24h funding rates based on recent funding history and return
        the suggested direction plus annualized yield.
        """
        cache_key = (primary, secondary, float(volume_threshold))
        if not force_refresh:
            cached = self._prediction_cache.get(cache_key)
            if cached and time() - cached[0] < PREDICTION_CACHE_TTL_SECONDS:
                await _invoke_progress_callback(progress_callback, 100.0, "命中缓存")
                return cached[1]

        await _invoke_progress_callback(progress_callback, 3.0, "加载市场快照")
        snapshot = await self.get_perp_snapshot(primary, secondary)
        fetched_at = snapshot.fetched_at
        volume_cutoff = max(volume_threshold, 0.0)
        raw_entries: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []

        def _passes_volume(row: MarketRow) -> bool:
            if volume_cutoff <= 0:
                return True
            left_volume = _parse_float(row.day_notional_volume) or 0.0
            right_payload = row.right if isinstance(row.right, dict) else None
            right_volume = _parse_float(right_payload.get("volume_usd")) if right_payload else None
            return left_volume + (right_volume or 0.0) >= volume_cutoff

        eligible_rows = [
            row
            for row in snapshot.rows
            if isinstance(row.right, dict) and row.right.get("symbol") and _passes_volume(row)
        ]
        sampling_symbols = {
            (row.symbol or row.left_symbol or "").upper()
            for row in eligible_rows
            if (row.symbol or row.left_symbol)
        }
        spread_averages = await self._sample_average_bid_ask_spreads(
            primary=primary,
            secondary=secondary,
            symbols=sampling_symbols,
            duration_seconds=SPREAD_SAMPLING_DURATION_SECONDS,
            interval_seconds=SPREAD_SAMPLING_INTERVAL_SECONDS,
            progress_callback=progress_callback,
        )
        await _invoke_progress_callback(progress_callback, 90.0, "完成盘口采样，开始计算")

        semaphore = asyncio.Semaphore(MAX_PREDICTION_WORKERS)
        total_rows = max(len(eligible_rows), 1)
        progress_state = {"completed_rows": 0}
        progress_lock = asyncio.Lock()

        async def _compute_row(row: MarketRow) -> None:
            async with semaphore:
                symbol_label = row.symbol or row.left_symbol
                right_payload = row.right if isinstance(row.right, dict) else {}
                right_symbol = str(right_payload.get("symbol") or "").upper()
                if not right_symbol:
                    failures.append({"symbol": symbol_label, "reason": "右侧市场缺失"})
                    return

                try:
                    dataset = await self.get_funding_history(
                        left_source=primary,
                        right_source=secondary,
                        left_symbol=row.left_symbol,
                        right_symbol=right_symbol,
                        days=PREDICTION_LOOKBACK_DAYS,
                        left_funding_period_hours=row.left_funding_period_hours,
                        right_funding_period_hours=_parse_float(right_payload.get("funding_period_hours")),
                    )
                except Exception as exc:  # noqa: BLE001
                    failures.append({"symbol": symbol_label, "reason": str(exc)})
                    return

                if not dataset:
                    failures.append({"symbol": symbol_label, "reason": "暂无资金费率历史数据"})
                    return

                latest_time = dataset[-1].time
                lookback_start = latest_time - PREDICTION_LOOKBACK_HOURS * MS_PER_HOUR
                volatility_start = latest_time - PREDICTION_VOLATILITY_WINDOW_HOURS * MS_PER_HOUR
                left_ewma: float | None = None
                right_ewma: float | None = None
                spread_ewma: float | None = None
                left_count = 0
                right_count = 0
                spread_count = 0
                spread_window_samples: list[float] = []
                last_left_time: int | None = None
                last_right_time: int | None = None
                last_spread_time: int | None = None

                for point in dataset:
                    if point.time < lookback_start:
                        continue
                    if point.left is not None and math.isfinite(point.left):
                        if last_left_time is None:
                            left_ewma = point.left
                        else:
                            hours_delta = max((point.time - last_left_time) / MS_PER_HOUR, 0.0)
                            decay = 0.5 ** (hours_delta / PREDICTION_HALF_LIFE_HOURS)
                            left_ewma = point.left * (1 - decay) + (left_ewma or point.left) * decay
                        last_left_time = point.time
                        left_count += 1
                    if point.right is not None and math.isfinite(point.right):
                        if last_right_time is None:
                            right_ewma = point.right
                        else:
                            hours_delta = max((point.time - last_right_time) / MS_PER_HOUR, 0.0)
                            decay = 0.5 ** (hours_delta / PREDICTION_HALF_LIFE_HOURS)
                            right_ewma = point.right * (1 - decay) + (right_ewma or point.right) * decay
                        last_right_time = point.time
                        right_count += 1
                    if point.spread is not None and math.isfinite(point.spread):
                        if last_spread_time is None:
                            spread_ewma = point.spread
                        else:
                            hours_delta = max((point.time - last_spread_time) / MS_PER_HOUR, 0.0)
                            decay = 0.5 ** (hours_delta / PREDICTION_HALF_LIFE_HOURS)
                            spread_ewma = point.spread * (1 - decay) + (spread_ewma or point.spread) * decay
                        last_spread_time = point.time
                        spread_count += 1
                        if point.time >= volatility_start:
                            spread_window_samples.append(point.spread)

                if spread_count == 0:
                    failures.append({"symbol": symbol_label, "reason": "72 小时内有效样本不足"})
                    return
                if len(spread_window_samples) < 2:
                    failures.append({"symbol": symbol_label, "reason": "24 小时波动率样本不足"})
                    return

                average_left_hourly = left_ewma if left_count else None
                average_right_hourly = right_ewma if right_count else None
                average_spread_hourly = spread_ewma or 0.0
                predicted_left_24h = (
                    average_left_hourly * PREDICTION_FORECAST_HOURS
                    if average_left_hourly is not None
                    else None
                )
                predicted_right_24h = (
                    average_right_hourly * PREDICTION_FORECAST_HOURS
                    if average_right_hourly is not None
                    else None
                )
                run_spread_samples = [
                    point.spread
                    for point in dataset
                    if point.time >= lookback_start and point.spread is not None and math.isfinite(point.spread)
                ]
                (
                    predicted_spread_24h,
                    total_decimal,
                    annualized_decimal,
                ) = _compute_run_until_unprofitable_metrics(
                    average_spread_hourly=average_spread_hourly,
                    spread_samples=run_spread_samples,
                )
                spread_volatility_24h_pct = _compute_stddev(spread_window_samples) * math.sqrt(
                    PREDICTION_FORECAST_HOURS,
                )

                left_best_bid = _parse_float(row.best_bid)
                left_best_ask = _parse_float(row.best_ask)
                right_best_bid = _parse_float(right_payload.get("best_bid"))
                right_best_ask = _parse_float(right_payload.get("best_ask"))
                spread_avg = spread_averages.get((row.symbol or row.left_symbol).upper())
                if spread_avg is not None:
                    left_bid_ask_spread_bps = spread_avg["left"]
                    right_bid_ask_spread_bps = spread_avg["right"]
                    combined_bid_ask_spread_bps = spread_avg["combined"]
                    spread_sample_price_volatility = spread_avg.get(
                        "price_volatility_24h_pct",
                        DEFAULT_FALLBACK_PRICE_VOLATILITY_PCT,
                    )
                    price_volatility_24h_pct = spread_sample_price_volatility
                    left_spread_samples_bps = list(spread_avg.get("left_spread_samples_bps", []))
                    right_spread_samples_bps = list(spread_avg.get("right_spread_samples_bps", []))
                    combined_spread_samples_bps = list(spread_avg.get("combined_spread_samples_bps", []))
                else:
                    left_bid_ask_spread_bps = _compute_bid_ask_spread_bps(
                        left_best_bid,
                        left_best_ask,
                        default_bps=DEFAULT_FALLBACK_BID_ASK_SPREAD_BPS,
                    )
                    right_bid_ask_spread_bps = _compute_bid_ask_spread_bps(
                        right_best_bid,
                        right_best_ask,
                        default_bps=DEFAULT_FALLBACK_BID_ASK_SPREAD_BPS,
                    )
                    combined_bid_ask_spread_bps = left_bid_ask_spread_bps + right_bid_ask_spread_bps
                    price_volatility_24h_pct = DEFAULT_FALLBACK_PRICE_VOLATILITY_PCT
                    left_spread_samples_bps = [left_bid_ask_spread_bps]
                    right_spread_samples_bps = [right_bid_ask_spread_bps]
                    combined_spread_samples_bps = [combined_bid_ask_spread_bps]

                if price_volatility_24h_pct > MAX_ACCEPTABLE_PRICE_VOLATILITY_PCT:
                    failures.append(
                        {
                            "symbol": symbol_label,
                            "reason": f"价格波动率过高（>{MAX_ACCEPTABLE_PRICE_VOLATILITY_PCT:.1f}%）",
                        }
                    )
                    return

                direction = "unknown"
                if average_spread_hourly > 0:
                    direction = "leftLong"
                elif average_spread_hourly < 0:
                    direction = "rightLong"

                raw_entries.append(
                    {
                        "symbol": row.symbol or row.left_symbol,
                        "display_name": row.display_name or row.symbol or row.left_symbol,
                        "left_symbol": row.left_symbol,
                        "right_symbol": right_symbol,
                        "left_volume_24h": row.day_notional_volume,
                        "right_volume_24h": _parse_float(right_payload.get("volume_usd")),
                        "predicted_left_24h": predicted_left_24h,
                        "predicted_right_24h": predicted_right_24h,
                        "predicted_spread_24h": predicted_spread_24h,
                        "average_left_hourly": average_left_hourly,
                        "average_right_hourly": average_right_hourly,
                        "average_spread_hourly": average_spread_hourly,
                        "total_decimal": total_decimal,
                        "annualized_decimal": annualized_decimal,
                        "spread_volatility_24h_pct": spread_volatility_24h_pct,
                        "price_volatility_24h_pct": price_volatility_24h_pct,
                        "left_bid_ask_spread_bps": left_bid_ask_spread_bps,
                        "right_bid_ask_spread_bps": right_bid_ask_spread_bps,
                        "combined_bid_ask_spread_bps": combined_bid_ask_spread_bps,
                        "left_spread_samples_bps": left_spread_samples_bps,
                        "right_spread_samples_bps": right_spread_samples_bps,
                        "combined_spread_samples_bps": combined_spread_samples_bps,
                        "sample_count": spread_count,
                        "direction": direction,
                    }
                )

                async with progress_lock:
                    progress_state["completed_rows"] += 1
                    completed_rows_value = progress_state["completed_rows"]
                await _invoke_progress_callback(
                    progress_callback,
                    90 + (completed_rows_value / total_rows) * 10,
                    f"计算币种 {completed_rows_value}/{total_rows}",
                )

        await asyncio.gather(*(_compute_row(row) for row in eligible_rows))

        apr_values = [float(entry.get("annualized_decimal") or 0.0) for entry in raw_entries]
        funding_volatility_values = [
            float(entry.get("spread_volatility_24h_pct") or 0.0)
            for entry in raw_entries
        ]
        price_volatility_values = [
            float(entry.get("price_volatility_24h_pct") or 0.0)
            for entry in raw_entries
        ]
        final_entries: list[dict[str, Any]] = []
        for entry in raw_entries:
            apr_norm = _min_max_normalize(float(entry.get("annualized_decimal") or 0.0), apr_values)
            funding_volatility_norm = _min_max_normalize(
                float(entry.get("spread_volatility_24h_pct") or 0.0),
                funding_volatility_values,
            )
            price_volatility_norm = _min_max_normalize(
                float(entry.get("price_volatility_24h_pct") or 0.0),
                price_volatility_values,
            )
            left_spread_acceptance_score = _compute_spread_acceptance_score(
                float(entry.get("left_bid_ask_spread_bps") or 0.0)
            )
            right_spread_acceptance_score = _compute_spread_acceptance_score(
                float(entry.get("right_bid_ask_spread_bps") or 0.0)
            )
            spread_acceptance_score = left_spread_acceptance_score * right_spread_acceptance_score
            core_score = (
                RECOMMENDATION_APR_WEIGHT * apr_norm
                + RECOMMENDATION_FUNDING_VOLATILITY_WEIGHT * (1.0 - funding_volatility_norm)
                + RECOMMENDATION_PRICE_VOLATILITY_WEIGHT * (1.0 - price_volatility_norm)
            )
            score = core_score * spread_acceptance_score * 100.0
            normalized_entry = dict(entry)
            normalized_entry["recommendation_score"] = round(score, 4)
            final_entries.append(normalized_entry)

        final_entries.sort(
            key=lambda entry: (
                float(entry.get("recommendation_score") or 0.0),
                float(entry.get("annualized_decimal") or 0.0),
            ),
            reverse=True,
        )

        response = FundingPredictionResponse(
            entries=final_entries,
            failures=failures,
            fetched_at=fetched_at,
            errors=snapshot.errors,
        )
        self._prediction_cache[cache_key] = (time(), response)
        await _invoke_progress_callback(progress_callback, 100.0, "计算完成")
        return response

    async def get_arbitrage_snapshot(
        self,
        primary: str,
        secondary: str,
        volume_threshold: float = 0.0,
        force_refresh: bool = False,
    ) -> ArbitrageSnapshotResponse:
        """
        Compute 24h arbitrage annualized metrics server-side using funding history.
        """
        cache_key = (primary, secondary, float(volume_threshold))
        if not force_refresh:
            cached = self._arbitrage_cache.get(cache_key)
            if cached and time() - cached[0] < CACHE_TTL_SECONDS:
                return cached[1]

        snapshot = await self.get_perp_snapshot(primary, secondary)
        fetched_at = snapshot.fetched_at
        volume_cutoff = max(volume_threshold, 0.0)
        entries: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []

        def _passes_volume(row: MarketRow) -> bool:
            if volume_cutoff <= 0:
                return True
            left_volume = _parse_float(row.day_notional_volume) or 0.0
            right_payload = row.right if isinstance(row.right, dict) else None
            right_volume = _parse_float(right_payload.get("volume_usd")) if right_payload else None
            return left_volume + (right_volume or 0.0) >= volume_cutoff

        eligible_rows = [
            row
            for row in snapshot.rows
            if isinstance(row.right, dict) and row.right.get("symbol") and _passes_volume(row)
        ]

        semaphore = asyncio.Semaphore(MAX_ARBITRAGE_WORKERS)

        async def _compute_row(row: MarketRow) -> None:
            async with semaphore:
                symbol_label = row.symbol or row.left_symbol
                right_payload = row.right if isinstance(row.right, dict) else {}
                right_symbol = str(right_payload.get("symbol") or "").upper()
                if not right_symbol:
                    failures.append({"symbol": symbol_label, "reason": "右侧市场缺失"})
                    return

                try:
                    dataset = await self.get_funding_history(
                        left_source=primary,
                        right_source=secondary,
                        left_symbol=row.left_symbol,
                        right_symbol=right_symbol,
                        days=ARBITRAGE_LOOKBACK_DAYS,
                        left_funding_period_hours=row.left_funding_period_hours,
                        right_funding_period_hours=_parse_float(right_payload.get("funding_period_hours")),
                    )
                except Exception as exc:  # noqa: BLE001
                    failures.append({"symbol": symbol_label, "reason": str(exc)})
                    return

                if not dataset:
                    failures.append({"symbol": symbol_label, "reason": "暂无资金费率历史数据"})
                    return

                latest_time = dataset[-1].time
                lookback_start = latest_time - ARBITRAGE_LOOKBACK_HOURS * MS_PER_HOUR
                sample_count = 0
                total_decimal = 0.0
                directional_sum = 0.0

                for point in dataset:
                    if point.time < lookback_start:
                        continue
                    if point.spread is None or not math.isfinite(point.spread):
                        continue
                    decimal_spread = abs(point.spread) / 100.0
                    total_decimal += decimal_spread
                    directional_sum += point.spread
                    sample_count += 1

                if sample_count == 0 or total_decimal == 0:
                    failures.append({"symbol": symbol_label, "reason": "24 小时内有效样本不足"})
                    return

                average_hourly_decimal = total_decimal / sample_count
                annualized_decimal = average_hourly_decimal * ARBITRAGE_HOURS_PER_YEAR
                direction = "unknown"
                if directional_sum > 0:
                    direction = "leftLong"
                elif directional_sum < 0:
                    direction = "rightLong"

                entries.append(
                    {
                        "symbol": row.symbol or row.left_symbol,
                        "display_name": row.display_name or row.symbol or row.left_symbol,
                        "left_symbol": row.left_symbol,
                        "right_symbol": right_symbol,
                        "left_volume_24h": row.day_notional_volume,
                        "right_volume_24h": _parse_float(right_payload.get("volume_usd")),
                        "total_decimal": total_decimal,
                        "average_hourly_decimal": average_hourly_decimal,
                        "annualized_decimal": annualized_decimal,
                        "sample_count": sample_count,
                        "direction": direction,
                    }
                )

        await asyncio.gather(*(_compute_row(row) for row in eligible_rows))

        entries.sort(key=lambda entry: entry.get("annualized_decimal", 0), reverse=True)

        response = ArbitrageSnapshotResponse(
            entries=entries,
            failures=failures,
            fetched_at=fetched_at,
            errors=snapshot.errors,
        )
        self._arbitrage_cache[cache_key] = (time(), response)
        return response

    async def fetch_exchange_snapshot(
        self,
        source: str,
        candidate_bases: set[str] | None = None,
    ) -> ExchangeSnapshot:
        provider = source.lower()
        if provider == "hyperliquid":
            return await self._fetch_hyperliquid_markets()
        if provider == "lighter":
            return await self._fetch_lighter_markets()
        if provider == "grvt":
            return await self._fetch_grvt_markets(candidate_bases=candidate_bases)
        return ExchangeSnapshot(markets=[], errors=[ApiError(source=source, message="Unsupported provider")])

    async def get_perp_snapshot(self, primary: str, secondary: str) -> PerpSnapshot:
        primary_provider = primary.lower()
        secondary_provider = secondary.lower()

        # Prefer candidate-based GRVT snapshot to avoid full-universe ticker calls.
        if secondary_provider == "grvt" and primary_provider != "grvt":
            primary_snapshot = await self.fetch_exchange_snapshot(primary)
            candidate_bases = {
                market.base_symbol.upper()
                for market in primary_snapshot.markets
                if market.base_symbol
            }
            secondary_snapshot = await self.fetch_exchange_snapshot(
                secondary,
                candidate_bases=candidate_bases,
            )
        elif primary_provider == "grvt" and secondary_provider != "grvt":
            secondary_snapshot = await self.fetch_exchange_snapshot(secondary)
            candidate_bases = {
                market.base_symbol.upper()
                for market in secondary_snapshot.markets
                if market.base_symbol
            }
            primary_snapshot = await self.fetch_exchange_snapshot(
                primary,
                candidate_bases=candidate_bases,
            )
        else:
            primary_snapshot, secondary_snapshot = await asyncio.gather(
                self.fetch_exchange_snapshot(primary),
                self.fetch_exchange_snapshot(secondary),
            )

        api_errors = [*primary_snapshot.errors, *secondary_snapshot.errors]
        candidate_symbols: set[str] = set()
        for market in primary_snapshot.markets:
            symbol = (market.base_symbol or market.symbol or "").upper()
            if symbol:
                candidate_symbols.add(_normalize_derivatives_base(symbol))
        for market in secondary_snapshot.markets:
            symbol = (market.base_symbol or market.symbol or "").upper()
            if symbol:
                candidate_symbols.add(_normalize_derivatives_base(symbol))
        price_change_fallbacks = await self._fetch_binance_price_change_fallbacks(candidate_symbols)
        secondary_by_base: dict[str, ExchangeMarketMetrics] = {}
        for market in secondary_snapshot.markets:
            if market.base_symbol:
                secondary_by_base[market.base_symbol] = market

        rows: list[MarketRow] = []
        for left_market in primary_snapshot.markets:
            base_symbol = left_market.base_symbol or left_market.symbol
            matching_right = secondary_by_base.get(base_symbol) if base_symbol else None
            combined_volume = None
            left_volume = left_market.day_notional_volume
            right_volume = matching_right.volume_usd if matching_right else None
            if left_volume is not None or right_volume is not None:
                combined_volume = (left_volume or 0.0) + (right_volume or 0.0)

            right_payload = None
            if matching_right:
                right_payload = {
                    "source": secondary,
                    "symbol": matching_right.symbol,
                    "max_leverage": matching_right.max_leverage,
                    "funding_rate": matching_right.funding_rate_hourly,
                    "volume_usd": matching_right.volume_usd,
                    "funding_period_hours": matching_right.funding_period_hours,
                    "mark_price": matching_right.mark_price,
                    "price_change_1h": matching_right.price_change_1h,
                    "price_change_24h": matching_right.price_change_24h,
                    "price_change_7d": matching_right.price_change_7d,
                    "best_bid": matching_right.best_bid,
                    "best_ask": matching_right.best_ask,
                }
            fallback = price_change_fallbacks.get((base_symbol or "").upper(), {})
            fallback_mark_price = _parse_float(fallback.get("mark_price"))
            fallback_change_1h = _parse_float(fallback.get("price_change_1h"))
            fallback_change_24h = _parse_float(fallback.get("price_change_24h"))
            fallback_change_7d = _parse_float(fallback.get("price_change_7d"))

            rows.append(
                MarketRow(
                    left_provider=primary,
                    right_provider=secondary,
                    left_symbol=left_market.symbol,
                    left_funding_period_hours=left_market.funding_period_hours,
                    symbol=base_symbol,
                    display_name=left_market.display_name or base_symbol,
                    icon_url=None,
                    mark_price=(
                        left_market.mark_price
                        if left_market.mark_price is not None
                        else (
                            matching_right.mark_price
                            if matching_right and matching_right.mark_price is not None
                            else fallback_mark_price
                        )
                    ),
                    price_change_1h=left_market.price_change_1h if left_market.price_change_1h is not None else (
                        matching_right.price_change_1h
                        if matching_right and matching_right.price_change_1h is not None
                        else fallback_change_1h
                    ),
                    price_change_24h=left_market.price_change_24h if left_market.price_change_24h is not None else (
                        matching_right.price_change_24h
                        if matching_right and matching_right.price_change_24h is not None
                        else fallback_change_24h
                    ),
                    price_change_7d=left_market.price_change_7d if left_market.price_change_7d is not None else (
                        matching_right.price_change_7d
                        if matching_right and matching_right.price_change_7d is not None
                        else fallback_change_7d
                    ),
                    max_leverage=left_market.max_leverage,
                    funding_rate=left_market.funding_rate_hourly,
                    day_notional_volume=left_market.day_notional_volume,
                    open_interest=left_market.open_interest,
                    volume_usd=combined_volume,
                    best_bid=left_market.best_bid,
                    best_ask=left_market.best_ask,
                    right=right_payload,
                )
            )

        rows.sort(
            key=lambda row: (
                0
                - (
                    row.volume_usd
                    or row.day_notional_volume
                    or 0
                )
            )
        )
        icon_map = await self._resolve_symbol_icon_urls(
            {
                _normalize_icon_symbol(row.symbol or row.left_symbol)
                for row in rows
                if (row.symbol or row.left_symbol)
            }
        )
        for row in rows:
            symbol_key = _normalize_icon_symbol(row.symbol or row.left_symbol)
            row.icon_url = icon_map.get(symbol_key)

        return PerpSnapshot(rows=rows, fetched_at=datetime.now(tz=timezone.utc), errors=api_errors)

    async def _resolve_symbol_icon_urls(self, symbols: set[str]) -> dict[str, str | None]:
        normalized_symbols = {symbol for symbol in symbols if symbol}
        if not normalized_symbols:
            return {}

        now = time()
        result: dict[str, str | None] = {}
        missing: set[str] = set()
        for symbol in normalized_symbols:
            cached = self._icon_url_cache.get(symbol)
            if cached and now - cached[0] < ICON_URL_CACHE_TTL_SECONDS:
                result[symbol] = cached[1]
            else:
                missing.add(symbol)

        if not missing:
            return result

        db_rows_by_symbol = self._load_asset_icons_from_db(missing)
        unresolved: set[str] = set()
        for symbol in missing:
            if symbol in db_rows_by_symbol:
                icon_url = db_rows_by_symbol[symbol]
                result[symbol] = icon_url
                self._icon_url_cache[symbol] = (time(), icon_url)
            else:
                unresolved.add(symbol)

        if not unresolved:
            return result

        semaphore = asyncio.Semaphore(ICON_DISCOVERY_CONCURRENCY)
        discovered: dict[str, tuple[str | None, str | None]] = {}

        async def _discover_one(symbol: str) -> None:
            async with semaphore:
                icon_url, source = await self._discover_icon_url(symbol)
            discovered[symbol] = (icon_url, source)
            result[symbol] = icon_url
            self._icon_url_cache[symbol] = (time(), icon_url)

        await asyncio.gather(*(_discover_one(symbol) for symbol in unresolved))
        self._persist_asset_icons_to_db(discovered)
        return result

    def _load_asset_icons_from_db(self, symbols: set[str]) -> dict[str, str | None]:
        if not symbols:
            return {}
        try:
            engine = get_engine()
        except Exception:
            return {}

        with Session(engine) as session:
            records = session.exec(
                select(AssetIcon).where(
                    AssetIcon.symbol.in_(symbols),
                    AssetIcon.deleted_at.is_(None),
                )
            ).all()
            return {record.symbol.upper(): record.icon_url for record in records}

    def _persist_asset_icons_to_db(self, discovered: dict[str, tuple[str | None, str | None]]) -> None:
        if not discovered:
            return
        try:
            engine = get_engine()
        except Exception:
            return

        now = datetime.utcnow()
        with Session(engine) as session:
            existing_rows = session.exec(
                select(AssetIcon).where(
                    AssetIcon.symbol.in_(set(discovered.keys())),
                )
            ).all()
            existing_by_symbol = {row.symbol.upper(): row for row in existing_rows}

            for symbol, (icon_url, source) in discovered.items():
                existing = existing_by_symbol.get(symbol)
                if existing is not None:
                    existing.icon_url = icon_url
                    existing.source = source
                    existing.last_checked_at = now
                    existing.updated_at = now
                    if existing.deleted_at is not None:
                        existing.deleted_at = None
                    session.add(existing)
                    continue

                session.add(
                    AssetIcon(
                        symbol=symbol,
                        icon_url=icon_url,
                        source=source,
                        last_checked_at=now,
                        created_at=now,
                        updated_at=now,
                    )
                )
            session.commit()

    async def _discover_icon_url(self, symbol: str) -> tuple[str | None, str | None]:
        tasks: list[asyncio.Task[tuple[str | None, str | None]]] = []
        for url in _build_icon_candidate_urls(symbol):
            tasks.append(asyncio.create_task(self._probe_icon_url_candidate(url, _infer_icon_source(url))))
        tasks.append(asyncio.create_task(self._probe_coingecko_icon_candidate(symbol)))

        if not tasks:
            return None, None

        try:
            for done in asyncio.as_completed(tasks):
                icon_url, source = await done
                if icon_url:
                    for task in tasks:
                        if not task.done():
                            task.cancel()
                    return icon_url, source
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
        return None, None

    async def _probe_icon_url_candidate(self, url: str, source: str | None) -> tuple[str | None, str | None]:
        if await self._is_icon_url_reachable(url):
            return url, source
        return None, None

    async def _probe_coingecko_icon_candidate(self, symbol: str) -> tuple[str | None, str | None]:
        coingecko_icon = await self._resolve_coingecko_icon_url(symbol)
        if coingecko_icon and await self._is_icon_url_reachable(coingecko_icon):
            return coingecko_icon, "coingecko"
        return None, None

    async def _resolve_coingecko_icon_url(self, symbol: str) -> str | None:
        normalized = _normalize_icon_symbol(symbol).lower()
        if not normalized:
            return None
        symbol_map = await self._get_coingecko_symbol_map()
        coin_ids = symbol_map.get(normalized, [])
        if not coin_ids:
            return None

        headers: dict[str, str] = {}
        if self._coingecko_api_key:
            headers["x-cg-demo-api-key"] = self._coingecko_api_key

        # Try a few candidates for ambiguous symbols, then stop.
        for coin_id in coin_ids[:3]:
            try:
                response = await self._client.get(
                    f"https://api.coingecko.com/api/v3/coins/{coin_id}",
                    params={
                        "localization": "false",
                        "tickers": "false",
                        "market_data": "false",
                        "community_data": "false",
                        "developer_data": "false",
                        "sparkline": "false",
                    },
                    headers=headers,
                )
                if response.status_code != 200:
                    continue
                payload = response.json()
                image = payload.get("image") if isinstance(payload, dict) else None
                if not isinstance(image, dict):
                    continue
                icon_url = (
                    image.get("large")
                    or image.get("small")
                    or image.get("thumb")
                )
                if isinstance(icon_url, str) and icon_url:
                    return icon_url
            except Exception:
                continue
        return None

    async def _get_coingecko_symbol_map(self) -> dict[str, list[str]]:
        now = time()
        if (
            self._coingecko_symbol_to_ids_cache is not None
            and now - self._coingecko_symbol_to_ids_cache[0] < COINGECKO_SYMBOL_MAP_TTL_SECONDS
        ):
            return self._coingecko_symbol_to_ids_cache[1]

        headers: dict[str, str] = {}
        if self._coingecko_api_key:
            headers["x-cg-demo-api-key"] = self._coingecko_api_key

        try:
            response = await self._client.get(
                "https://api.coingecko.com/api/v3/coins/list",
                params={"include_platform": "false"},
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception:
            return {}

        symbol_map: dict[str, list[str]] = defaultdict(list)
        if isinstance(payload, list):
            for entry in payload:
                if not isinstance(entry, dict):
                    continue
                symbol = str(entry.get("symbol") or "").strip().lower()
                coin_id = str(entry.get("id") or "").strip()
                if not symbol or not coin_id:
                    continue
                symbol_map[symbol].append(coin_id)

        normalized_map = {key: value for key, value in symbol_map.items()}
        self._coingecko_symbol_to_ids_cache = (now, normalized_map)
        return normalized_map

    async def _is_icon_url_reachable(self, url: str) -> bool:
        try:
            response = await self._client.head(url, follow_redirects=True, timeout=5.0)
            if response.status_code == 200:
                content_type = response.headers.get("content-type", "").lower()
                if content_type.startswith("image/") or "octet-stream" in content_type:
                    return True
                # Some providers do not return content-type on HEAD.
                if not content_type:
                    return True
        except Exception:
            pass

        try:
            response = await self._client.get(url, follow_redirects=True, timeout=5.0)
            if response.status_code != 200:
                return False
            content_type = response.headers.get("content-type", "").lower()
            if content_type.startswith("image/") or "octet-stream" in content_type:
                return True
            # Fallback for providers returning ambiguous content-types.
            return bool(response.content)
        except Exception:
            return False

    async def _fetch_binance_price_change_fallbacks(
        self,
        symbols: set[str],
    ) -> dict[str, dict[str, float | None]]:
        normalized_symbols = {_normalize_derivatives_base(symbol) for symbol in symbols if symbol}
        if not normalized_symbols:
            return {}

        now = time()
        result: dict[str, dict[str, float | None]] = {}
        missing: set[str] = set()
        for symbol in normalized_symbols:
            cached = self._binance_price_cache.get(symbol)
            if cached and now - cached[0] < BINANCE_PRICE_CACHE_TTL_SECONDS:
                result[symbol] = dict(cached[1])
            else:
                missing.add(symbol)

        if not missing:
            return result

        ticker_24h_map: dict[str, tuple[float | None, float | None]] = {}
        try:
            resp = await self._client.get("https://fapi.binance.com/fapi/v1/ticker/24hr")
            resp.raise_for_status()
            payload = resp.json()
            if isinstance(payload, list):
                for entry in payload:
                    if not isinstance(entry, dict):
                        continue
                    symbol = str(entry.get("symbol") or "").upper()
                    if not symbol.endswith("USDT"):
                        continue
                    base = symbol.removesuffix("USDT")
                    if base not in missing:
                        continue
                    ticker_24h_map[base] = (
                        _parse_float(entry.get("lastPrice")),
                        _parse_float(entry.get("priceChangePercent")),
                    )
        except Exception:
            ticker_24h_map = {}

        async def _fill_symbol(base_symbol: str) -> None:
            mark_price, change_24h = ticker_24h_map.get(base_symbol, (None, None))
            value = {
                "mark_price": mark_price,
                "price_change_1h": None,
                "price_change_24h": change_24h,
                "price_change_7d": None,
            }
            self._binance_price_cache[base_symbol] = (time(), value)
            result[base_symbol] = value

        await asyncio.gather(*(_fill_symbol(base_symbol) for base_symbol in missing))
        return result

    async def _get_lighter_leverage_map(self) -> dict[str, float]:
        if self._lighter_leverage_map is not None:
            return self._lighter_leverage_map

        url = "https://docs.lighter.xyz/trading/contract-specifications.md"
        overrides: dict[str, float] = {
            "MON": 5,
            "WLFI": 5,
            "SKY": 3,
            "MEGA": 3,
            "KPEPE": 10,
            "KSHIB": 10,
            "KBONK": 10,
        }
        try:
            response = await self._client.get(url)
            response.raise_for_status()
            markdown = response.text
            leverage_map = _parse_lighter_leverage_markdown(markdown, overrides)
            self._lighter_leverage_map = leverage_map
            return leverage_map
        except Exception:  # noqa: BLE001
            return overrides

    def _build_grvt_endpoints(self, env: str) -> tuple[str, str]:
        env_lower = env.lower()
        if env_lower == "prod":
            base = "https://market-data.grvt.io"
            trade_base = "https://trades.grvt.io"
        elif env_lower == "testnet":
            base = "https://market-data.testnet.grvt.io"
            trade_base = "https://trades.testnet.grvt.io"
        elif env_lower == "staging":
            base = "https://market-data.staging.gravitymarkets.io"
            trade_base = "https://trades.staging.gravitymarkets.io"
        elif env_lower == "dev":
            base = "https://market-data.dev.gravitymarkets.io"
            trade_base = "https://trades.dev.gravitymarkets.io"
        else:
            base = "https://market-data.grvt.io"
            trade_base = "https://trades.grvt.io"
        return base, trade_base


def _parse_lighter_leverage_markdown(markdown: str, overrides: dict[str, float]) -> dict[str, float]:
    leverage_map: dict[str, float] = {}
    # Apply overrides first
    for sym, lev in overrides.items():
        leverage_map[sym] = lev
        leverage_map[f"{sym}-PERP"] = lev

    row_regex = re.compile(r"<tr>(.*?)</tr>", re.S)
    cell_regex = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
    for row_match in row_regex.finditer(markdown):
        cells = [re.sub(r"<[^>]+>", " ", c).replace("&nbsp;", " ").strip() for c in cell_regex.findall(row_match.group(1))]
        if len(cells) < 4:
            continue
        symbol = cells[0].strip().upper()
        leverage_raw = cells[3].strip()
        if not symbol or symbol in {"SYMBOL", "LEVERAGE"}:
            continue
        lev_match = re.search(r"([\d.]+)\s*x", leverage_raw, re.I)
        if not lev_match:
            continue
        try:
            value = float(lev_match.group(1))
        except Exception:
            continue
        if math.isfinite(value):
            leverage_map[symbol] = value
            leverage_map[f"{symbol}-PERP"] = value
    return leverage_map


def _extract_best_bid_ask(payload: dict[str, Any]) -> tuple[float | None, float | None]:
    best_bid = _parse_float(
        payload.get("best_bid")
        or payload.get("bestBid")
        or payload.get("best_bid_price")
        or payload.get("bid")
        or payload.get("bid_price")
    )
    best_ask = _parse_float(
        payload.get("best_ask")
        or payload.get("bestAsk")
        or payload.get("best_ask_price")
        or payload.get("ask")
        or payload.get("ask_price")
    )

    if best_bid is None:
        bids = payload.get("bids")
        if isinstance(bids, list) and bids:
            best_bid = _extract_level_price(bids[0])

    if best_ask is None:
        asks = payload.get("asks")
        if isinstance(asks, list) and asks:
            best_ask = _extract_level_price(asks[0])

    return best_bid, best_ask


def _extract_price_change_fields(
    payload: dict[str, Any],
    mark_price: float | None = None,
) -> tuple[float | None, float | None, float | None]:
    current_price = mark_price
    if current_price is None:
        current_price = _parse_float(
            payload.get("mark_price")
            or payload.get("markPrice")
            or payload.get("last_price")
            or payload.get("lastPrice")
            or payload.get("index_price")
            or payload.get("indexPrice")
            or payload.get("price")
        )

    change_1h = _extract_pct_value(
        payload,
        ["price_change_1h", "price_change_1h_pct", "price_change_percent_1h", "change_1h", "change_1h_pct"],
    )
    change_24h = _extract_pct_value(
        payload,
        ["price_change_24h", "price_change_24h_pct", "price_change_percent_24h", "change_24h", "change_24h_pct"],
    )
    change_7d = _extract_pct_value(
        payload,
        ["price_change_7d", "price_change_7d_pct", "price_change_percent_7d", "change_7d", "change_7d_pct"],
    )

    if change_1h is None:
        open_1h = _parse_float(payload.get("open_price_1h") or payload.get("open_1h"))
        change_1h = _compute_change_pct_from_open(current_price, open_1h)
    if change_24h is None:
        open_24h = _parse_float(
            payload.get("open_price_24h")
            or payload.get("open_24h")
            or payload.get("open_price")
            or payload.get("day_open_price")
        )
        change_24h = _compute_change_pct_from_open(current_price, open_24h)
    if change_7d is None:
        open_7d = _parse_float(payload.get("open_price_7d") or payload.get("open_7d"))
        change_7d = _compute_change_pct_from_open(current_price, open_7d)

    return change_1h, change_24h, change_7d


def _extract_pct_value(payload: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        if key not in payload:
            continue
        value = _parse_float(payload.get(key))
        if value is None:
            continue
        normalized = _normalize_pct_value(value, key)
        if normalized is not None:
            return normalized
    return None


def _normalize_pct_value(value: float, key: str) -> float | None:
    if not math.isfinite(value):
        return None
    lower_key = key.lower()
    if ("pct" in lower_key or "percent" in lower_key or "percentage" in lower_key) and abs(value) > 1.0:
        return value
    # Non-explicit fields are often decimal ratios; convert tiny absolute values to percentage points.
    if abs(value) <= 1.0 and "pct" not in lower_key and "percent" not in lower_key and "percentage" not in lower_key:
        return value * 100.0
    return value


def _compute_change_pct_from_open(current_price: float | None, open_price: float | None) -> float | None:
    if current_price is None or open_price is None:
        return None
    if current_price <= 0 or open_price <= 0:
        return None
    return ((current_price - open_price) / open_price) * 100.0


def _extract_level_price(level: Any) -> float | None:
    if isinstance(level, dict):
        return _parse_float(level.get("price") or level.get("p") or level.get("px"))
    if isinstance(level, (list, tuple)) and level:
        return _parse_float(level[0])
    return None


def _compute_stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return math.sqrt(max(variance, 0.0))


def _compute_bid_ask_spread_bps(
    best_bid: float | None,
    best_ask: float | None,
    default_bps: float = DEFAULT_FALLBACK_BID_ASK_SPREAD_BPS,
) -> float:
    if best_bid is None or best_ask is None:
        return default_bps
    if best_bid <= 0 or best_ask <= 0 or best_ask < best_bid:
        return default_bps
    mid = (best_bid + best_ask) / 2.0
    if mid <= 0:
        return default_bps
    return (best_ask - best_bid) / mid * 10_000.0


def _compute_mid_price(
    best_bid: float | None,
    best_ask: float | None,
    fallback_price: float | None = None,
) -> float | None:
    if (
        best_bid is not None
        and best_ask is not None
        and best_bid > 0
        and best_ask > 0
        and best_ask >= best_bid
    ):
        return (best_bid + best_ask) / 2.0
    if fallback_price is not None and fallback_price > 0:
        return fallback_price
    return None


def _combine_mid_prices(left_mid: float | None, right_mid: float | None) -> float | None:
    if left_mid is not None and right_mid is not None and left_mid > 0 and right_mid > 0:
        return (left_mid + right_mid) / 2.0
    if left_mid is not None and left_mid > 0:
        return left_mid
    if right_mid is not None and right_mid > 0:
        return right_mid
    return None


def _compute_price_volatility_24h_pct(
    mid_samples: list[float],
    interval_seconds: int,
    default_value: float = DEFAULT_FALLBACK_PRICE_VOLATILITY_PCT,
) -> float:
    if len(mid_samples) < 2:
        return default_value

    returns: list[float] = []
    for idx in range(1, len(mid_samples)):
        prev = mid_samples[idx - 1]
        curr = mid_samples[idx]
        if prev <= 0 or curr <= 0:
            continue
        returns.append(math.log(curr / prev))

    if len(returns) < 2:
        return default_value

    per_step_vol = _compute_stddev(returns)
    steps_per_24h = (24 * 60 * 60) / max(interval_seconds, 1)
    return per_step_vol * math.sqrt(steps_per_24h) * 100.0


def _compute_run_until_unprofitable_metrics(
    average_spread_hourly: float,
    spread_samples: list[float],
) -> tuple[float, float, float]:
    """
    Estimate return profile for: enter on current favorable direction, hold until spread loses sign.
    Returns:
    - predicted_spread_24h (%)
    - total_decimal (expected cycle return as decimal)
    - annualized_decimal (cycle return / cycle time annualized)
    """
    if not spread_samples or not math.isfinite(average_spread_hourly) or average_spread_hourly == 0:
        return 0.0, 0.0, 0.0

    current_sign = 1 if average_spread_hourly > 0 else -1
    runs: list[tuple[int, float]] = []
    run_hours = 0
    run_abs_sum_pct = 0.0

    for spread in spread_samples:
        if not math.isfinite(spread) or spread == 0:
            continue
        sign = 1 if spread > 0 else -1
        if sign == current_sign:
            run_hours += 1
            run_abs_sum_pct += abs(spread)
            continue
        if run_hours > 0:
            runs.append((run_hours, run_abs_sum_pct))
            run_hours = 0
            run_abs_sum_pct = 0.0

    if run_hours > 0:
        runs.append((run_hours, run_abs_sum_pct))

    if not runs:
        run_hours = 1
        run_abs_sum_pct = abs(average_spread_hourly)
    else:
        run_hours = max(int(round(sum(hours for hours, _ in runs) / len(runs))), 1)
        run_abs_sum_pct = max(sum(abs_sum for _, abs_sum in runs) / len(runs), 0.0)

    cycle_return_decimal = run_abs_sum_pct / 100.0
    average_hourly_decimal = cycle_return_decimal / run_hours if run_hours > 0 else 0.0
    annualized_decimal = average_hourly_decimal * PREDICTION_HOURS_PER_YEAR
    predicted_spread_24h = average_hourly_decimal * 100.0 * PREDICTION_FORECAST_HOURS
    return predicted_spread_24h, cycle_return_decimal, annualized_decimal


def _compute_spread_acceptance_score(
    spread_bps: float,
    intolerable_bps: float = SPREAD_INTOLERABLE_BPS,
    steepness_bps: float = SPREAD_STEEPNESS_BPS,
) -> float:
    """
    Map spread to [0,1] with a steep sigmoid drop near the intolerable threshold.
    <= threshold keeps high score; > threshold decays rapidly.
    """
    if not math.isfinite(spread_bps):
        return 0.0
    if steepness_bps <= 0:
        steepness_bps = 1.0
    x = (spread_bps - intolerable_bps) / steepness_bps
    score = 1.0 / (1.0 + math.exp(x))
    return min(max(score, 0.0), 1.0)


def _min_max_normalize(value: float, population: list[float]) -> float:
    if not population:
        return 0.0
    min_value = min(population)
    max_value = max(population)
    span = max_value - min_value
    if span <= 1e-12:
        return 0.5
    return min(max((value - min_value) / span, 0.0), 1.0)


async def _invoke_progress_callback(
    callback: Callable[[float, str], Awaitable[None] | None] | None,
    progress: float,
    stage: str,
) -> None:
    if callback is None:
        return
    safe_progress = min(max(progress, 0.0), 100.0)
    maybe_awaitable = callback(safe_progress, stage)
    if maybe_awaitable is not None and asyncio.iscoroutine(maybe_awaitable):
        await maybe_awaitable


def _format_exception(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        return message
    return exc.__class__.__name__


def _normalize_timestamp_to_hour(value: Any) -> int | None:
    try:
        ts = int(float(value))
    except Exception:  # noqa: BLE001
        return None
    return (ts // MS_PER_HOUR) * MS_PER_HOUR


def _normalize_lighter_symbol(value: str | None) -> str:
    return value.strip().upper() if value else ""


def _normalize_lighter_symbol_for_book(value: str | None) -> str:
    normalized = _normalize_lighter_symbol(value)
    if normalized.endswith("-PERP"):
        return normalized.removesuffix("-PERP")
    return normalized


def _normalize_icon_symbol(symbol: str | None) -> str:
    if not symbol:
        return ""
    normalized = symbol.upper().strip()
    normalized = re.sub(r"[-_/]?PERP$", "", normalized)
    normalized = re.split(r"[-_/]", normalized)[0]
    aliases = {
        "XBT": "BTC",
        "WBTC": "BTC",
        "WETH": "ETH",
    }
    return aliases.get(normalized, normalized)


def _build_icon_candidate_urls(symbol: str) -> list[str]:
    normalized = _normalize_icon_symbol(symbol)
    if not normalized:
        return []
    lower = normalized.lower()
    # Multi-source dynamic discovery; do not rely on static per-symbol mappings.
    urls = [
        f"https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/{lower}.png",
        f"https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/{lower}.png",
        f"https://assets.coincap.io/assets/icons/{lower}@2x.png",
        f"https://coinicons-api.vercel.app/api/icon/{lower}",
    ]
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            deduped.append(url)
    return deduped


def _infer_icon_source(url: str) -> str | None:
    lowered = url.lower()
    if "spothq" in lowered:
        return "spothq"
    if "coincap" in lowered:
        return "coincap"
    if "coinicons-api" in lowered:
        return "coinicons-api"
    return None


def _normalize_grvt_base_symbol(symbol: str) -> str:
    if not symbol:
        return ""
    return re.sub(r"[-_]PERP$", "", symbol.upper())


def _parse_float(value: Any) -> float | None:
    try:
        num = float(value)
        if math.isfinite(num):
            return num
        return None
    except Exception:  # noqa: BLE001
        return None


def _normalize_base_symbol(symbol: str) -> str:
    if not symbol:
        return ""
    if symbol in SYMBOL_RENAMES:
        return SYMBOL_RENAMES[symbol]
    return symbol


def _normalize_derivatives_base(symbol: str) -> str:
    base = symbol.upper().removesuffix("-PERP")
    return _normalize_base_symbol(base)
