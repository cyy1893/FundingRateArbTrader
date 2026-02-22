## Funding Rate Arb Monorepo

This repository now bundles both sides of the Funding Rate Arbitrage stack:

- `trader/`: the FastAPI backend (original FundingRateArbTrader service). It exposes Lighter REST and `/ws/events`.
- `gateway/`: the Next.js frontend (original FundingRateArb app) that consumes the backend APIs and websocket feed.
- `admin/`: a dedicated Next.js admin console for listing users and creating users.

### Run with Docker Compose

Default (without admin):

```bash
docker compose up --build
```

- Backend is exposed on `http://localhost:8080`.
- Gateway frontend is served on `http://localhost:3000` and communicates with the backend via the internal `trader` hostname.

Start with admin enabled:

```bash
docker compose --profile admin up --build
```

- Admin frontend is served on `http://localhost:3002` and communicates with the backend via the internal `trader` hostname.

Backend-specific environment variables still live in `trader/.env` and are mounted automatically by Compose. Frontend environment can be managed through `gateway/.env.local` / `admin/.env.local` (if needed) or via Compose `environment` entries.

For admin user creation protection, define the same secret in both trader and admin service runtime:

- `ADMIN_REGISTRATION_SECRET`
- `ADMIN_CLIENT_HEADER_NAME` (optional, defaults to `X-Admin-Client-Secret`)

### Working on Individual Apps

Each subfolder keeps its original tooling:

- `trader/README.md` documents Python setup, FastAPI commands, and backend-only `docker compose` usage.
- `gateway/README.md` contains the Next.js dev server instructions (`npm run dev`, etc.).
- `admin/README.md` documents admin login, user list/creation workflow, and env vars.

Develop locally inside each directory as before, then return to the repo root whenever you need the combined Docker workflow.
