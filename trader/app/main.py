from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hmac
import logging
import secrets
import string
from datetime import datetime, timezone
from uuid import UUID
from collections.abc import AsyncIterator
from typing import Any, Dict
from cachetools import TTLCache

from fastapi import Depends, FastAPI, HTTPException, Request, Security, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select
import os

from app.config import get_settings
from app.events import EventBroadcaster
from app.models import (
    ArbitrageSnapshotRequest,
    ArbitrageSnapshotResponse,
    ArbCloseRequest,
    ArbCloseResponse,
    ArbOpenRequest,
    ArbOpenResponse,
    ArbStatusResponse,
    AdminCreateUserRequest,
    AdminResetPasswordRequest,
    AdminResetPasswordResponse,
    AdminUserListResponse,
    AdminUserResponse,
    AdminUserSummary,
    BalancesResponse,
    AvailableSymbolsRequest,
    AvailableSymbolsResponse,
    FundingHistoryRequest,
    FundingHistoryResponse,
    FundingPredictionRequest,
    FundingPredictionResponse,
    GrvtOrderRequest,
    GrvtOrderResponse,
    TradesSnapshot,
    LighterLeverageRequest,
    LighterLeverageResponse,
    LighterOrderRequest,
    LighterOrderResponse,
    LighterSymbolOrderRequest,
    LoginRequest,
    LoginResponse,
    OrderBookSnapshot,
    OrderBookSubscription,
    OrderEvent,
    VenueOrderBook,
    PerpSnapshot,
    PerpSnapshotRequest,
)
from app.db_models import (
    ArbPosition,
    ArbPositionStatus,
    OrderLog,
    OrderStatus,
    RiskTask,
    RiskTaskStatus,
    RiskTaskType,
    TradingProfile,
    User,
)
from app.db_session import get_engine, get_session
from app.services.arb_service import ArbService
from app.services.lighter_service import LighterService
from app.services.grvt_service import GrvtService
from app.services.market_data_service import MarketDataService
from app.utils.auth import AuthError, AuthManager, LockoutError, _hash_password
from app.utils.crypto import decrypt_secret, encrypt_secret


logging.getLogger().setLevel(logging.INFO)
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("websockets.client").setLevel(logging.WARNING)


