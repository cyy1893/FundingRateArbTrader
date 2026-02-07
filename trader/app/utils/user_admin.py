from __future__ import annotations

import argparse
import os
from datetime import datetime

from sqlmodel import Session, select

from app.db_models import TradingProfile, User, uuid7
from app.db_session import get_engine
from app.utils.auth import _hash_password
from app.utils.crypto import encrypt_secret


def create_user(
    username: str,
    password: str,
    is_admin: bool,
    lighter_account_index: int | None,
    lighter_api_key_index: int | None,
    lighter_private_key: str | None,
    grvt_api_key: str | None,
    grvt_private_key: str | None,
    grvt_trading_account_id: str | None,
) -> None:
    engine = get_engine()
    with Session(engine) as session:
        existing = session.exec(select(User).where(User.username == username, User.deleted_at.is_(None))).first()
        if existing:
            raise ValueError("User already exists")
        salt = os.urandom(16)
        now = datetime.utcnow()
        user = User(
            id=uuid7(),
            username=username,
            password_hash=_hash_password(password, salt),
            password_salt=salt.hex(),
            is_active=True,
            is_admin=is_admin,
            created_at=now,
            updated_at=now,
        )
        profile = TradingProfile(
            user_id=user.id,
            lighter_account_index=lighter_account_index,
            lighter_api_key_index=lighter_api_key_index,
            lighter_private_key_enc=encrypt_secret(lighter_private_key) if lighter_private_key else None,
            grvt_api_key_enc=encrypt_secret(grvt_api_key) if grvt_api_key else None,
            grvt_private_key_enc=encrypt_secret(grvt_private_key) if grvt_private_key else None,
            grvt_trading_account_id=grvt_trading_account_id,
            created_at=now,
            updated_at=now,
        )
        session.add(user)
        session.add(profile)
        session.commit()


def update_password(username: str, password: str) -> None:
    engine = get_engine()
    with Session(engine) as session:
        user = session.exec(select(User).where(User.username == username, User.deleted_at.is_(None))).first()
        if not user:
            raise ValueError("User not found")
        salt = os.urandom(16)
        user.password_hash = _hash_password(password, salt)
        user.password_salt = salt.hex()
        user.updated_at = datetime.utcnow()
        session.add(user)
        session.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Admin user management")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_cmd = subparsers.add_parser("create", help="Create a user")
    create_cmd.add_argument("--username", required=True)
    create_cmd.add_argument("--password", required=True)
    create_cmd.add_argument("--admin", action="store_true")
    create_cmd.add_argument("--lighter-account-index", type=int)
    create_cmd.add_argument("--lighter-api-key-index", type=int)
    create_cmd.add_argument("--lighter-private-key")
    create_cmd.add_argument("--grvt-api-key")
    create_cmd.add_argument("--grvt-private-key")
    create_cmd.add_argument("--grvt-trading-account-id")

    update_cmd = subparsers.add_parser("set-password", help="Update a user password")
    update_cmd.add_argument("--username", required=True)
    update_cmd.add_argument("--password", required=True)

    args = parser.parse_args()
    if args.command == "create":
        create_user(
            args.username,
            args.password,
            args.admin,
            args.lighter_account_index,
            args.lighter_api_key_index,
            args.lighter_private_key,
            args.grvt_api_key,
            args.grvt_private_key,
            args.grvt_trading_account_id,
        )
        print("User created")
    elif args.command == "set-password":
        update_password(args.username, args.password)
        print("Password updated")


if __name__ == "__main__":
    main()
