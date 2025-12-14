from __future__ import annotations

import math
import asyncio
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import Settings
from app.models import ApiError, ExchangeMarketMetrics, ExchangeSnapshot, MarketRow, PerpSnapshot

DEFAULT_FUNDING_PERIOD_HOURS = 1.0
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
                        funding_period_hours=DEFAULT_FUNDING_PERIOD_HOURS,
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
                market.funding_rate_hourly = rate / max(DEFAULT_FUNDING_PERIOD_HOURS, 1)
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
