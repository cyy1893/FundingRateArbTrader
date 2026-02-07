## Admin Console

Dedicated admin frontend for Funding Rate Arb Trader.

### Features

- Admin login via backend `POST /login`
- View all users (safe summary) via `GET /admin/users`
- Create users via `POST /admin/users` with backend-enforced client secret header

### Run locally

```bash
cd admin
npm install
npm run dev
```

Admin UI runs on `http://localhost:3002` in local dev.

### Environment variables

- `TRADER_API_BASE_URL` (or `API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL`): backend base URL, default `http://localhost:8080`
- `ADMIN_REGISTRATION_SECRET`: shared secret injected only on server-side route handlers
- `ADMIN_CLIENT_HEADER_NAME` (optional): defaults to `X-Admin-Client-Secret`

### Security model

- Browser only sends username/password and JWT cookie.
- Next.js server route injects `X-Admin-Client-Secret` when calling trader admin APIs.
- `trader` rejects user creation when secret header is missing or invalid.

### Bootstrap admin

Use trader CLI once for initial admin:

```bash
cd trader
alembic upgrade head
python -m app.utils.user_admin create --username admin --password "StrongPass" --admin
```
