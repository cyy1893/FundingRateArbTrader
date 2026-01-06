from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone
from typing import Tuple

import jwt
from sqlmodel import Session, select

from app.db_models import User


class AuthError(Exception):
    """Raised when authentication or authorization fails."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class LockoutError(AuthError):
    """Raised when an account is temporarily locked out after repeated failures."""

    def __init__(self, until: datetime):
        super().__init__("Account temporarily locked due to failed attempts.")
        self.until = until


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000).hex()


def _verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    candidate = _hash_password(password, salt)
    return hmac.compare_digest(candidate, hash_hex)


class AuthManager:
    """
    Simple in-memory authenticator that issues JWTs and tracks lockouts.
    """

    def __init__(
        self,
        session: Session,
        secret: str,
        algorithm: str = "HS256",
        token_ttl_minutes: int = 60,
        lockout_threshold: int = 3,
        lockout_minutes: int = 60,
    ):
        self._secret = secret
        self._algorithm = algorithm
        self._token_ttl = timedelta(minutes=token_ttl_minutes)
        self._lockout_threshold = lockout_threshold
        self._lockout_window = timedelta(minutes=lockout_minutes)
        self._session = session

    def _is_locked(self, user: User) -> Tuple[bool, float | None]:
        if user.locked_until is None:
            return False, None
        locked_until_ts = user.locked_until.replace(tzinfo=timezone.utc).timestamp()
        if locked_until_ts <= time.time():
            user.locked_until = None
            user.failed_attempts = 0
            user.failed_first_at = None
            self._session.add(user)
            self._session.commit()
            return False, None
        return True, locked_until_ts

    def authenticate(self, username: str, password: str) -> Tuple[str, int]:
        user = self._session.exec(
            select(User).where(User.username == username, User.deleted_at.is_(None))
        ).first()
        if user is None or not user.is_active:
            raise AuthError("Invalid username or password")

        locked, locked_until = self._is_locked(user)
        if locked and locked_until is not None:
            raise LockoutError(datetime.fromtimestamp(locked_until, tz=timezone.utc))

        if not _verify_password(password, user.password_salt, user.password_hash):
            now = datetime.now(tz=timezone.utc)
            if not user.failed_first_at or (now - user.failed_first_at) > self._lockout_window:
                user.failed_first_at = now
                user.failed_attempts = 1
            else:
                user.failed_attempts += 1
            if user.failed_attempts >= self._lockout_threshold:
                user.locked_until = now + self._lockout_window
                user.failed_attempts = 0
                user.failed_first_at = None
            user.updated_at = datetime.utcnow()
            self._session.add(user)
            self._session.commit()
            raise AuthError("Invalid username or password")

        user.failed_attempts = 0
        user.failed_first_at = None
        user.locked_until = None
        user.updated_at = datetime.utcnow()
        self._session.add(user)
        self._session.commit()
        return self._create_token(username)

    def _create_token(self, username: str) -> Tuple[str, int]:
        now = datetime.now(tz=timezone.utc)
        expires_at = now + self._token_ttl
        payload = {
            "sub": username,
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
        }
        token = jwt.encode(payload, self._secret, algorithm=self._algorithm)
        return token, int(self._token_ttl.total_seconds())

    def validate_token(self, token: str) -> str:
        if not token:
            raise AuthError("Missing authorization token")
        try:
            payload = jwt.decode(token, self._secret, algorithms=[self._algorithm])
            username = payload.get("sub")
        except jwt.ExpiredSignatureError as exc:
            raise AuthError("Token has expired") from exc
        except jwt.InvalidTokenError as exc:
            raise AuthError("Invalid token") from exc

        if not username:
            raise AuthError("Invalid token payload")
        user = self._session.exec(
            select(User).where(User.username == username, User.deleted_at.is_(None))
        ).first()
        if user is None or not user.is_active:
            raise AuthError("Invalid token payload")

        return username
