#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=${LOG_DIR:-/var/log/funding-rate-arb-trader}
LOG_FILE="${LOG_FILE:-server.log}"
PORT=${PORT:-8080}

exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --log-config docker/logging.ini
