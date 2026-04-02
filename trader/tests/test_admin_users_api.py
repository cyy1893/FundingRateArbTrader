from __future__ import annotations

import asyncio
import os
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

os.environ["ADMIN_REGISTRATION_SECRET"] = "test-admin-secret"
os.environ["AUTH_JWT_SECRET"] = "test-jwt-secret"

import app.main as main_module  # noqa: E402

from app.db_models import ArbPosition, ArbPositionStatus, RiskTask, RiskTaskStatus, RiskTaskType, User, uuid7  # noqa: E402
from app.db_session import get_session  # noqa: E402
from app.events import EventBroadcaster  # noqa: E402
from app.main import _user_cache, app, grvt_service, lighter_service, settings  # noqa: E402
from app.models import ArbOpenRequest, GrvtBalanceSnapshot, GrvtOrderResponse, GrvtPositionBalance, LighterBalanceSnapshot, LighterOrderResponse, LighterPositionBalance  # noqa: E402
from app.services.arb_service import ArbService  # noqa: E402
from app.utils.auth import _hash_password  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(_element, _compiler, **_kwargs) -> str:
    return "JSON"


def _create_user(
    session: Session,
    username: str,
    password: str,
    *,
    is_active: bool = True,
) -> None:
    salt = os.urandom(16)
    now = datetime.utcnow()
    user = User(
        id=uuid7(),
        username=username,
        password_hash=_hash_password(password, salt),
        password_salt=salt.hex(),
        is_active=is_active,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    session.commit()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    app.state.test_engine = engine
    _user_cache.clear()

    def override_get_session():
        with Session(engine) as session:
            yield session

    async def _noop() -> None:
        return None

    app.dependency_overrides[get_session] = override_get_session
    monkeypatch.setattr(lighter_service, "start", _noop)
    monkeypatch.setattr(lighter_service, "stop", _noop)
    monkeypatch.setattr(grvt_service, "start", _noop)
    monkeypatch.setattr(grvt_service, "stop", _noop)

    with Session(engine) as session:
        _create_user(session, "admin", "admin-pass")
        _create_user(session, "trader", "user-pass")

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    _user_cache.clear()


def _create_payload(username: str) -> dict:
    return {
        "username": username,
        "password": f"{username}-pass",
        "lighter_account_index": 1,
        "lighter_api_key_index": 0,
        "lighter_private_key": "0xabc123",
        "grvt_api_key": "grvt-api-key",
        "grvt_private_key": "grvt-private-key",
        "grvt_trading_account_id": "grvt-account-id",
    }


def test_admin_users_list_requires_client_secret(client: TestClient) -> None:
    response = client.get("/admin/users")
    assert response.status_code == 403

    wrong_secret = client.get(
        "/admin/users",
        headers={settings.admin_client_header_name: "wrong-secret"},
    )
    assert wrong_secret.status_code == 403

    ok = client.get(
        "/admin/users",
        headers={settings.admin_client_header_name: settings.admin_registration_secret},
    )
    assert ok.status_code == 200


def test_admin_users_list_masks_sensitive_fields(client: TestClient) -> None:
    response = client.get(
        "/admin/users",
        headers={settings.admin_client_header_name: settings.admin_registration_secret},
    )
    assert response.status_code == 200

    payload = response.json()
    assert "users" in payload
    first_user = payload["users"][0]
    assert "password_hash" not in first_user
    assert "password_salt" not in first_user
    assert "lighter_private_key_enc" not in first_user
    assert "grvt_api_key_enc" not in first_user
    assert "grvt_private_key_enc" not in first_user
    assert "has_lighter_credentials" in first_user
    assert "has_grvt_credentials" in first_user
    assert "lighter_account_index" in first_user
    assert "lighter_api_key_index" in first_user
    assert "lighter_private_key_configured" in first_user
    assert "grvt_trading_account_id" in first_user
    assert "grvt_api_key_configured" in first_user
    assert "grvt_private_key_configured" in first_user
    assert "lighter_private_key" not in first_user
    assert "grvt_api_key" not in first_user
    assert "grvt_private_key" not in first_user


def test_admin_create_user_requires_client_secret(client: TestClient) -> None:
    missing_secret = client.post(
        "/admin/users",
        json=_create_payload("alice"),
    )
    assert missing_secret.status_code == 403

    wrong_secret = client.post(
        "/admin/users",
        json=_create_payload("alice"),
        headers={settings.admin_client_header_name: "wrong-secret"},
    )
    assert wrong_secret.status_code == 403

    ok = client.post(
        "/admin/users",
        json=_create_payload("alice"),
        headers={settings.admin_client_header_name: settings.admin_registration_secret},
    )
    assert ok.status_code == 200
    assert ok.json()["username"] == "alice"


def test_admin_create_user_conflict(client: TestClient) -> None:
    headers = {
        settings.admin_client_header_name: settings.admin_registration_secret,
    }
    first = client.post("/admin/users", json=_create_payload("bob"), headers=headers)
    assert first.status_code == 200

    second = client.post("/admin/users", json=_create_payload("bob"), headers=headers)
    assert second.status_code == 409


def test_admin_create_user_requires_exchange_fields(client: TestClient) -> None:
    headers = {
        settings.admin_client_header_name: settings.admin_registration_secret,
    }
    response = client.post(
        "/admin/users",
        json={"username": "no-creds", "password": "pass"},
        headers=headers,
    )
    assert response.status_code == 422


def test_admin_reset_password_requires_client_secret(client: TestClient) -> None:
    users_response = client.get(
        "/admin/users",
        headers={settings.admin_client_header_name: settings.admin_registration_secret},
    )
    assert users_response.status_code == 200
    target = next(user for user in users_response.json()["users"] if user["username"] == "trader")
    user_id = target["id"]

    missing_secret = client.post(
        f"/admin/users/{user_id}/reset-password",
        json={},
    )
    assert missing_secret.status_code == 403

    wrong_secret = client.post(
        f"/admin/users/{user_id}/reset-password",
        json={},
        headers={settings.admin_client_header_name: "wrong-secret"},
    )
    assert wrong_secret.status_code == 403


def test_admin_reset_password_success_and_can_login(client: TestClient) -> None:
    headers = {
        settings.admin_client_header_name: settings.admin_registration_secret,
    }

    users_response = client.get("/admin/users", headers=headers)
    assert users_response.status_code == 200
    target = next(user for user in users_response.json()["users"] if user["username"] == "trader")
    user_id = target["id"]

    reset_response = client.post(
        f"/admin/users/{user_id}/reset-password",
        json={},
        headers=headers,
    )
    assert reset_response.status_code == 200
    reset_payload = reset_response.json()
    assert reset_payload["username"] == "trader"
    assert isinstance(reset_payload["temporary_password"], str)
    assert reset_payload["temporary_password"]

    old_login = client.post("/login", json={"username": "trader", "password": "user-pass"})
    assert old_login.status_code == 401

    new_login = client.post(
        "/login",
        json={"username": "trader", "password": reset_payload["temporary_password"]},
    )
    assert new_login.status_code == 200


def _login_token(client: TestClient, username: str, password: str) -> str:
    response = client.post("/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def _create_position(session: Session, user_id) -> str:
    now = datetime.utcnow()
    position = ArbPosition(
        id=uuid7(),
        user_id=user_id,
        symbol="BTC",
        left_venue="lighter",
        right_venue="grvt",
        left_side="buy",
        right_side="sell",
        notional=1000.0,
        leverage_left=2.0,
        leverage_right=2.0,
        status=ArbPositionStatus.pending,
        opened_at=now,
        created_at=now,
        updated_at=now,
    )
    session.add(position)
    session.commit()
    return str(position.id)


def test_arb_status_and_close_are_user_scoped(client: TestClient) -> None:
    with Session(app.state.test_engine) as session:
        trader = session.exec(select(User).where(User.username == "trader")).first()
        admin = session.exec(select(User).where(User.username == "admin")).first()
        assert trader is not None
        assert admin is not None
        position_id = _create_position(session, trader.id)

    trader_token = _login_token(client, "trader", "user-pass")
    admin_token = _login_token(client, "admin", "admin-pass")

    owner_status = client.get(
        f"/arb/status/{position_id}",
        headers={"Authorization": f"Bearer {trader_token}"},
    )
    assert owner_status.status_code == 200
    assert owner_status.json()["arb_position"]["id"] == position_id

    other_status = client.get(
        f"/arb/status/{position_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert other_status.status_code == 404

    other_close = client.post(
        "/arb/close",
        json={"arb_position_id": position_id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert other_close.status_code == 404

    owner_close = client.post(
        "/arb/close",
        json={"arb_position_id": position_id},
        headers={"Authorization": f"Bearer {trader_token}"},
    )
    assert owner_close.status_code == 200
    assert owner_close.json()["status"] == "closed"


@pytest.mark.anyio
async def test_event_broadcaster_scopes_events_to_user_channel() -> None:
    broadcaster = EventBroadcaster()
    trader_queue = await broadcaster.register("trader-user-id")
    admin_queue = await broadcaster.register("admin-user-id")
    payload = {"venue": "lighter", "payload": {"ok": True}}

    await broadcaster.publish("trader-user-id", payload)

    assert await asyncio.wait_for(trader_queue.get(), timeout=0.2) == payload
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(admin_queue.get(), timeout=0.2)

    await broadcaster.unregister("trader-user-id", trader_queue)
    await broadcaster.unregister("admin-user-id", admin_queue)


def test_open_position_creates_auto_close_and_liquidation_tasks(client: TestClient) -> None:
    with Session(app.state.test_engine) as session:
        trader = session.exec(select(User).where(User.username == "trader")).first()
        assert trader is not None
        request = ArbOpenRequest(
            symbol="BTC",
            left_venue="lighter",
            right_venue="grvt",
            left_side="buy",
            right_side="sell",
            left_price=100.0,
            right_price=101.0,
            left_size=1.0,
            right_size=1.0,
            notional=100.0,
            leverage_left=2.0,
            leverage_right=2.0,
            auto_close_after_ms=30_000,
            liquidation_guard_enabled=True,
            liquidation_guard_threshold_pct=45.0,
        )

        position, tasks = ArbService(session).open_position(request, trader.id)

        assert position.meta is not None
        assert position.meta["auto_close_after_ms"] == 30_000
        assert {task.task_type for task in tasks} == {
            RiskTaskType.auto_close,
            RiskTaskType.liquidation_guard,
        }
        auto_close_task = next(task for task in tasks if task.task_type == RiskTaskType.auto_close)
        liquidation_task = next(task for task in tasks if task.task_type == RiskTaskType.liquidation_guard)
        assert auto_close_task.execute_at is not None
        assert liquidation_task.threshold_pct == 45.0


@pytest.mark.anyio
async def test_close_helper_sets_exiting_and_finalizes_risk_tasks(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with Session(app.state.test_engine) as session:
        trader = session.exec(select(User).where(User.username == "trader")).first()
        assert trader is not None
        now = datetime.utcnow()
        position = ArbPosition(
            id=uuid7(),
            user_id=trader.id,
            symbol="BTC",
            left_venue="lighter",
            right_venue="grvt",
            left_side="buy",
            right_side="sell",
            notional=1000.0,
            leverage_left=2.0,
            leverage_right=2.0,
            status=ArbPositionStatus.pending,
            opened_at=now,
            created_at=now,
            updated_at=now,
        )
        auto_task = RiskTask(
            arb_position_id=position.id,
            task_type=RiskTaskType.auto_close,
            enabled=True,
            status=RiskTaskStatus.pending,
            execute_at=now,
            created_at=now,
            updated_at=now,
        )
        liquidation_task = RiskTask(
            arb_position_id=position.id,
            task_type=RiskTaskType.liquidation_guard,
            enabled=True,
            status=RiskTaskStatus.pending,
            threshold_pct=50.0,
            created_at=now,
            updated_at=now,
        )
        session.add(position)
        session.add(auto_task)
        session.add(liquidation_task)
        session.commit()
        position_id = position.id
        auto_task_id = auto_task.id
        liquidation_task_id = liquidation_task.id

    async def _lighter_balances(*_args, **_kwargs):
        return LighterBalanceSnapshot(
            account_index=1,
            available_balance=0.0,
            collateral=0.0,
            total_asset_value=0.0,
            cross_asset_value=0.0,
            positions=[
                LighterPositionBalance(
                    market_id=1,
                    symbol="BTC",
                    sign=1,
                    position=1.0,
                    avg_entry_price=100.0,
                    position_value=100.0,
                    unrealized_pnl=0.0,
                    realized_pnl=0.0,
                    allocated_margin=10.0,
                )
            ],
        )

    async def _grvt_balances(*_args, **_kwargs):
        return GrvtBalanceSnapshot(
            sub_account_id="sub",
            settle_currency="USD",
            available_balance=0.0,
            total_equity=0.0,
            unrealized_pnl=0.0,
            balances=[],
            positions=[
                GrvtPositionBalance(
                    instrument="BTC_USD",
                    size=-1.0,
                    notional=100.0,
                    entry_price=100.0,
                    mark_price=100.0,
                    unrealized_pnl=0.0,
                    realized_pnl=0.0,
                    total_pnl=0.0,
                )
            ],
        )

    async def _lighter_order(*_args, **_kwargs):
        return LighterOrderResponse(tx_hash="0xabc", payload={"status": "accepted"})

    async def _grvt_order(*_args, **_kwargs):
        return GrvtOrderResponse(payload={"status": "accepted"})

    monkeypatch.setattr(main_module, "get_engine", lambda: app.state.test_engine)
    monkeypatch.setattr(main_module, "_get_lighter_credentials", lambda *_args, **_kwargs: (1, 0, "lighter-key"))
    monkeypatch.setattr(main_module, "_get_grvt_credentials", lambda *_args, **_kwargs: ("api", "pk", "acct"))
    monkeypatch.setattr(main_module, "_get_lighter_best_prices", lambda *_args, **_kwargs: asyncio.sleep(0, result=(99.0, 101.0)))
    monkeypatch.setattr(main_module, "_get_grvt_best_prices", lambda *_args, **_kwargs: asyncio.sleep(0, result=(99.0, 101.0, "BTC_USD")))
    monkeypatch.setattr(lighter_service, "get_balances_with_credentials", _lighter_balances)
    monkeypatch.setattr(grvt_service, "get_balances_with_credentials", _grvt_balances)
    monkeypatch.setattr(lighter_service, "place_order_by_symbol_with_credentials", _lighter_order)
    monkeypatch.setattr(grvt_service, "place_order_with_credentials", _grvt_order)

    result = await main_module._close_position_with_reduce_only_orders(
        position_id,
        triggered_task_id=auto_task_id,
        triggered_reason="auto close orders placed",
    )

    assert result["failed_reasons"] == []
    with Session(app.state.test_engine) as session:
        db_position = session.get(ArbPosition, position_id)
        db_auto_task = session.get(RiskTask, auto_task_id)
        db_liquidation_task = session.get(RiskTask, liquidation_task_id)
        assert db_position is not None
        assert db_position.status == ArbPositionStatus.exiting
        assert isinstance(db_position.close_order_ids, dict)
        assert "lighter" in db_position.close_order_ids
        assert "grvt" in db_position.close_order_ids
        assert db_auto_task is not None
        assert db_auto_task.status == RiskTaskStatus.triggered
        assert db_auto_task.trigger_reason == "auto close orders placed"
        assert db_liquidation_task is not None
        assert db_liquidation_task.status == RiskTaskStatus.canceled
        assert db_liquidation_task.trigger_reason == "position exiting"
