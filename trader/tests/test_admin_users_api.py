from __future__ import annotations

import os
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

os.environ.setdefault("ADMIN_REGISTRATION_SECRET", "test-admin-secret")
os.environ.setdefault("AUTH_JWT_SECRET", "test-jwt-secret")

from app.db_models import User, uuid7  # noqa: E402
from app.db_session import get_session  # noqa: E402
from app.main import app, grvt_service, lighter_service, settings  # noqa: E402
from app.utils.auth import _hash_password  # noqa: E402


def _create_user(
    session: Session,
    username: str,
    password: str,
    *,
    is_admin: bool,
    is_active: bool = True,
) -> None:
    salt = os.urandom(16)
    now = datetime.utcnow()
    user = User(
        id=uuid7(),
        username=username,
        password_hash=_hash_password(password, salt),
        password_salt=salt.hex(),
        is_admin=is_admin,
        is_active=is_active,
        created_at=now,
        updated_at=now,
    )
    session.add(user)
    session.commit()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)

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
        _create_user(session, "admin", "admin-pass", is_admin=True)
        _create_user(session, "trader", "user-pass", is_admin=False)

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def _login_token(client: TestClient, username: str, password: str) -> str:
    response = client.post("/login", json={"username": username, "password": password})
    assert response.status_code == 200
    payload = response.json()
    token = payload.get("access_token")
    assert isinstance(token, str) and token
    return token


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


def test_admin_users_list_requires_admin(client: TestClient) -> None:
    user_token = _login_token(client, "trader", "user-pass")
    response = client.get("/admin/users", headers={"Authorization": f"Bearer {user_token}"})
    assert response.status_code == 403


def test_admin_users_list_masks_sensitive_fields(client: TestClient) -> None:
    admin_token = _login_token(client, "admin", "admin-pass")
    response = client.get("/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
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
    assert "lighter_private_key" in first_user
    assert "grvt_trading_account_id" in first_user
    assert "grvt_api_key_configured" in first_user
    assert "grvt_private_key_configured" in first_user
    assert "grvt_api_key" in first_user
    assert "grvt_private_key" in first_user


def test_admin_create_user_requires_client_secret(client: TestClient) -> None:
    admin_token = _login_token(client, "admin", "admin-pass")
    headers = {"Authorization": f"Bearer {admin_token}"}

    missing_secret = client.post(
        "/admin/users",
        json=_create_payload("alice"),
        headers=headers,
    )
    assert missing_secret.status_code == 403

    wrong_secret = client.post(
        "/admin/users",
        json=_create_payload("alice"),
        headers={**headers, settings.admin_client_header_name: "wrong-secret"},
    )
    assert wrong_secret.status_code == 403

    ok = client.post(
        "/admin/users",
        json=_create_payload("alice"),
        headers={**headers, settings.admin_client_header_name: settings.admin_registration_secret},
    )
    assert ok.status_code == 200
    assert ok.json()["username"] == "alice"


def test_admin_create_user_conflict(client: TestClient) -> None:
    admin_token = _login_token(client, "admin", "admin-pass")
    headers = {
        "Authorization": f"Bearer {admin_token}",
        settings.admin_client_header_name: settings.admin_registration_secret,
    }
    first = client.post("/admin/users", json=_create_payload("bob"), headers=headers)
    assert first.status_code == 200

    second = client.post("/admin/users", json=_create_payload("bob"), headers=headers)
    assert second.status_code == 409


def test_admin_create_user_requires_exchange_fields(client: TestClient) -> None:
    admin_token = _login_token(client, "admin", "admin-pass")
    headers = {
        "Authorization": f"Bearer {admin_token}",
        settings.admin_client_header_name: settings.admin_registration_secret,
    }
    response = client.post(
        "/admin/users",
        json={"username": "no-creds", "password": "pass"},
        headers=headers,
    )
    assert response.status_code == 422


def test_admin_reset_password_requires_client_secret(client: TestClient) -> None:
    admin_token = _login_token(client, "admin", "admin-pass")
    headers = {"Authorization": f"Bearer {admin_token}"}

    users_response = client.get("/admin/users", headers=headers)
    assert users_response.status_code == 200
    target = next(user for user in users_response.json()["users"] if user["username"] == "trader")
    user_id = target["id"]

    missing_secret = client.post(
        f"/admin/users/{user_id}/reset-password",
        json={},
        headers=headers,
    )
    assert missing_secret.status_code == 403

    wrong_secret = client.post(
        f"/admin/users/{user_id}/reset-password",
        json={},
        headers={**headers, settings.admin_client_header_name: "wrong-secret"},
    )
    assert wrong_secret.status_code == 403


def test_admin_reset_password_success_and_can_login(client: TestClient) -> None:
    admin_token = _login_token(client, "admin", "admin-pass")
    headers = {
        "Authorization": f"Bearer {admin_token}",
        settings.admin_client_header_name: settings.admin_registration_secret,
    }

    users_response = client.get("/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
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
