## Dashboard

Frontend for the Funding Rate Arbitrage trader. Uses Next.js App Router with a proxy to the FastAPI backend.

### Run locally

```bash
cd gateway
npm install
npm run dev
```

Env vars:
- `NEXT_PUBLIC_API_BASE_URL` (or `API_BASE_URL`/`TRADER_API_BASE_URL`): FastAPI base URL, default `http://localhost:8080`
- `NEXT_PUBLIC_TRADER_WS_URL` (optional): WebSocket base for `/ws/orderbook` and `/ws/events`, defaults to `ws://localhost:8080`

### Auth flow

- Visit `/login` to submit the fixed username/password configured in backend `AUTH_USERS`.
- Success sets `auth_token` in cookies + localStorage, used automatically by `/api/balances` proxy and WebSocket connections.
- 3 failed attempts lock the account for 1 hour (enforced by backend).

### Pages

- `/` 资金费率比较（外部市场数据）
- `/trading` 账户余额、持仓及订单簿监控（需登录）
- `/login` 固定账户登录，获取后端 JWT
