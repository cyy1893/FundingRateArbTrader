from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Tuple

import jwt


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


def parse_users(raw_users: list[str]) -> Dict[str, str]:
    """
    Parse a list of "username:password" strings into a mapping.
    """

    users: Dict[str, str] = {}
    for entry in raw_users:
        if ":" not in entry:
            raise ValueError("AUTH_USERS entries must be in the form username:password")
        username, password = entry.split(":", 1)
        username = username.strip()
        if not username or not password:
            raise ValueError("AUTH_USERS entries require both username and password")
        users[username] = password
    if not users:
        raise ValueError("At least one user must be configured in AUTH_USERS")
    return users


class AuthManager:
    """
    Simple in-memory authenticator that issues JWTs and tracks lockouts.
    """

    def __init__(
        self,
        users: Dict[str, str],
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
        self._users = {user: self._hash_password(password) for user, password in users.items()}
        self._failed_attempts: Dict[str, list[float]] = {}
        self._locked_until: Dict[str, float] = {}

    @staticmethod
    def _hash_password(password: str) -> str:
        return hashlib.sha256(password.encode()).hexdigest()

    def _password_matches(self, username: str, password: str) -> bool:
        stored = self._users.get(username)
        if stored is None:
            return False
        candidate = self._hash_password(password)
        return hmac.compare_digest(stored, candidate)

    def _record_failure(self, username: str) -> None:
        now = time.time()
        window_start = now - self._lockout_window.total_seconds()
        attempts = [ts for ts in self._failed_attempts.get(username, []) if ts >= window_start]
        attempts.append(now)
        self._failed_attempts[username] = attempts
        if len(attempts) >= self._lockout_threshold:
            self._locked_until[username] = now + self._lockout_window.total_seconds()
            self._failed_attempts[username] = []

    def _clear_failures(self, username: str) -> None:
        self._failed_attempts.pop(username, None)

    def _is_locked(self, username: str) -> Tuple[bool, float | None]:
        locked_until = self._locked_until.get(username)
        if locked_until is None:
            return False, None
        if locked_until <= time.time():
            self._locked_until.pop(username, None)
            return False, None
        return True, locked_until

    def authenticate(self, username: str, password: str) -> Tuple[str, int]:
        locked, locked_until = self._is_locked(username)
        if locked and locked_until is not None:
            raise LockoutError(datetime.fromtimestamp(locked_until, tz=timezone.utc))

        if not self._password_matches(username, password):
            self._record_failure(username)
            raise AuthError("Invalid username or password")

        self._clear_failures(username)
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

        return username

