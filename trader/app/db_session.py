from __future__ import annotations

from functools import lru_cache
from typing import Generator, Optional

from sqlalchemy.engine import Engine
from sqlmodel import Session, create_engine

from app.config import Settings, get_settings


def _build_database_url(settings: Settings) -> Optional[str]:
    if settings.database_url:
        return settings.database_url
    if not (settings.pg_host and settings.pg_database and settings.pg_user and settings.pg_password):
        return None
    sslmode = settings.pg_sslmode or "require"
    channelbinding = settings.pg_channelbinding or "require"
    return (
        f"postgresql+psycopg://{settings.pg_user}:{settings.pg_password}"
        f"@{settings.pg_host}:5432/{settings.pg_database}"
        f"?sslmode={sslmode}&channel_binding={channelbinding}"
    )


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    database_url = _build_database_url(settings)
    if not database_url:
        raise RuntimeError("Database URL is not configured. Set DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD.")
    return create_engine(database_url, echo=settings.database_echo)


def get_session() -> Generator[Session, None, None]:
    engine = get_engine()
    with Session(engine) as session:
        yield session
