from __future__ import annotations

import asyncio
import json
from decimal import Decimal
from typing import Optional
from lighter import nonce_manager
from lighter.api.account_api import AccountApi
from lighter.signer_client import SignerClient

from app.config import Settings
from app.models import (
    LighterBalanceSnapshot,
    LighterOrderRequest,
    LighterOrderResponse,
    LighterPositionBalance,
)


class LighterService:
    """
    Wraps the Lighter SignerClient to expose a coroutine for creating orders.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Optional[SignerClient] = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        await self._ensure_client()

    async def stop(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def _ensure_client(self) -> SignerClient:
        if self._client is not None:
            return self._client

        async with self._lock:
            if self._client is not None:
                return self._client

            nonce_type = nonce_manager.NonceManagerType.OPTIMISTIC
            if self._settings.lighter_nonce_manager.lower() == "api":
                nonce_type = nonce_manager.NonceManagerType.API

            api_private_keys = {
                self._settings.lighter_api_key_index: self._settings.lighter_private_key,
            }

            client = SignerClient(
                url=self._settings.lighter_base_url,
                private_key=self._settings.lighter_private_key,
                api_key_index=self._settings.lighter_api_key_index,
                account_index=self._settings.lighter_account_index,
                max_api_key_index=self._settings.lighter_max_api_key_index or -1,
                private_keys=api_private_keys,
                nonce_management_type=nonce_type,
            )

            err = client.check_client()
            if err is not None:
                raise RuntimeError(f"Lighter API key validation failed: {err}")
            self._client = client

        return self._client

    async def place_order(self, request: LighterOrderRequest) -> LighterOrderResponse:
        client = await self._ensure_client()

        if request.order_type == "market":
            payload, tx_hash, err = await client.create_market_order(
                market_index=request.market_index,
                client_order_index=request.client_order_index,
                base_amount=request.base_amount,
                avg_execution_price=request.avg_execution_price,  # type: ignore[arg-type]
                is_ask=request.is_ask,
                reduce_only=request.reduce_only,
                nonce=request.nonce or -1,
                api_key_index=request.api_key_index or -1,
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
                nonce=request.nonce or -1,
                api_key_index=request.api_key_index or -1,
            )

        if err is not None:
            raise RuntimeError(f"Lighter create order failed: {err}")

        payload_dict = json.loads(payload.to_json()) if payload is not None else {}
        tx_hash_value = tx_hash.tx_hash if tx_hash is not None else ""

        return LighterOrderResponse(
            tx_hash=tx_hash_value,
            payload=payload_dict,
        )

    async def get_balances(self) -> LighterBalanceSnapshot:
        client = await self._ensure_client()
        account_api = AccountApi(client.api_client)
        account_response = await account_api.account(
            by="index", value=str(self._settings.lighter_account_index)
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

    @property
    def is_ready(self) -> bool:
        return self._client is not None

    @staticmethod
    def _to_float(value: Optional[str]) -> float:
        if value is None:
            return 0.0
        return float(Decimal(value))
