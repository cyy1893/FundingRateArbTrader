from __future__ import annotations

import math
import asyncio
import re
from datetime import datetime, timezone
from time import time
from typing import Any

import httpx

from app.config import Settings
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
CACHE_TTL_SECONDS = 10 * 60
AVAILABLE_SYMBOLS_CACHE_TTL_SECONDS = 60 * 60
SYMBOL_RENAMES: dict[str, str] = {
    "1000PEPE": "kPEPE",
    "1000SHIB": "kSHIB",
    "1000BONK": "kBONK",
}


class MarketDataService:
    def __init__(self, settings: Settings) -> None:
        self._lighter_base_url = settings.lighter_base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=10.0)
        self._lighter_leverage_map: dict[str, float] | None = None
        self._grvt_market_data_base, _ = self._build_grvt_endpoints(settings.grvt_env)
        self._arbitrage_cache: dict[tuple[str, str, float], tuple[float, ArbitrageSnapshotResponse]] = {}
        self._prediction_cache: dict[tuple[str, str, float], tuple[float, FundingPredictionResponse]] = {}
        self._available_symbols_cache: dict[tuple[str, str], tuple[float, list[AvailableSymbolEntry], datetime]] = {}

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
            errors.append(ApiError(source="Hyperliquid API", message=str(exc)))
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
        try:
            order_books_res, funding_res, stats_res = await asyncio.gather(
                self._client.get(f"{self._lighter_base_url}/api/v1/orderBooks"),
                self._client.get(f"{self._lighter_base_url}/api/v1/funding-rates"),
                self._client.get(f"{self._lighter_base_url}/api/v1/exchangeStats"),
            )
            order_books_res.raise_for_status()
            funding_res.raise_for_status()
            stats_res.raise_for_status()
            order_books = order_books_res.json()
            funding_rates = funding_res.json()
            exchange_stats = stats_res.json()
        except Exception as exc:  # noqa: BLE001
            errors.append(ApiError(source="Lighter API", message=str(exc)))
            return ExchangeSnapshot(markets=[], errors=errors)

        volume_by_symbol: dict[str, float] = {}
        markets: list[ExchangeMarketMetrics] = []

        if isinstance(order_books, dict):
            for entry in order_books.get("order_books", []) or []:
                if not isinstance(entry, dict):
                    continue
                symbol = str(entry.get("symbol", "")).upper()
                base_symbol = _normalize_derivatives_base(symbol)
                mark_price = _parse_float(entry.get("price"))
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
        for symbol, leverage in leverage_map.items():
            market = symbol_to_market.get(symbol) or symbol_to_market.get(f"{symbol}-PERP")
            if market and leverage is not None:
                market.max_leverage = leverage

        return ExchangeSnapshot(markets=list(symbol_to_market.values()), errors=errors)

    async def _fetch_grvt_markets(self) -> ExchangeSnapshot:
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
            errors.append(ApiError(source="GRVT API", message=str(exc)))
            return ExchangeSnapshot(markets=[], errors=errors)

        # Filter perpetual instruments
        perp_instruments = [inst for inst in instruments if isinstance(inst, dict) and inst.get("kind") == "PERPETUAL"]
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
            funding_rate_pct = _parse_float(ticker.get("funding_rate_8h_curr") or ticker.get("funding_rate"))
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
                    price_change_1h=None,
                    price_change_24h=None,
                    price_change_7d=None,
                    max_leverage=50.0,
                    funding_rate_hourly=funding_rate_hourly,
                    funding_period_hours=interval_hours,
                    day_notional_volume=volume_q if volume_q > 0 else None,
                    open_interest=open_interest,
                    volume_usd=volume_q if volume_q > 0 else None,
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

    async def get_funding_prediction_snapshot(
        self,
        primary: str,
        secondary: str,
        volume_threshold: float = 0.0,
        force_refresh: bool = False,
    ) -> FundingPredictionResponse:
        """
        Predict 24h funding rates based on recent funding history and return
        the suggested direction plus annualized yield.
        """
        cache_key = (primary, secondary, float(volume_threshold))
        if not force_refresh:
            cached = self._prediction_cache.get(cache_key)
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
            return left_volume >= volume_cutoff and (right_volume or 0.0) >= volume_cutoff

        eligible_rows = [
            row
            for row in snapshot.rows
            if isinstance(row.right, dict) and row.right.get("symbol") and _passes_volume(row)
        ]

        semaphore = asyncio.Semaphore(MAX_PREDICTION_WORKERS)

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
                left_ewma: float | None = None
                right_ewma: float | None = None
                spread_ewma: float | None = None
                left_count = 0
                right_count = 0
                spread_count = 0
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

                if spread_count == 0:
                    failures.append({"symbol": symbol_label, "reason": "72 小时内有效样本不足"})
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
                predicted_spread_24h = average_spread_hourly * PREDICTION_FORECAST_HOURS
                total_decimal = abs(predicted_spread_24h) / 100.0
                annualized_decimal = abs(average_spread_hourly) / 100.0 * PREDICTION_HOURS_PER_YEAR

                direction = "unknown"
                if average_spread_hourly > 0:
                    direction = "leftLong"
                elif average_spread_hourly < 0:
                    direction = "rightLong"

                entries.append(
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
                        "sample_count": spread_count,
                        "direction": direction,
                    }
                )

        await asyncio.gather(*(_compute_row(row) for row in eligible_rows))

        entries.sort(key=lambda entry: entry.get("annualized_decimal", 0), reverse=True)

        response = FundingPredictionResponse(
            entries=entries,
            failures=failures,
            fetched_at=fetched_at,
            errors=snapshot.errors,
        )
        self._prediction_cache[cache_key] = (time(), response)
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
            return left_volume >= volume_cutoff and (right_volume or 0.0) >= volume_cutoff

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

    async def fetch_exchange_snapshot(self, source: str) -> ExchangeSnapshot:
        provider = source.lower()
        if provider == "hyperliquid":
            return await self._fetch_hyperliquid_markets()
        if provider == "lighter":
            return await self._fetch_lighter_markets()
        if provider == "grvt":
            return await self._fetch_grvt_markets()
        return ExchangeSnapshot(markets=[], errors=[ApiError(source=source, message="Unsupported provider")])

    async def get_perp_snapshot(self, primary: str, secondary: str) -> PerpSnapshot:
        primary_snapshot, secondary_snapshot = await asyncio.gather(
            self.fetch_exchange_snapshot(primary),
            self.fetch_exchange_snapshot(secondary),
        )

        api_errors = [*primary_snapshot.errors, *secondary_snapshot.errors]
        secondary_by_base: dict[str, ExchangeMarketMetrics] = {}
        for market in secondary_snapshot.markets:
            if market.base_symbol:
                secondary_by_base[market.base_symbol] = market

        rows: list[MarketRow] = []
        for left_market in primary_snapshot.markets:
            base_symbol = left_market.base_symbol or left_market.symbol
            matching_right = secondary_by_base.get(base_symbol) if base_symbol else None
            combined_volume = None
            if left_market.day_notional_volume is not None or (matching_right and matching_right.volume_usd is not None):
                combined_volume = (left_market.day_notional_volume or 0) + (matching_right.volume_usd if matching_right else 0 or 0)

            right_payload = None
            if matching_right:
                right_payload = {
                    "source": secondary,
                    "symbol": matching_right.symbol,
                    "max_leverage": matching_right.max_leverage,
                    "funding_rate": matching_right.funding_rate_hourly,
                    "volume_usd": matching_right.volume_usd,
                    "funding_period_hours": matching_right.funding_period_hours,
                }

            rows.append(
                MarketRow(
                    left_provider=primary,
                    right_provider=secondary,
                    left_symbol=left_market.symbol,
                    left_funding_period_hours=left_market.funding_period_hours,
                    symbol=base_symbol,
                    display_name=left_market.display_name or base_symbol,
                    icon_url=None,
                    coingecko_id=None,
                    mark_price=left_market.mark_price,
                    price_change_1h=left_market.price_change_1h,
                    price_change_24h=left_market.price_change_24h,
                    price_change_7d=left_market.price_change_7d,
                    max_leverage=left_market.max_leverage,
                    funding_rate=left_market.funding_rate_hourly,
                    day_notional_volume=left_market.day_notional_volume,
                    open_interest=left_market.open_interest,
                    volume_usd=combined_volume,
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

        return PerpSnapshot(rows=rows, fetched_at=datetime.now(tz=timezone.utc), errors=api_errors)

    async def _get_lighter_leverage_map(self) -> dict[str, float]:
        if self._lighter_leverage_map is not None:
            return self._lighter_leverage_map

        url = "https://docs.lighter.xyz/perpetual-futures/contract-specifications.md"
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


def _normalize_timestamp_to_hour(value: Any) -> int | None:
    try:
        ts = int(float(value))
    except Exception:  # noqa: BLE001
        return None
    return (ts // MS_PER_HOUR) * MS_PER_HOUR


def _normalize_lighter_symbol(value: str | None) -> str:
    return value.strip().upper() if value else ""


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