settings = get_settings()
event_broadcaster = EventBroadcaster()
lighter_service = LighterService(settings)
grvt_service = GrvtService(settings)
market_data_service = MarketDataService(settings)
auth_scheme = HTTPBearer()
_user_cache = TTLCache(maxsize=2048, ttl=settings.user_cache_ttl_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.gather(lighter_service.start(), grvt_service.start())
    auto_close_task = asyncio.create_task(auto_close_worker())
    yield
    auto_close_task.cancel()
    await asyncio.gather(auto_close_task, return_exceptions=True)
    await asyncio.gather(lighter_service.stop(), grvt_service.stop(), market_data_service.close())


app = FastAPI(title="Funding Rate Arbitrage Trader", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_lighter_service() -> LighterService:
    return lighter_service


def get_grvt_service() -> GrvtService:
    return grvt_service


def get_broadcaster() -> EventBroadcaster:
    return event_broadcaster


def get_market_data_service() -> MarketDataService:
    return market_data_service


def get_auth_manager(session: Session = Depends(get_session)) -> AuthManager:
    return AuthManager(
        session=session,
        secret=settings.auth_jwt_secret,
        algorithm=settings.auth_jwt_algorithm,
        token_ttl_minutes=settings.auth_token_ttl_minutes,
        lockout_threshold=settings.auth_lockout_threshold,
        lockout_minutes=settings.auth_lockout_minutes,
    )


async def _get_lighter_best_prices(symbol: str) -> tuple[float | None, float | None]:
    return await lighter_service.get_best_prices(symbol, depth=1)


async def _get_grvt_best_prices(
    symbol: str,
    api_key: str,
    private_key: str,
    trading_account_id: str,
) -> tuple[float | None, float | None, str]:
    return await grvt_service.get_best_prices_with_credentials(
        symbol,
        api_key=api_key,
        private_key=private_key,
        trading_account_id=trading_account_id,
        depth=1,
    )


async def _execute_auto_close_task(task_id: UUID) -> None:
    engine = get_engine()
    with Session(engine) as session:
        task = session.get(RiskTask, task_id)
        if task is None or task.status != RiskTaskStatus.pending or task.task_type != RiskTaskType.auto_close:
            return
        position = session.get(ArbPosition, task.arb_position_id)
        if position is None or position.status in {ArbPositionStatus.closed, ArbPositionStatus.failed}:
            task.status = RiskTaskStatus.canceled
            task.trigger_reason = "position inactive"
            task.triggered_at = datetime.utcnow()
            session.add(task)
            session.commit()
            return
        user = session.get(User, position.user_id)
        if user is None:
            task.status = RiskTaskStatus.failed
            task.trigger_reason = "user not found"
            task.triggered_at = datetime.utcnow()
            session.add(task)
            session.commit()
            return

    symbol = position.symbol
    try:
        with Session(engine) as session:
            profile_user = session.get(User, user.id)
            if profile_user is None:
                raise RuntimeError("user not found")
            lighter_account_index, lighter_api_key_index, lighter_private_key = _get_lighter_credentials(
                session,
                profile_user,
            )
            grvt_api_key, grvt_private_key, grvt_trading_account_id = _get_grvt_credentials(
                session,
                profile_user,
            )
        lighter_snapshot = await lighter_service.get_balances_with_credentials(
            lighter_account_index,
            lighter_api_key_index,
            lighter_private_key,
        )
        grvt_snapshot = await grvt_service.get_balances_with_credentials(
            grvt_api_key,
            grvt_private_key,
            grvt_trading_account_id,
        )
        grvt_best_bid, grvt_best_ask, grvt_instrument = await _get_grvt_best_prices(
            symbol,
            grvt_api_key,
            grvt_private_key,
            grvt_trading_account_id,
        )
        lighter_best_bid, lighter_best_ask = await _get_lighter_best_prices(symbol)
    except Exception as exc:  # noqa: BLE001
        with Session(engine) as session:
            task = session.get(RiskTask, task_id)
            if task is not None:
                task.status = RiskTaskStatus.failed
                task.trigger_reason = f"snapshot error: {exc}"
                task.triggered_at = datetime.utcnow()
                session.add(task)
                session.commit()
        return

    lighter_position = next(
        (pos for pos in lighter_snapshot.positions if pos.symbol.upper() == symbol.upper()),
        None,
    )
    grvt_position = next(
        (pos for pos in grvt_snapshot.positions if pos.instrument.upper() == grvt_instrument.upper()),
        None,
    )

    orders: list[tuple[str, dict[str, Any]]] = []
    if lighter_position and abs(lighter_position.position) > 0:
        side = "sell" if lighter_position.position >= 0 else "buy"
        price = lighter_best_bid if side == "buy" else lighter_best_ask
        if price:
            orders.append(
                (
                    "lighter",
                    LighterSymbolOrderRequest(
                        symbol=symbol,
                        client_order_index=int(datetime.utcnow().timestamp() * 1000) % 2_147_483_647,
                        side=side,
                        base_amount=abs(lighter_position.position),
                        price=price,
                        reduce_only=True,
                        time_in_force="post_only",
                    ).model_dump(),
                )
            )
    if grvt_position and abs(grvt_position.size) > 0:
        side = "sell" if grvt_position.size >= 0 else "buy"
        price = grvt_best_bid if side == "buy" else grvt_best_ask
        if price:
            orders.append(
                (
                    "grvt",
                    GrvtOrderRequest(
                        symbol=symbol,
                        side=side,
                        amount=abs(grvt_position.size),
                        price=price,
                        post_only=True,
                        reduce_only=True,
                        order_duration_secs=None,
                        client_order_id=int(datetime.utcnow().timestamp() * 1000 + 1) % 2_147_483_647,
                    ).model_dump(),
                )
            )

    if not orders:
        with Session(engine) as session:
            task = session.get(RiskTask, task_id)
            if task is not None:
                task.status = RiskTaskStatus.failed
                task.trigger_reason = "no positions or price"
                task.triggered_at = datetime.utcnow()
                session.add(task)
                session.commit()
        return

    async def _place_order(venue: str, payload: dict[str, Any]) -> tuple[str, bool, str | None]:
        try:
            if venue == "lighter":
                response = await lighter_service.place_order_by_symbol_with_credentials(
                    LighterSymbolOrderRequest(**payload),
                    account_index=lighter_account_index,
                    api_key_index=lighter_api_key_index,
                    private_key=lighter_private_key,
                )
            else:
                response = await grvt_service.place_order_with_credentials(
                    GrvtOrderRequest(**payload),
                    api_key=grvt_api_key,
                    private_key=grvt_private_key,
                    trading_account_id=grvt_trading_account_id,
                )
            logging.info("auto close order placed venue=%s payload=%s response=%s", venue, payload, response.model_dump())
            return venue, True, None
        except Exception as exc:  # noqa: BLE001
            logging.error("auto close order failed venue=%s payload=%s error=%s", venue, payload, exc)
            return venue, False, str(exc)

    results = await asyncio.gather(*(_place_order(venue, payload) for venue, payload in orders))
    failed = [result for result in results if not result[1]]

    with Session(engine) as session:
        task = session.get(RiskTask, task_id)
        if task is None:
            return
        task.triggered_at = datetime.utcnow()
        if failed:
            task.status = RiskTaskStatus.failed
            task.trigger_reason = " | ".join(f"{venue}: {err}" for venue, _, err in failed if err)
        else:
            task.status = RiskTaskStatus.triggered
            task.trigger_reason = "auto close orders placed"
        session.add(task)
        session.commit()


async def auto_close_worker() -> None:
    engine = get_engine()
    while True:
        await asyncio.sleep(2)
        now = datetime.utcnow()
        with Session(engine) as session:
            task_ids = session.exec(
                select(RiskTask.id)
                .where(RiskTask.enabled.is_(True))
                .where(RiskTask.task_type == RiskTaskType.auto_close)
                .where(RiskTask.status == RiskTaskStatus.pending)
                .where(RiskTask.execute_at.is_not(None))
                .where(RiskTask.execute_at <= now)
            ).all()
        for task_id in task_ids:
            await _execute_auto_close_task(task_id)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(auth_scheme),
    manager: AuthManager = Depends(get_auth_manager),
    session: Session = Depends(get_session),
) -> User:
    try:
        username = manager.validate_token(credentials.credentials)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message) from exc
    user = _user_cache.get(username)
    if user is None:
        user = session.exec(select(User).where(User.username == username, User.deleted_at.is_(None))).first()
        if user is not None and settings.user_cache_ttl_seconds > 0:
            _user_cache[username] = user
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return user


