#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=${LOG_DIR:-/var/log/funding-rate-arb-trader}
LOG_FILE="${LOG_FILE:-server.log}"
PORT=${PORT:-8080}

mkdir -p "${LOG_DIR}"
touch "${LOG_DIR}/${LOG_FILE}"

exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --log-config docker/logging.ini
