from __future__ import annotations

import json

import pytest

from app.config import Settings
from app.services.market_data_service import MarketDataService


def _build_settings() -> Settings:
    return Settings.model_construct(
        lighter_base_url="https://example.com",
        grvt_env="prod",
    )


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_asset_icon_file_cache_loads_manual_entries(tmp_path) -> None:
    cache_file = tmp_path / "asset_icons.json"
    cache_file.write_text(
        json.dumps(
            {
                "btc": "https://cdn.example.com/btc.png",
                "ETH-PERP": {
                    "icon_url": "https://cdn.example.com/eth.png",
                    "source": "manual",
                },
            }
        ),
        encoding="utf-8",
    )
    service = MarketDataService(_build_settings(), asset_icon_cache_file=cache_file)

    try:
        resolved = await service._resolve_symbol_icon_urls({"BTC", "ETH"})
    finally:
        await service.close()

    assert resolved == {
        "BTC": "https://cdn.example.com/btc.png",
        "ETH": "https://cdn.example.com/eth.png",
    }


@pytest.mark.anyio
async def test_asset_icon_file_cache_persists_discovered_entries(tmp_path) -> None:
    cache_file = tmp_path / "asset_icons.json"
    cache_file.write_text("{}\n", encoding="utf-8")
    service = MarketDataService(_build_settings(), asset_icon_cache_file=cache_file)

    async def _fake_discover(symbol: str) -> tuple[str | None, str | None]:
        return (f"https://cdn.example.com/{symbol.lower()}.png", "test")

    service._discover_icon_url = _fake_discover  # type: ignore[method-assign]

    try:
        resolved = await service._resolve_symbol_icon_urls({"SOL"})
    finally:
        await service.close()

    payload = json.loads(cache_file.read_text(encoding="utf-8"))
    assert resolved == {"SOL": "https://cdn.example.com/sol.png"}
    assert payload["SOL"]["icon_url"] == "https://cdn.example.com/sol.png"
    assert payload["SOL"]["source"] == "test"


@pytest.mark.anyio
async def test_asset_icon_file_cache_persists_missing_entries_as_empty_string(tmp_path) -> None:
    cache_file = tmp_path / "asset_icons.json"
    cache_file.write_text("{}\n", encoding="utf-8")
    service = MarketDataService(_build_settings(), asset_icon_cache_file=cache_file)

    async def _missing_discover(symbol: str) -> tuple[str | None, str | None]:
        return (None, None)

    service._discover_icon_url = _missing_discover  # type: ignore[method-assign]

    try:
        resolved = await service._resolve_symbol_icon_urls({"DOGE"})
    finally:
        await service.close()

    payload = json.loads(cache_file.read_text(encoding="utf-8"))
    assert resolved == {"DOGE": None}
    assert payload["DOGE"]["icon_url"] == ""
    assert payload["DOGE"]["source"] is None
