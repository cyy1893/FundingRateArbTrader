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
    lighter_private_key: str = Field("", description="Deprecated: Lighter private key (use user credentials)")
    lighter_account_index: int = Field(0, description="Deprecated: Lighter account index (use user credentials)")
    lighter_api_key_index: int = Field(0, description="Deprecated: Lighter API key index (use user credentials)")
    lighter_max_api_key_index: Optional[int] = Field(
        default=None, description="Optional inclusive max api key index for multi key rotations"
    )
    lighter_nonce_manager: Literal["optimistic", "api"] = Field(
        "optimistic", description="Nonce manager to use when signing Lighter requests"
    )
    grvt_env: Literal["prod", "testnet", "staging", "dev"] = Field(
        "prod", description="Target GRVT environment for public market data"
    )
    grvt_api_key: str = Field("", description="Deprecated: GRVT API key (use user credentials)")
    grvt_private_key: str = Field("", description="Deprecated: GRVT private key (use user credentials)")
    grvt_trading_account_id: str = Field("", description="Deprecated: GRVT trading account id (use user credentials)")
    grvt_endpoint_version: str = Field("v1", description="GRVT REST endpoint version (GRVT_END_POINT_VERSION)")
    grvt_ws_stream_version: str = Field(
        "v1", description="GRVT websocket stream version (GRVT_WS_STREAM_VERSION)"
    )
    auth_users: str = Field(
        "",
        description="Deprecated: comma-separated username:password pairs for local auth",
    )
    auth_jwt_secret: str = Field("", description="Secret key used to sign JWTs")
    auth_jwt_algorithm: str = Field("HS256", description="JWT signing algorithm")
    auth_token_ttl_minutes: int = Field(7 * 24 * 60, description="Access token lifetime in minutes")
    auth_lockout_threshold: int = Field(3, description="Number of failed logins before lockout")
    auth_lockout_minutes: int = Field(60, description="Lockout duration in minutes after threshold is reached")
    user_cache_ttl_seconds: int = Field(300, ge=0, description="User cache TTL in seconds (0 to disable)")
    crypto_key: str = Field(
        "",
        description="Base64-encoded symmetric key for encrypting private credentials",
    )
    database_url: Optional[str] = Field(
        default=None, description="SQLAlchemy database URL (e.g. postgresql+psycopg://user:pass@host:5432/db)"
    )
    pg_host: Optional[str] = Field(default=None, validation_alias="PGHOST", description="Postgres host")
    pg_database: Optional[str] = Field(default=None, validation_alias="PGDATABASE", description="Postgres database name")
    pg_user: Optional[str] = Field(default=None, validation_alias="PGUSER", description="Postgres user")
    pg_password: Optional[str] = Field(default=None, validation_alias="PGPASSWORD", description="Postgres password")
    pg_sslmode: Optional[str] = Field(default="require", validation_alias="PGSSLMODE", description="Postgres SSL mode")
    pg_channelbinding: Optional[str] = Field(
        default="require", validation_alias="PGCHANNELBINDING", description="Postgres channel binding requirement"
    )
    database_echo: bool = Field(False, description="Enable SQLAlchemy SQL echo logging")


@lru_cache
def get_settings() -> Settings:
    """
    Cached accessor so dependency injection reuses the same Settings instance.
    """

    return Settings()  # type: ignore[arg-type]
