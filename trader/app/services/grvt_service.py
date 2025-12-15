from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from pysdk.grvt_ccxt_env import GrvtEnv
from pysdk.grvt_ccxt_pro import GrvtCcxtPro

from app.config import Settings
from app.models import GrvtAssetBalance, GrvtBalanceSnapshot, GrvtPositionBalance


class GrvtService:
    """
    Thin wrapper around the GRVT CCXT-style SDK to expose balance snapshots.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: GrvtCcxtPro | None = None
        self._lock = asyncio.Lock()
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
