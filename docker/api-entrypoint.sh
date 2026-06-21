#!/bin/sh
set -e
cd /app
export CATEGORY_DB_PATH="${CATEGORY_DB_PATH:-/data/categories.db}"
export CHANNELS_JSON_PATH="${CHANNELS_JSON_PATH:-/data/channel-data/channels.json}"
export LOGO_DIR="${LOGO_DIR:-/data/logos}"

CHANNEL_DATA_DIR=$(dirname "$CHANNELS_JSON_PATH")
SCRAPE_MARKER="$CHANNEL_DATA_DIR/.tv2_scraped"
SCRAPE_MODE="${SCRAPE_ON_START:-once}"

mkdir -p "$(dirname "$CATEGORY_DB_PATH")"
mkdir -p "$CHANNEL_DATA_DIR"
mkdir -p "$LOGO_DIR"

# Merge image logos into the shared volume every start.
if [ -d /app/logo ]; then
  echo "Syncing logos /app/logo -> $LOGO_DIR"
  cp -a /app/logo/. "$LOGO_DIR/"
fi

if [ ! -f "$CATEGORY_DB_PATH" ]; then
  python -c "from category_db import init_db; init_db()"
fi

# Seed channels.json from the image every start so the volume tracks the image build.
if [ -f /app/seed/channels.json ]; then
  echo "Seeding channels.json from image -> $CHANNELS_JSON_PATH"
  cp /app/seed/channels.json "$CHANNELS_JSON_PATH"
fi

# CHANNELS_JSON_URL is handled in Python (main.py lifespan) for Docker and local runs.

if [ ! -f "$CHANNELS_JSON_PATH" ]; then
  if [ "${SKIP_CHANNELS_FETCH:-0}" != "1" ] && [ -n "${CHANNELS_JSON_URL:-}" ]; then
    echo "channels.json missing; API startup will fetch CHANNELS_JSON_URL -> $CHANNELS_JSON_PATH"
  else
    echo "ERROR: $CHANNELS_JSON_PATH is missing and no seed available" >&2
    exit 1
  fi
fi

# --- Background scraper ---
should_scrape() {
  if [ "${SKIP_CHANNELS_FETCH:-0}" = "1" ]; then return 1; fi
  if [ -n "${CHANNELS_JSON_URL:-}" ]; then return 1; fi
  case "$SCRAPE_MODE" in
    always|1|true|yes) return 0 ;;
    never|0|false|no)  return 1 ;;
    once|first|"")
      [ ! -f "$SCRAPE_MARKER" ] && return 0
      return 1 ;;
    *) return 1 ;;
  esac
}

if should_scrape; then
  echo "Starting background scraper -> $CHANNELS_JSON_PATH , logos -> $LOGO_DIR"
  (
    python scrape.py --delay "${SCRAPE_DELAY:-1}" \
      && python fetch_iptv.py \
      && touch "$SCRAPE_MARKER" \
      && echo "Background scrape complete" \
      || echo "WARN: background scrape failed" >&2
  ) &
fi

exec uvicorn main:app \
  --host 0.0.0.0 \
  --port 8787 \
  --proxy-headers \
  --forwarded-allow-ips '*' \
  "$@"
