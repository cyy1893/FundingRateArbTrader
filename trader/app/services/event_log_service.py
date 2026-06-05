"""In-memory event log with ring-buffer retention for the trading dashboard."""

from __future__ import annotations

import asyncio
import logging
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
    """Minimal Feishu/Lark webhook bot for critical event notifications."""

    def __init__(self, webhook_url: str) -> None:
        self._url = webhook_url.strip()
        self._client: Any = None  # httpx.AsyncClient, lazy-init

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

        title = f"[{event_type}] {symbol or '—'}"
        content = [[{"tag": "text", "text": message}]]
        if detail:
            content.append([{"tag": "text", "text": str(detail)[:500]}])

        payload = {
            "msg_type": "interactive",
            "card": {
                "header": {"title": {"tag": "plain_text", "content": title}},
                "elements": [
                    {"tag": "div", "text": {"tag": "lark_md", "content": message}},
                ],
            },
        }

        client = await self._ensure_client()
        resp = await client.post(self._url, json=payload)
        if resp.status_code >= 400:
            logger.warning("Feishu webhook returned %d: %s", resp.status_code, resp.text[:200])

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
