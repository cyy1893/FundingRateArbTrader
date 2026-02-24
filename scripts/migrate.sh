#!/usr/bin/env bash
set -euo pipefail

# Run trader Alembic migrations inside the trader container.
# Default: upgrade head
# Usage:
#   ./scripts/migrate.sh
#   ./scripts/migrate.sh downgrade -1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-upgrade}"
TARGET="${2:-head}"

cd "${ROOT_DIR}"

docker compose run --rm \
  -v "${ROOT_DIR}/trader:/app" \
  --entrypoint sh trader \
  -lc "/opt/venv/bin/alembic -c /app/alembic.ini ${ACTION} ${TARGET}"

