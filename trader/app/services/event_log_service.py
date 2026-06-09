"""In-memory event log with ring-buffer retention for the trading dashboard."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json as _json
import logging
import time as _time
from collections import deque
from datetime import datetime, timezone
from typing import Any

json_dumps = _json.dumps

logger = logging.getLogger(__name__)

MAX_EVENTS = 500  # keep the most recent N events in memory

# Sentinel for optional Feishu dependency
FEISHU_BOT: FeishuBot | None = None


async def _lookup_user_feishu_open_id(user_id: str) -> str | None:
    """Look up a user's feishu_open_id from the database, or fall back to settings."""
    try:
        from app.config import get_settings
        settings = get_settings()
        # If user_id is the admin's own user, use the .env default
        from uuid import UUID
        from sqlmodel import Session, select
        from app.db import get_engine
        from app.db_models import User

        with Session(get_engine()) as session:
            user = session.get(User, UUID(user_id))
            if user is not None and user.feishu_open_id:
                return user.feishu_open_id
    except Exception:
        pass
    # Fallback to .env default
    try:
        return get_settings().feishu_open_id or None
    except Exception:
        return None


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
        user_id: str | None = None,
    ) -> None:
        entry = {
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "type": event_type,
            "severity": severity,  # info | warning | error
            "symbol": symbol,
            "message": message,
            "user_id": user_id,
            "detail": detail or {},
        }
        self._events.append(entry)

        sev = severity.upper()
        logger.info("EVENT [%s] %s %s — %s", sev, event_type, symbol or "-", message)

        # Push to Feishu if critical
        if FEISHU_BOT is not None and severity in ("warning", "error"):
            try:
                target_open_id = None
                if user_id:
                    # Look up user's feishu_open_id from the database
                    target_open_id = await _lookup_user_feishu_open_id(user_id)
                await FEISHU_BOT.send(
                    event_type=event_type, message=message, symbol=symbol,
                    detail=detail, open_id=target_open_id,
                )
            except Exception:
                logger.warning("Feishu push failed for event %s", event_type, exc_info=True)

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        events = list(self._events)
        return events[-limit:]


# ── Feishu sender (webhook + API) ──────────────────────────────────────


class FeishuBot:
    """Feishu/Lark notification sender.

    Two modes (auto-detected):
    1. Webhook — simple group bot with URL + optional signature
    2. API — enterprise app, sends private chat messages via Feishu API

    Config (.env):
        # Webhook mode
        FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
        FEISHU_SIGN_SECRET=sign_xxxxxxxx  # optional

        # API mode (private chat)
        FEISHU_APP_ID=cli_xxxx
        FEISHU_APP_SECRET=xxxx
        FEISHU_OPEN_ID=ou_xxxx
    """

    def __init__(
        self,
        webhook_url: str = "",
        sign_secret: str = "",
        app_id: str = "",
        app_secret: str = "",
        open_id: str = "",
    ) -> None:
        self._url = webhook_url.strip()
        self._sign_secret = sign_secret.strip()
        self._app_id = app_id.strip()
        self._app_secret = app_secret.strip()
        self._open_id = open_id.strip()
        self._client: Any = None
        self._token: str | None = None
        self._token_expires_at: float = 0.0

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

    async def _get_tenant_token(self) -> str:
        """Fetch or refresh tenant_access_token for API mode."""
        now = _time.time()
        if self._token and now < self._token_expires_at - 60:
            return self._token

        client = await self._ensure_client()
        resp = await client.post(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": self._app_id, "app_secret": self._app_secret},
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["tenant_access_token"]
        self._token_expires_at = now + data.get("expire", 7200)
        return self._token

    async def _send_api(self, text_content: str, open_id: str = "") -> None:
        token = await self._get_tenant_token()
        client = await self._ensure_client()
        payload = {
            "receive_id": open_id or self._open_id,
            "msg_type": "text",
            "content": json_dumps({"text": text_content}),
        }
        resp = await client.post(
            "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code >= 400:
            logger.warning("Feishu API returned %d: %s", resp.status_code, resp.text[:200])
        else:
            logger.info("Feishu private message sent")

    async def _send_webhook(self, card_payload: dict[str, Any]) -> None:
        client = await self._ensure_client()
        resp = await client.post(self._url, json=card_payload)
        if resp.status_code >= 400:
            logger.warning("Feishu webhook returned %d: %s", resp.status_code, resp.text[:200])
        else:
            logger.info("Feishu webhook message sent")

    async def send(
        self,
        event_type: str,
        message: str,
        symbol: str | None = None,
        detail: dict[str, Any] | None = None,
        open_id: str | None = None,
    ) -> None:
        # Use the given open_id, or fall back to the default from config
        target = (open_id or "").strip() or self._open_id
        enabled = False

        # ── API mode (private chat) ──
        if self._app_id and self._app_secret and target:
            enabled = True
            lines = [
                f"【{event_type}】",
                f"币种: {symbol or '—'}",
                f"{message}",
            ]
            if detail:
                lines.append(", ".join(f"{k}={v}" for k, v in list(detail.items())[:5]))
            try:
                await self._send_api("\n".join(lines), target)
            except Exception:
                logger.warning("Feishu API send failed", exc_info=True)

        # ── Webhook mode (group bot) ──
        elif self._url:
            enabled = True
            severity_emoji = {"error": "🔴", "warning": "🟡", "info": "🔵"}
            emoji = "🔴" if "failed" in event_type or "risk" in event_type else "📌"
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
            if self._sign_secret:
                ts = int(_time.time())
                card_payload["timestamp"] = str(ts)
                card_payload["sign"] = self._gen_sign(ts, self._sign_secret)

            try:
                await self._send_webhook(card_payload)
            except Exception:
                logger.warning("Feishu webhook send failed", exc_info=True)

        if not enabled:
            logger.debug("Feishu bot disabled — no credentials configured")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
