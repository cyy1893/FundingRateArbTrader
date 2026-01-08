from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


def _get_fernet() -> Fernet:
    settings = get_settings()
    if not settings.crypto_key:
        raise ValueError("CRYPTO_KEY is required for credential encryption")
    return Fernet(settings.crypto_key.encode("utf-8"))


def encrypt_secret(value: str) -> str:
    fernet = _get_fernet()
    token = fernet.encrypt(value.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(token: str) -> str:
    fernet = _get_fernet()
    try:
        payload = fernet.decrypt(token.encode("utf-8"))
    except InvalidToken as exc:  # noqa: BLE001
        raise ValueError("Invalid encrypted secret") from exc
    return payload.decode("utf-8")
