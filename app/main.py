from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status

from app.config import get_settings
from app.events import EventBroadcaster
from app.models import DriftOrderRequest, LighterOrderRequest, OrderEvent
from app.services.drift_service import DriftService
from app.services.lighter_service import LighterService


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
