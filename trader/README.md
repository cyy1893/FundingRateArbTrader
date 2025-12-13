## Funding Rate Arb Trader

FastAPI trading gateway that exposes the Lighter exchange SDK over HTTP + WebSocket interfaces. The service validates credentials on start-up and pushes every order event to a broadcast channel that WebSocket subscribers can consume in real time. Public endpoints also expose market data comparisons (Hyperliquid/Lighter/GRVT) for funding-rate monitoring.

### 1. Environment

Install the dependencies into your virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Create a `.env` file next to this README with your credentials:

```dotenv
LIGHTER_BASE_URL=https://mainnet.zklighter.elliot.ai
LIGHTER_PRIVATE_KEY=0x...
LIGHTER_ACCOUNT_INDEX=123
LIGHTER_API_KEY_INDEX=0
# Optional
LIGHTER_MAX_API_KEY_INDEX=0
LIGHTER_NONCE_MANAGER=optimistic  # or api

GRVT_ENV=prod  # prod | testnet | staging | dev for market data lookups
```

> **Note:** Private keys are loaded directly from env vars. Keep the `.env` file out of version control.

### 2. Run the FastAPI app

```bash
uvicorn app.main:app --reload --port 8080
```

The service attempts to connect to Lighter during startup. If the connection fails (bad base URL, auth failure, etc.) the app will exit with a descriptive error so you can fix the configuration.

### 3. REST Endpoints

#### `POST /orders/lighter`
Creates limit or market orders on Lighter. Amount/price fields follow the SDK requirements (base amount is 1e4 precision, price is 1e2 precision).

```json
{
  "market_index": 0,
  "client_order_index": 99,
  "base_amount": 1000,
  "is_ask": true,
  "order_type": "market",
  "avg_execution_price": 170000,
  "reduce_only": false
}
```

Both endpoints respond with the underlying SDK response payload and propagate any upstream error messages through standard HTTP error codes.

### 4. WebSocket Stream

Connect to `/ws/events` to receive every order request/response pair as soon as it completes. Each message looks like:

```json
{
  "venue": "lighter",
  "payload": {
    "request": { "... original payload ..." },
    "response": { "... exchange response ..." }
  },
  "created_at": "2024-05-01T12:34:56.789123Z"
}
```

### 5. Health Check

`GET /health` returns `{ "status": "ok", "lighter_connected": true }` once the SDK is initialized.

### 6. Docker Image

Build the container locally (replace `YOUR_GH_USER` with your GitHub handle if you plan to publish to GHCR):

```bash
docker build -t ghcr.io/YOUR_GH_USER/funding-rate-arb-trader:latest .
```

Run it while mapping a `.env` file and a host log directory:

```bash
mkdir -p logs
docker run --rm -it \
  --name funding-rate-arb-trader \
  -p 8080:8080 \
  --env-file .env \
  -v $(pwd)/logs:/var/log/funding-rate-arb-trader \
  ghcr.io/YOUR_GH_USER/funding-rate-arb-trader:latest
```

The container looks for environment variables via `--env-file` and also reads `/app/.env` automatically, so you can also mount `-v $(pwd)/.env:/app/.env:ro` if you prefer file mapping. All API and access logs are streamed to stdout/stderr and persisted under `/var/log/funding-rate-arb-trader/server.log` (mapped above to `./logs`).

Publish the image to GitHub Container Registry:

```bash
echo $GH_PAT | docker login ghcr.io -u YOUR_GH_USER --password-stdin
docker push ghcr.io/YOUR_GH_USER/funding-rate-arb-trader:latest
```

Alternatively, from the repository root you can rely on the monorepo `docker-compose.yml` to build/run this service (and optionally the frontend):

```bash
docker compose up --build trader
```

### 7. Next Steps

- Extend the Lighter service with websockets from the SDK examples for richer account state updates.
