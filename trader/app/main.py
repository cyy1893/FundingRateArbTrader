from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import logging
from datetime import datetime, timezone
from collections.abc import AsyncIterator
from typing import Any, Dict

from fastapi import Depends, FastAPI, HTTPException, Security, WebSocket, WebSocketDisconnect, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings
from app.events import EventBroadcaster
from app.models import (
    ArbitrageSnapshotRequest,
    ArbitrageSnapshotResponse,
    BalancesResponse,
    FundingHistoryRequest,
    FundingHistoryResponse,
    LighterOrderRequest,
    LoginRequest,
    LoginResponse,
    OrderBookSnapshot,
    OrderBookSubscription,
    OrderEvent,
    VenueOrderBook,
    PerpSnapshot,
    PerpSnapshotRequest,
)
from app.services.lighter_service import LighterService
from app.services.grvt_service import GrvtService
from app.services.market_data_service import MarketDataService
from app.utils.auth import AuthError, AuthManager, LockoutError, parse_users


logging.getLogger().setLevel(logging.INFO)
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("websockets.client").setLevel(logging.WARNING)


settings = get_settings()
event_broadcaster = EventBroadcaster()
lighter_service = LighterService(settings)
grvt_service = GrvtService(settings)
market_data_service = MarketDataService(settings)
auth_manager = AuthManager(
    users=parse_users([entry.strip() for entry in settings.auth_users.split(",") if entry.strip()]),
    secret=settings.auth_jwt_secret,
    algorithm=settings.auth_jwt_algorithm,
    token_ttl_minutes=settings.auth_token_ttl_minutes,
    lockout_threshold=settings.auth_lockout_threshold,
    lockout_minutes=settings.auth_lockout_minutes,
)
auth_scheme = HTTPBearer()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.gather(lighter_service.start(), grvt_service.start())
    yield
    await asyncio.gather(lighter_service.stop(), grvt_service.stop(), market_data_service.close())


app = FastAPI(title="Funding Rate Arbitrage Trader", version="0.1.0", lifespan=lifespan)


def get_lighter_service() -> LighterService:
    return lighter_service


def get_grvt_service() -> GrvtService:
    return grvt_service


def get_broadcaster() -> EventBroadcaster:
    return event_broadcaster


def get_market_data_service() -> MarketDataService:
    return market_data_service


def get_auth_manager() -> AuthManager:
    return auth_manager


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(auth_scheme),
    manager: AuthManager = Depends(get_auth_manager),
) -> str:
    try:
        return manager.validate_token(credentials.credentials)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message) from exc


async def authenticate_websocket(websocket: WebSocket, manager: AuthManager) -> str:
    token = websocket.query_params.get("token")
    if not token:
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        await websocket.close(code=1008, reason="Missing token")
        raise WebSocketDisconnect

    try:
        return manager.validate_token(token)
    except AuthError as exc:
        await websocket.close(code=1008, reason=exc.message)
        raise WebSocketDisconnect


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "lighter_connected": lighter_service.is_ready,
        "grvt_connected": grvt_service.is_ready,
    }


@app.get("/balances", response_model=BalancesResponse)
async def balances(
    lighter: LighterService = Depends(get_lighter_service),
    grvt: GrvtService = Depends(get_grvt_service),
    _: str = Depends(get_current_user),
) -> BalancesResponse:
    lighter_result, grvt_result = await asyncio.gather(
        lighter.get_balances(),
        grvt.get_balances(),
        return_exceptions=True,
    )

    if isinstance(lighter_result, Exception):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch Lighter balances: {lighter_result}"
        ) from lighter_result
    if isinstance(grvt_result, Exception):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch GRVT balances: {grvt_result}"
        ) from grvt_result

    return BalancesResponse(lighter=lighter_result, grvt=grvt_result)


@app.post("/orders/lighter")
async def create_lighter_order(
    order: LighterOrderRequest,
    service: LighterService = Depends(get_lighter_service),
    broadcaster: EventBroadcaster = Depends(get_broadcaster),
    _: str = Depends(get_current_user),
):
    try:
        response = await service.place_order(order)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    await broadcaster.publish(
        OrderEvent(
            venue="lighter",
            payload={"request": order.model_dump(), "response": response.model_dump()},
            created_at=datetime.now(tz=timezone.utc),
        ).model_dump()
    )
    return response


