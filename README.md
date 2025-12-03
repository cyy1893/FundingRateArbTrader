## Funding Rate Arb Monorepo

This repository now bundles both sides of the Funding Rate Arbitrage stack:

- `trader/`: the FastAPI backend (original FundingRateArbTrader service). It exposes Drift/Lighter REST and `/ws/events`.
- `gateway/`: the Next.js frontend (original FundingRateArb app) that consumes the backend APIs and websocket feed.

### Run Everything with Docker Compose

Build and start both services together:

```bash
docker compose up --build
```

- Backend is exposed on `http://localhost:8080`.
- Frontend is served on `http://localhost:3000` and communicates with the backend via the internal `trader` hostname.

Backend-specific environment variables still live in `trader/.env` and are mounted automatically by Compose. Frontend environment can be managed through `gateway/.env.local` (if needed) or via Compose `environment` entries.

### Working on Individual Apps

Each subfolder keeps its original tooling:

- `trader/README.md` documents Python setup, FastAPI commands, and backend-only `docker compose` usage.
- `gateway/README.md` contains the Next.js dev server instructions (`npm run dev`, etc.).

Develop locally inside each directory as before, then return to the repo root whenever you need the combined Docker workflow.
