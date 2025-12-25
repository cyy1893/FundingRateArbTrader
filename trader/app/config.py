from __future__ import annotations

from functools import lru_cache
from typing import Literal, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Runtime configuration loaded from environment variables or a .env file.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    lighter_base_url: str = Field("https://mainnet.zklighter.elliot.ai", description="Lighter REST/WebSocket endpoint")
    lighter_private_key: str = Field(..., description="Hex encoded L1 private key for the Lighter API key")
    lighter_account_index: int = Field(..., description="Primary Lighter account index")
    lighter_api_key_index: int = Field(..., description="API key slot to use when signing orders")
    lighter_max_api_key_index: Optional[int] = Field(
        default=None, description="Optional inclusive max api key index for multi key rotations"
    )
    lighter_nonce_manager: Literal["optimistic", "api"] = Field(
        "optimistic", description="Nonce manager to use when signing Lighter requests"
    )
    grvt_env: Literal["prod", "testnet", "staging", "dev"] = Field(
        "prod", description="Target GRVT environment for public market data"
    )
    grvt_api_key: str = Field(..., description="GRVT API key for authenticated calls")
    grvt_private_key: str = Field(..., description="GRVT private key used for signing")
    grvt_trading_account_id: str = Field(..., description="GRVT trading account identifier")
    grvt_endpoint_version: str = Field("v1", description="GRVT REST endpoint version (GRVT_END_POINT_VERSION)")
    grvt_ws_stream_version: str = Field(
        "v1", description="GRVT websocket stream version (GRVT_WS_STREAM_VERSION)"
    )
    auth_users: str = Field(
        ...,
        description="Comma-separated username:password pairs for local auth (e.g. alice:pass,bob:pass)",
    )
    auth_jwt_secret: str = Field(..., description="Secret key used to sign JWTs")
    auth_jwt_algorithm: str = Field("HS256", description="JWT signing algorithm")
    auth_token_ttl_minutes: int = Field(7 * 24 * 60, description="Access token lifetime in minutes")
    auth_lockout_threshold: int = Field(3, description="Number of failed logins before lockout")
    auth_lockout_minutes: int = Field(60, description="Lockout duration in minutes after threshold is reached")


@lru_cache
def get_settings() -> Settings:
    """
    Cached accessor so dependency injection reuses the same Settings instance.
    """

    return Settings()  # type: ignore[arg-type]
