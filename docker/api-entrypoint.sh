#!/bin/sh
set -e
cd /app
export CATEGORY_DB_PATH="${CATEGORY_DB_PATH:-/data/categories.db}"
export CHANNELS_JSON_PATH="${CHANNELS_JSON_PATH:-/data/channel-data/channels.json}"
mkdir -p "$(dirname "$CATEGORY_DB_PATH")"
mkdir -p "$(dirname "$CHANNELS_JSON_PATH")"

if [ ! -f "$CATEGORY_DB_PATH" ]; then
  python -c "from category_db import init_db; init_db()"
fi

# Persist channels.json on the channels-data volume (mounted under html/data on web).
if [ "${SKIP_CHANNELS_FETCH:-0}" != "1" ]; then
  if [ -n "${CHANNELS_JSON_URL:-}" ]; then
    echo "Fetching channels.json -> $CHANNELS_JSON_PATH"
    curl -fsSL "$CHANNELS_JSON_URL" -o "${CHANNELS_JSON_PATH}.tmp"
    mv "${CHANNELS_JSON_PATH}.tmp" "$CHANNELS_JSON_PATH"
  elif [ ! -f "$CHANNELS_JSON_PATH" ]; then
    if [ -f /app/seed/channels.json ]; then
      echo "Seeding channels.json from image -> $CHANNELS_JSON_PATH"
      cp /app/seed/channels.json "$CHANNELS_JSON_PATH"
    else
      echo "ERROR: CHANNELS_JSON_URL not set and no seed at /app/seed/channels.json" >&2
      exit 1
    fi
  fi
elif [ ! -f "$CHANNELS_JSON_PATH" ]; then
  echo "ERROR: SKIP_CHANNELS_FETCH=1 but $CHANNELS_JSON_PATH is missing" >&2
  exit 1
fi

exec uvicorn main:app \
  --host 0.0.0.0 \
  --port 8787 \
  --proxy-headers \
  --forwarded-allow-ips '*' \
  "$@"
