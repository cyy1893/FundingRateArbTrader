# Repository Guidelines

## Project Structure & Module Organization
The FastAPI app lives in `app/main.py`, which wires dependency injection, HTTP routes, and the `/ws/events` stream. Shared schemas reside in `app/models.py`, while `app/events.py` exposes a broker for publishing order activity. Exchange-specific logic is isolated in `app/services/` (`lighter_service.py` plus `market_data_service.py`), keeping SDK calls separate from transport code. Runtime configuration is centralized in `app/config.py`, loading `.env` secrets such as RPC URLs and private keys. Keep any auxiliary helpers in `app/utils/` so HTTP handlers stay slim. Repo-level assets are minimal: `requirements.txt` defines runtime deps and `README.md` documents public endpoints.

## Build, Test, and Development Commands
```bash
python -m venv .venv && source .venv/bin/activate   # create local environment
pip install --upgrade pip && pip install -r requirements.txt   # install deps
uvicorn app.main:app --reload --port 8080   # run the API with hot reload
pytest                                      # execute fast unit/integration tests
```
Always create and reuse the `.venv` at the repository root (next to `README.md`). Nested virtual environments (for example under `trader/`) break tooling paths and should be avoided. Use the virtual environment above (or an equivalent root-level venv path of your choosing) before installing dependencies so local execution mirrors the Docker image.
Use a `.env` adjacent to `README.md` before booting the app; startup validates Lighter credentials and will exit early if configuration is incomplete.

## Coding Style & Naming Conventions
Code is Python 3.11+ with 4-space indentation, exhaustive type hints, and docstrings on non-trivial coroutines. Keep FastAPI dependencies pure (no network calls inside Pydantic validators). Models follow `CamelCase` class names and `snake_case` fields to align with incoming payloads. When adding modules, place files under `app/<domain>_<layer>.py` (for example, `lighter_service.py`) and keep async functions suffixed with `_async` only when clarity demands it. Use `black`/`ruff` locally if available to maintain import order and formatting.

## Testing Guidelines
Add `tests/` mirroring the `app/services/` hierarchy. Prefer `pytest` async fixtures to stub Lighter SDK clients and market data fetchers, and assert serialized payloads before hitting real endpoints. Name files `test_<feature>.py` and target at least sanity coverage for order translation math (price/base conversions) and event broadcasting to avoid silent regressions. Run `pytest` (optionally with `-k service` for focused suites) before every PR.

## Commit & Pull Request Guidelines
Follow an imperative subject line (`lighter: handle oracle orders`) with optional context wrapped at ~72 chars. Each commit should bundle one logical change (schema tweak, service fix, docs). PRs must describe motivation, list key changes, call out config/env impacts, and attach logs or screenshots for failure scenarios. Link tracking issues when applicable and confirm local tests + manual order placement if the change touches exchange flows.

## Security & Configuration Tips
Never commit `.env` or credential snippets. Rotate Lighter keys immediately if exposed, and rely on the startup readiness checks (`GET /health`) before issuing production orders. When logging, redact `private_key`, `nonce`, and signature material—prefer referencing `client_order_index` or transaction hashes instead.

## Funding Rate Arbitrage Plan
The core strategy is to open equal-notional perpetual positions on two venues at the same price level (or a favorable spread where the long entry price is strictly lower than the short entry price). Orders must be limit-maker only, so the system must avoid crossing the book and allow only passive fills.

### Entry Conditions
- **Price parity or favorable spread:** `long_price <= short_price - min_spread` after fees.
- **Maker-only constraint:** both orders must post without crossing the best price; otherwise skip.
- **Notional parity:** per-venue size is derived from the same USD notional within tolerance.
- **Funding edge:** projected funding differential exceeds `min_funding_edge` after fees.

### Order Placement Flow
- **Select target prices:** pick maker prices just inside each venue’s best bid/ask without crossing.
- **Asymmetric first leg:** place on the thinner/liquidity-poor venue first to reduce half-fill risk.
- **Second leg gated:** only place the opposing leg when the spread condition still holds.
- **Timeouts:** cancel both orders if not filled within `order_ttl_ms`.

### Fill Coordination & Risk Controls
- **Partial fills:** track filled size; adjust counter-order to maintain notional parity.
- **Single-leg exposure:** if one side fills and the other doesn’t, either reprice the other side or hedge/flatten after `hedge_timeout_ms`.
- **Spread invalidation:** cancel unfilled orders immediately if spread breaks.
- **Max slippage:** refuse to follow price beyond `max_slippage_bps`.

### Margin & Sizing
- **Margin estimate:** `margin = notional / leverage`, tracked per venue.
- **Min/Max caps:** enforce per-venue leverage caps and notional floor per instrument.
- **Precision:** respect exchange min size and tick size; round to venue rules.

### Hold & Exit
- **Hold window:** keep hedge open across funding cycles if funding edge persists.
- **Exit trigger:** close when funding edge dissipates or risk limits breached.
- **Exit method:** use maker-only exit where possible; allow taker only for emergency flattening.

### Telemetry & Audit
- **State machine:** `idle -> pending -> partially_filled -> hedged -> exiting -> closed`.
- **Logs:** record prices, sizes, fills, timing, spread at decision points.
- **Post-trade:** compute realized PnL + funding PnL + fees for review/backtest.
