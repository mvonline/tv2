#!/bin/sh
set -e
cd /app
export CATEGORY_DB_PATH="${CATEGORY_DB_PATH:-/data/categories.db}"
mkdir -p "$(dirname "$CATEGORY_DB_PATH")"
if [ ! -f "$CATEGORY_DB_PATH" ]; then
  python -c "from category_db import init_db; init_db()"
fi
exec uvicorn main:app \
  --host 0.0.0.0 \
  --port 8787 \
  --proxy-headers \
  --forwarded-allow-ips '*' \
  "$@"
