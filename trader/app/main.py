from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import logging
from datetime import datetime, timezone
from collections.abc import AsyncIterator
from typing import Any, Dict

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status

from app.config import get_settings
from app.events import EventBroadcaster
from app.models import (
    BalancesResponse,
    DriftOrderRequest,
    LighterOrderRequest,
    OrderBookSnapshot,
    OrderBookSubscription,
    OrderEvent,
    VenueOrderBook,
)
from app.services.drift_service import DriftService
from app.services.lighter_service import LighterService


logging.getLogger().setLevel(logging.INFO)
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("websockets.client").setLevel(logging.WARNING)


settings = get_settings()
event_broadcaster = EventBroadcaster()
drift_service = DriftService(settings)
lighter_service = LighterService(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.gather(drift_service.start(), lighter_service.start())
    yield
    await asyncio.gather(drift_service.stop(), lighter_service.stop())


app = FastAPI(title="Funding Rate Arbitrage Trader", version="0.1.0", lifespan=lifespan)


def get_drift_service() -> DriftService:
    return drift_service


def get_lighter_service() -> LighterService:
    return lighter_service


def get_broadcaster() -> EventBroadcaster:
    return event_broadcaster


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "drift_connected": drift_service.is_ready,
        "lighter_connected": lighter_service.is_ready,
    }


@app.get("/balances", response_model=BalancesResponse)
async def balances(
    drift: DriftService = Depends(get_drift_service),
    lighter: LighterService = Depends(get_lighter_service),
) -> BalancesResponse:
    try:
        drift_balances = await drift.get_balances()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch Drift balances: {exc}") from exc

    try:
        lighter_balances = await lighter.get_balances()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to fetch Lighter balances: {exc}") from exc

    return BalancesResponse(drift=drift_balances, lighter=lighter_balances)


@app.post("/orders/drift")
async def create_drift_order(
    order: DriftOrderRequest,
    service: DriftService = Depends(get_drift_service),
    broadcaster: EventBroadcaster = Depends(get_broadcaster),
):
    try:
        response = await service.place_order(order)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    await broadcaster.publish(
        OrderEvent(
            venue="drift",
            payload={"request": order.model_dump(), "response": response.model_dump()},
            created_at=datetime.now(tz=timezone.utc),
        ).model_dump()
    )
    return response


@app.post("/orders/lighter")
async def create_lighter_order(
    order: LighterOrderRequest,
    service: LighterService = Depends(get_lighter_service),
    broadcaster: EventBroadcaster = Depends(get_broadcaster),
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


@app.websocket("/ws/events")
async def ws_events(
    websocket: WebSocket,
    broadcaster: EventBroadcaster = Depends(get_broadcaster),
):
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
    drift: DriftService = Depends(get_drift_service),
    lighter: LighterService = Depends(get_lighter_service),
):
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
                forward_updates(
                    "drift",
                    drift.stream_orderbook(
                        subscription.symbol,
                        subscription.depth,
                    ),
                )
        )
        )
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
                    drift=latest_snapshots.get("drift"),
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