def verify_admin_registration_secret(request: Request) -> None:
    header_name = settings.admin_client_header_name
    provided_secret = request.headers.get(header_name)
    if not provided_secret:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing required admin client header: {header_name}",
        )
    if not hmac.compare_digest(provided_secret, settings.admin_registration_secret):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin client secret")


def _generate_temporary_password(length: int = 18) -> str:
    charset = string.ascii_letters + string.digits + "!@#$%^&*()_+-="
    return "".join(secrets.choice(charset) for _ in range(length))


def _get_trading_profile(session: Session, user: User) -> TradingProfile:
    profile = session.exec(
        select(TradingProfile).where(
            TradingProfile.user_id == user.id,
            TradingProfile.deleted_at.is_(None),
        )
    ).first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing trading profile for user")
    return profile


def _get_lighter_credentials(session: Session, user: User) -> tuple[int, int, str]:
    profile = _get_trading_profile(session, user)
    if (
        profile.lighter_account_index is None
        or profile.lighter_api_key_index is None
        or not profile.lighter_private_key_enc
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing Lighter credentials for user")
    try:
        private_key = decrypt_secret(profile.lighter_private_key_enc)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return profile.lighter_account_index, profile.lighter_api_key_index, private_key


def _get_grvt_credentials(session: Session, user: User) -> tuple[str, str, str]:
    profile = _get_trading_profile(session, user)
    if (
        not profile.grvt_api_key_enc
        or not profile.grvt_private_key_enc
        or not profile.grvt_trading_account_id
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing GRVT credentials for user")
    try:
        api_key = decrypt_secret(profile.grvt_api_key_enc)
        private_key = decrypt_secret(profile.grvt_private_key_enc)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return api_key, private_key, profile.grvt_trading_account_id


async def authenticate_websocket(
    websocket: WebSocket,
    manager: AuthManager,
    session: Session,
) -> User:
    token = websocket.query_params.get("token")
    if not token:
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        await websocket.close(code=1008, reason="Missing token")
        raise WebSocketDisconnect

    try:
        username = manager.validate_token(token)
    except AuthError as exc:
        await websocket.close(code=1008, reason=exc.message)
        raise WebSocketDisconnect
    user = session.exec(select(User).where(User.username == username, User.deleted_at.is_(None))).first()
    if user is None or not user.is_active:
        await websocket.close(code=1008, reason="Invalid token payload")
        raise WebSocketDisconnect
    return user


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
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> BalancesResponse:
    lighter_account_index, lighter_api_key_index, lighter_private_key = _get_lighter_credentials(session, user)
    grvt_api_key, grvt_private_key, grvt_trading_account_id = _get_grvt_credentials(session, user)
    lighter_result, grvt_result = await asyncio.gather(
        lighter.get_balances_with_credentials(
            lighter_account_index,
            lighter_api_key_index,
            lighter_private_key,
        ),
        grvt.get_balances_with_credentials(
            grvt_api_key,
            grvt_private_key,
            grvt_trading_account_id,
        ),
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
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    try:
        account_index, api_key_index, private_key = _get_lighter_credentials(session, user)
        response = await service.place_order_with_credentials(
            order,
            account_index=account_index,
            api_key_index=api_key_index,
            private_key=private_key,
        )
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


@app.post("/orders/lighter/symbol", response_model=LighterOrderResponse)
async def create_lighter_order_by_symbol(
    order: LighterSymbolOrderRequest,
    service: LighterService = Depends(get_lighter_service),
    broadcaster: EventBroadcaster = Depends(get_broadcaster),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    try:
        account_index, api_key_index, private_key = _get_lighter_credentials(session, user)
        response = await service.place_order_by_symbol_with_credentials(
            order,
            account_index=account_index,
            api_key_index=api_key_index,
            private_key=private_key,
        )
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


@app.post("/orders/lighter/leverage", response_model=LighterLeverageResponse)
async def update_lighter_leverage(
    request: LighterLeverageRequest,
    service: LighterService = Depends(get_lighter_service),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    try:
        account_index, api_key_index, private_key = _get_lighter_credentials(session, user)
        return await service.update_leverage_by_symbol_with_credentials(
            request,
            account_index=account_index,
            api_key_index=api_key_index,
            private_key=private_key,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@app.post("/orders/grvt", response_model=GrvtOrderResponse)
async def create_grvt_order(
    order: GrvtOrderRequest,
    service: GrvtService = Depends(get_grvt_service),
    broadcaster: EventBroadcaster = Depends(get_broadcaster),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    try:
        api_key, private_key, trading_account_id = _get_grvt_credentials(session, user)
        response = await service.place_order_with_credentials(
            order,
            api_key=api_key,
            private_key=private_key,
            trading_account_id=trading_account_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    await broadcaster.publish(
        OrderEvent(
            venue="grvt",
            payload={"request": order.model_dump(), "response": response.model_dump()},
            created_at=datetime.now(tz=timezone.utc),
        ).model_dump()
    )
    return response


@app.post("/arb/open", response_model=ArbOpenResponse)
async def open_arb_position(
    request: ArbOpenRequest,
    session: Session = Depends(get_session),
    lighter: LighterService = Depends(get_lighter_service),
    grvt: GrvtService = Depends(get_grvt_service),
    user: User = Depends(get_current_user),
) -> ArbOpenResponse:
    try:
        position, risk_tasks = ArbService(session).open_position(request, user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    lighter_account_index, lighter_api_key_index, lighter_private_key = _get_lighter_credentials(session, user)
    grvt_api_key, grvt_private_key, grvt_trading_account_id = _get_grvt_credentials(session, user)

    now = datetime.utcnow()
    client_base = int(now.timestamp() * 1000) % 2_147_483_647

    def _record_order(
        *,
        venue: str,
        side: str,
        price: float,
        size: float,
        reduce_only: bool,
        request_payload: dict,
        response_payload: dict,
        status_value: OrderStatus,
    ) -> None:
        session.add(
            OrderLog(
                arb_position_id=position.id,
                venue=venue,
                side=side,
                price=price,
                size=size,
                reduce_only=reduce_only,
                request_payload=request_payload,
                response_payload=response_payload,
                status=status_value,
                created_at=now,
                updated_at=now,
            )
        )

    async def place_for_venue(
        venue: str,
        side: str,
        price: float,
        size: float,
        client_index: int,
    ) -> bool:
        try:
            if venue == "lighter":
                order = LighterSymbolOrderRequest(
                    symbol=request.symbol,
                    client_order_index=client_index,
                    side=side,
                    base_amount=size,
                    price=price,
                    reduce_only=False,
                    time_in_force="post_only",
                )
                response = await lighter.place_order_by_symbol_with_credentials(
                    order,
                    account_index=lighter_account_index,
                    api_key_index=lighter_api_key_index,
                    private_key=lighter_private_key,
                )
                _record_order(
                    venue="lighter",
                    side=side,
                    price=price,
                    size=size,
                    reduce_only=False,
                    request_payload=order.model_dump(),
                    response_payload=response.model_dump(),
                    status_value=OrderStatus.accepted,
                )
                return True
            order = GrvtOrderRequest(
                symbol=request.symbol,
                side=side,
                amount=size,
                price=price,
                post_only=True,
                reduce_only=False,
                order_duration_secs=None,
                client_order_id=client_index,
            )
            response = await grvt.place_order_with_credentials(
                order,
                api_key=grvt_api_key,
                private_key=grvt_private_key,
                trading_account_id=grvt_trading_account_id,
            )
            _record_order(
                venue="grvt",
                side=side,
                price=price,
                size=size,
                reduce_only=False,
                request_payload=order.model_dump(),
                response_payload=response.model_dump(),
                status_value=OrderStatus.accepted,
            )
            return True
        except Exception as exc:  # noqa: BLE001
            logging.error(
                "arb order failed venue=%s symbol=%s side=%s price=%s size=%s error=%s",
                venue,
                request.symbol,
                side,
                price,
                size,
                exc,
            )
            _record_order(
                venue=venue,
                side=side,
                price=price,
                size=size,
                reduce_only=False,
                request_payload={
                    "symbol": request.symbol,
                    "side": side,
                    "size": size,
                    "price": price,
                },
                response_payload={"error": str(exc)},
                status_value=OrderStatus.failed,
            )
            return False

    left_ok, right_ok = await asyncio.gather(
        place_for_venue(
            request.left_venue,
            request.left_side,
            request.left_price,
            request.left_size,
            client_base,
        ),
        place_for_venue(
            request.right_venue,
            request.right_side,
            request.right_price,
            request.right_size,
            client_base + 1,
        ),
    )

    if left_ok and right_ok:
        position.status = ArbPositionStatus.pending
    elif left_ok or right_ok:
        position.status = ArbPositionStatus.partially_filled
    else:
        position.status = ArbPositionStatus.failed
    position.updated_at = datetime.utcnow()
    session.add(position)
    session.commit()

    return ArbOpenResponse(
        arb_position_id=str(position.id),
        status=position.status.value,
        risk_task_ids=[str(task.id) for task in risk_tasks],
    )


@app.post("/arb/close", response_model=ArbCloseResponse)
async def close_arb_position(
    request: ArbCloseRequest,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> ArbCloseResponse:
    try:
        return ArbService(session).close_position(request)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/arb/status/{arb_position_id}", response_model=ArbStatusResponse)
async def get_arb_status(
    arb_position_id: str,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> ArbStatusResponse:
    try:
        return ArbService(session).get_status(arb_position_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/perp-snapshot", response_model=PerpSnapshot)
async def perp_snapshot(
    payload: PerpSnapshotRequest,
    service: MarketDataService = Depends(get_market_data_service),
) -> PerpSnapshot:
    try:
        return await service.get_perp_snapshot(payload.primary_source, payload.secondary_source)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@app.post("/available-symbols", response_model=AvailableSymbolsResponse)
async def available_symbols(
    payload: AvailableSymbolsRequest,
    service: MarketDataService = Depends(get_market_data_service),
) -> AvailableSymbolsResponse:
    try:
        symbols, fetched_at = await service.get_available_symbols(
            primary=payload.primary_source,
            secondary=payload.secondary_source,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return AvailableSymbolsResponse(symbols=symbols, fetched_at=fetched_at)


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


@app.post("/funding-prediction", response_model=FundingPredictionResponse)
async def funding_prediction(
    payload: FundingPredictionRequest,
    service: MarketDataService = Depends(get_market_data_service),
) -> FundingPredictionResponse:
    try:
        snapshot = await service.get_funding_prediction_snapshot(
            primary=payload.primary_source,
            secondary=payload.secondary_source,
            volume_threshold=payload.volume_threshold,
            force_refresh=payload.force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return snapshot


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
            force_refresh=payload.force_refresh,
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


@app.post("/admin/users", response_model=AdminUserResponse)
async def create_user(
    payload: AdminCreateUserRequest,
    request: Request,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_admin),
) -> AdminUserResponse:
    verify_admin_registration_secret(request)
    existing = session.exec(
        select(User).where(User.username == payload.username, User.deleted_at.is_(None))
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")

    salt = os.urandom(16)
    now = datetime.utcnow()
    try:
        lighter_private_key_enc = (
            encrypt_secret(payload.lighter_private_key) if payload.lighter_private_key else None
        )
        grvt_api_key_enc = encrypt_secret(payload.grvt_api_key) if payload.grvt_api_key else None
        grvt_private_key_enc = encrypt_secret(payload.grvt_private_key) if payload.grvt_private_key else None
        grvt_trading_account_id = payload.grvt_trading_account_id
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    user = User(
        username=payload.username,
        password_hash=_hash_password(payload.password, salt),
        password_salt=salt.hex(),
        is_active=payload.is_active,
        is_admin=payload.is_admin,
        created_at=now,
        updated_at=now,
    )
    profile = TradingProfile(
        user_id=user.id,
        lighter_account_index=payload.lighter_account_index,
        lighter_api_key_index=payload.lighter_api_key_index,
        lighter_private_key_enc=lighter_private_key_enc,
        grvt_api_key_enc=grvt_api_key_enc,
        grvt_private_key_enc=grvt_private_key_enc,
        grvt_trading_account_id=grvt_trading_account_id,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    session.add(profile)
    session.commit()
    session.refresh(user)
    return AdminUserResponse(
        id=str(user.id),
        username=user.username,
        is_admin=user.is_admin,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@app.get("/admin/users", response_model=AdminUserListResponse)
async def list_users(
    session: Session = Depends(get_session),
    _: User = Depends(get_current_admin),
) -> AdminUserListResponse:
    users = session.exec(
        select(User)
        .where(User.deleted_at.is_(None))
        .order_by(User.created_at.desc())
    ).all()
    user_ids = [user.id for user in users]
    profiles = session.exec(
        select(TradingProfile).where(
            TradingProfile.user_id.in_(user_ids),
            TradingProfile.deleted_at.is_(None),
        )
    ).all()
    profile_by_user_id = {profile.user_id: profile for profile in profiles}
    summaries: list[AdminUserSummary] = []
    for user in users:
        profile = profile_by_user_id.get(user.id)

        lighter_private_key: str | None = None
        grvt_api_key: str | None = None
        grvt_private_key: str | None = None
        if profile is not None:
            try:
                lighter_private_key = (
                    decrypt_secret(profile.lighter_private_key_enc)
                    if profile.lighter_private_key_enc
                    else None
                )
                grvt_api_key = decrypt_secret(profile.grvt_api_key_enc) if profile.grvt_api_key_enc else None
                grvt_private_key = (
                    decrypt_secret(profile.grvt_private_key_enc)
                    if profile.grvt_private_key_enc
                    else None
                )
            except ValueError:
                lighter_private_key = None
                grvt_api_key = None
                grvt_private_key = None

        summaries.append(
            AdminUserSummary(
                id=str(user.id),
                username=user.username,
                is_admin=user.is_admin,
                is_active=user.is_active,
                failed_attempts=user.failed_attempts,
                locked_until=user.locked_until,
                created_at=user.created_at,
                updated_at=user.updated_at,
                has_lighter_credentials=bool(
                    profile
                    and profile.lighter_account_index is not None
                    and profile.lighter_api_key_index is not None
                    and profile.lighter_private_key_enc
                ),
                has_grvt_credentials=bool(
                    profile
                    and profile.grvt_api_key_enc
                    and profile.grvt_private_key_enc
                    and profile.grvt_trading_account_id
                ),
                lighter_account_index=profile.lighter_account_index if profile else None,
                lighter_api_key_index=profile.lighter_api_key_index if profile else None,
                lighter_private_key_configured=bool(profile and profile.lighter_private_key_enc),
                lighter_private_key=lighter_private_key,
                grvt_trading_account_id=profile.grvt_trading_account_id if profile else None,
                grvt_api_key_configured=bool(profile and profile.grvt_api_key_enc),
                grvt_private_key_configured=bool(profile and profile.grvt_private_key_enc),
                grvt_api_key=grvt_api_key,
                grvt_private_key=grvt_private_key,
            )
        )

    return AdminUserListResponse(users=summaries)


@app.post("/admin/users/{user_id}/reset-password", response_model=AdminResetPasswordResponse)
async def reset_user_password(
    user_id: UUID,
    request: Request,
    payload: AdminResetPasswordRequest,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_admin),
) -> AdminResetPasswordResponse:
    verify_admin_registration_secret(request)

    user = session.exec(
        select(User).where(
            User.id == user_id,
            User.deleted_at.is_(None),
        )
    ).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    new_password = payload.new_password or _generate_temporary_password()
    salt = os.urandom(16)
    now = datetime.utcnow()
    user.password_hash = _hash_password(new_password, salt)
    user.password_salt = salt.hex()
    user.failed_attempts = 0
    user.failed_first_at = None
    user.locked_until = None
    user.updated_at = now

    session.add(user)
    session.commit()
    session.refresh(user)

    return AdminResetPasswordResponse(
        id=str(user.id),
        username=user.username,
        updated_at=user.updated_at,
        temporary_password=new_password,
    )


@app.websocket("/ws/events")
async def ws_events(
    websocket: WebSocket,
    broadcaster: EventBroadcaster = Depends(get_broadcaster),
    manager: AuthManager = Depends(get_auth_manager),
    session: Session = Depends(get_session),
):
    try:
        await authenticate_websocket(websocket, manager, session)
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
    grvt: GrvtService = Depends(get_grvt_service),
    manager: AuthManager = Depends(get_auth_manager),
    session: Session = Depends(get_session),
):
    try:
        user = await authenticate_websocket(websocket, manager, session)
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
        tasks.append(
            asyncio.create_task(
                forward_updates("lighter_trades", lighter.stream_trades(subscription.symbol, limit=50))
            )
        )
        try:
            grvt_api_key, grvt_private_key, grvt_trading_account_id = _get_grvt_credentials(session, user)
        except HTTPException as exc:
            await websocket.send_json({"error": exc.detail})
            await websocket.close()
            return
        tasks.append(
            asyncio.create_task(
                forward_updates(
                    "grvt",
                    grvt.stream_orderbook_with_credentials(
                        subscription.symbol,
                        subscription.depth,
                        api_key=grvt_api_key,
                        private_key=grvt_private_key,
                        trading_account_id=grvt_trading_account_id,
                    ),
                )
            )
        )
        tasks.append(
            asyncio.create_task(
                forward_updates(
                    "grvt_trades",
                    grvt.stream_trades_with_credentials(
                        subscription.symbol,
                        limit=50,
                        api_key=grvt_api_key,
                        private_key=grvt_private_key,
                        trading_account_id=grvt_trading_account_id,
                    ),
                )
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
                snapshot = {
                    "orderbooks": OrderBookSnapshot(
                        lighter=latest_snapshots.get("lighter"),
                        grvt=latest_snapshots.get("grvt"),
                    ).model_dump(),
                    "trades": TradesSnapshot(
                        lighter=latest_snapshots.get("lighter_trades") or [],
                        grvt=latest_snapshots.get("grvt_trades") or [],
                    ).model_dump(),
                }
                try:
                    await websocket.send_json(snapshot)
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