@app.post("/perp-snapshot", response_model=PerpSnapshot)
async def perp_snapshot(
    payload: PerpSnapshotRequest,
    service: MarketDataService = Depends(get_market_data_service),
) -> PerpSnapshot:
    try:
        return await service.get_perp_snapshot(payload.primary_source, payload.secondary_source)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@app.post("/funding-history", response_model=FundingHistoryResponse)
async def funding_history(
    payload: FundingHistoryRequest,
    service: MarketDataService = Depends(get_market_data_service),
) -> FundingHistoryResponse:
    try:
        dataset = await service.get_funding_history(
            left_source=payload.left_source,
            right_source=payload.right_source,
            left_symbol=payload.left_symbol,
            right_symbol=payload.right_symbol,
            days=payload.days,
            left_funding_period_hours=payload.left_funding_period_hours,
            right_funding_period_hours=payload.right_funding_period_hours,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return FundingHistoryResponse(dataset=dataset)


@app.post("/arbitrage", response_model=ArbitrageSnapshotResponse)
async def arbitrage_snapshot(
    payload: ArbitrageSnapshotRequest,
    service: MarketDataService = Depends(get_market_data_service),
) -> ArbitrageSnapshotResponse:
    try:
        snapshot = await service.get_arbitrage_snapshot(
            primary=payload.primary_source,
            secondary=payload.secondary_source,
            volume_threshold=payload.volume_threshold,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return snapshot


@app.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    manager: AuthManager = Depends(get_auth_manager),
) -> LoginResponse:
    try:
        token, expires_in = manager.authenticate(payload.username, payload.password)
    except LockoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Too many failed attempts. Try again after {exc.until.isoformat()}",
        ) from exc
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message) from exc

    return LoginResponse(access_token=token, expires_in=expires_in)


@app.websocket("/ws/events")
async def ws_events(
    websocket: WebSocket,
    broadcaster: EventBroadcaster = Depends(get_broadcaster),
):
    try:
        await authenticate_websocket(websocket, auth_manager)
    except WebSocketDisconnect:
        return
    await websocket.accept()
    queue = await broadcaster.register()
    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        await broadcaster.unregister(queue)


@app.websocket("/ws/orderbook")
async def ws_orderbook(
    websocket: WebSocket,
    lighter: LighterService = Depends(get_lighter_service),
):
    try:
        await authenticate_websocket(websocket, auth_manager)
    except WebSocketDisconnect:
        return
    await websocket.accept()
    try:
        payload = await websocket.receive_json()
        subscription = OrderBookSubscription(**payload)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001
        await websocket.send_json({"error": f"Invalid subscription payload: {exc}"})
        await websocket.close()
        return

    update_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    latest_snapshots: dict[str, Any] = {}
    throttle = max(0.05, min((subscription.throttle_ms or 500) / 1000, 5.0))
    stop_event = asyncio.Event()

    async def forward_updates(
        venue_name: str,
        stream: AsyncIterator[VenueOrderBook],
    ) -> None:
        try:
            async for snapshot in stream:
                if stop_event.is_set():
                    break
                await update_queue.put({"type": "update", "venue": venue_name, "snapshot": snapshot})
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logging.error("Order book stream failure for %s: %s", venue_name, exc)
            await update_queue.put({"type": "error", "venue": venue_name, "message": str(exc)})

    tasks: list[asyncio.Task] = []
    try:
        tasks.append(
            asyncio.create_task(
                forward_updates("lighter", lighter.stream_orderbook(subscription.symbol, subscription.depth))
            )
        )
    except Exception as exc:  # noqa: BLE001
        await websocket.send_json({"error": str(exc)})
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        return

    async def send_loop() -> None:
        while True:
            await asyncio.sleep(throttle)
            if latest_snapshots:
                snapshot = OrderBookSnapshot(
                    lighter=latest_snapshots.get("lighter"),
                )
                try:
                    await websocket.send_json(snapshot.model_dump())
                except Exception:
                    stop_event.set()
                    break

    sender_task = asyncio.create_task(send_loop())
    try:
        while not stop_event.is_set():
            message = await update_queue.get()
            if message.get("type") == "error":
                await websocket.send_json({"error": message.get("message"), "venue": message.get("venue")})
                continue

            venue = message["venue"]
            latest_snapshots[venue] = message["snapshot"]
    except WebSocketDisconnect:
        stop_event.set()
    finally:
        sender_task.cancel()
        for task in tasks:
            task.cancel()
        await asyncio.gather(sender_task, *tasks, return_exceptions=True)
