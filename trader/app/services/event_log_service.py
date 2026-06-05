"""In-memory event log with ring-buffer retention for the trading dashboard."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import time as _time
from collections import deque
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

MAX_EVENTS = 500  # keep the most recent N events in memory

# Sentinel for optional Feishu dependency
FEISHU_BOT: FeishuBot | None = None


class EventLogService:
    """Ring-buffer event store polled by the frontend sidebar."""

    def __init__(self) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=MAX_EVENTS)

    async def emit(
        self,
        event_type: str,
        severity: str = "info",
        *,
        symbol: str | None = None,
        message: str = "",
        detail: dict[str, Any] | None = None,
    ) -> None:
        entry = {
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "type": event_type,
            "severity": severity,  # info | warning | error
            "symbol": symbol,
            "message": message,
            "detail": detail or {},
        }
        self._events.append(entry)

        sev = severity.upper()
        logger.info("EVENT [%s] %s %s — %s", sev, event_type, symbol or "-", message)

        # Push to Feishu if critical
        if FEISHU_BOT is not None and severity in ("warning", "error"):
            try:
                await FEISHU_BOT.send(event_type=event_type, message=message, symbol=symbol, detail=detail)
            except Exception:
                logger.warning("Feishu push failed for event %s", event_type, exc_info=True)

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        events = list(self._events)
        return events[-limit:]


# ── Feishu webhook sender ────────────────────────────────────────────────


class FeishuBot:
    """Feishu/Lark webhook bot with signature verification support.

    Usage (in .env):
        FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
        FEISHU_SIGN_SECRET=sign_xxxxxxxx  # optional but recommended
    """

    def __init__(self, webhook_url: str, sign_secret: str = "") -> None:
        self._url = webhook_url.strip()
        self._sign_secret = sign_secret.strip()
        self._client: Any = None  # httpx.AsyncClient, lazy-init

    @staticmethod
    def _gen_sign(timestamp: int, secret: str) -> str:
        string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
        hmac_code = hmac.new(secret.encode("utf-8"), string_to_sign, digestmod=hashlib.sha256).digest()
        return base64.b64encode(hmac_code).decode("utf-8")

    async def _ensure_client(self) -> Any:
        if self._client is None:
            import httpx
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client

    async def send(
        self,
        event_type: str,
        message: str,
        symbol: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        if not self._url:
            return

        # Build Feishu interactive card
        severity_emoji = {"error": "🔴", "warning": "🟡", "info": "🔵"}
        emoji = severity_emoji.get(event_type, "📌") if "error" in event_type or "risk" in event_type else severity_emoji.get("warning", "🔵") if "failed" in event_type else "📌"

        header_color = "red" if event_type in ("position_failed", "risk_triggered") else "blue"

        body_lines = [
            f"**事件**: {event_type}",
            f"**币种**: {symbol or '—'}",
            f"**时间**: {datetime.now(tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
            f"**详情**: {message}",
        ]
        if detail:
            detail_str = ", ".join(f"{k}={v}" for k, v in list(detail.items())[:5])
            body_lines.append(f"**参数**: {detail_str}")

        card_payload: dict[str, Any] = {
            "msg_type": "interactive",
            "card": {
                "config": {"wide_screen_mode": True},
                "header": {
                    "template": header_color,
                    "title": {"tag": "plain_text", "content": f"{emoji} {event_type}"},
                },
                "elements": [
                    {"tag": "div", "text": {"tag": "lark_md", "content": "\n".join(body_lines)}},
                ],
            },
        }

        # Add signature if configured
        if self._sign_secret:
            ts = int(_time.time())
            card_payload["timestamp"] = str(ts)
            card_payload["sign"] = self._gen_sign(ts, self._sign_secret)

        client = await self._ensure_client()
        resp = await client.post(self._url, json=card_payload)
        if resp.status_code >= 400:
            logger.warning("Feishu webhook returned %d: %s", resp.status_code, resp.text[:200])
        else:
            logger.info("Feishu message sent: %s", event_type)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
