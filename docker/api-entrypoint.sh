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

# Share logos with nginx (logo-data volume). Seed once if empty so UI has assets before scrape finishes.
if [ -z "$(ls -A "$LOGO_DIR" 2>/dev/null)" ] && [ -d /app/seed/logo ]; then
  echo "Seeding logos from image -> $LOGO_DIR"
  cp -a /app/seed/logo/. "$LOGO_DIR/"
fi

if [ ! -f "$CATEGORY_DB_PATH" ]; then
  python -c "from category_db import init_db; init_db()"
fi

run_scrape() {
  echo "Running channel scraper -> $CHANNELS_JSON_PATH , logos -> $LOGO_DIR"
  python scrape.py --delay "${SCRAPE_DELAY:-1}"
}

should_scrape() {
  if [ "${SKIP_CHANNELS_FETCH:-0}" = "1" ]; then
    return 1
  fi
  case "$SCRAPE_MODE" in
    always|1|true|yes) return 0 ;;
    never|0|false|no) return 1 ;;
    once|first|"")
      if [ -f "$SCRAPE_MARKER" ]; then
        return 1
      fi
      return 0
      ;;
    *) return 1 ;;
  esac
}

# Channels: remote URL, scraper, or seed (in that order when applicable).
if [ "${SKIP_CHANNELS_FETCH:-0}" != "1" ]; then
  if [ -n "${CHANNELS_JSON_URL:-}" ]; then
    echo "Fetching channels.json from CHANNELS_JSON_URL -> $CHANNELS_JSON_PATH"
    curl -fsSL "$CHANNELS_JSON_URL" -o "${CHANNELS_JSON_PATH}.tmp"
    mv "${CHANNELS_JSON_PATH}.tmp" "$CHANNELS_JSON_PATH"
  elif should_scrape && [ -z "${CHANNELS_JSON_URL:-}" ]; then
    if run_scrape; then
      touch "$SCRAPE_MARKER"
    else
      echo "WARN: scrape failed; falling back to seed if possible" >&2
      if [ ! -f "$CHANNELS_JSON_PATH" ] && [ -f /app/seed/channels.json ]; then
        cp /app/seed/channels.json "$CHANNELS_JSON_PATH"
        touch "$SCRAPE_MARKER"
      fi
    fi
  elif [ ! -f "$CHANNELS_JSON_PATH" ]; then
    if [ -f /app/seed/channels.json ]; then
      echo "Seeding channels.json from image -> $CHANNELS_JSON_PATH"
      cp /app/seed/channels.json "$CHANNELS_JSON_PATH"
    else
      echo "ERROR: no channels.json, no CHANNELS_JSON_URL, scrape skipped or failed, no seed" >&2
      exit 1
    fi
  fi
elif [ ! -f "$CHANNELS_JSON_PATH" ]; then
  echo "ERROR: SKIP_CHANNELS_FETCH=1 but $CHANNELS_JSON_PATH is missing" >&2
  exit 1
fi

if [ ! -f "$CHANNELS_JSON_PATH" ]; then
  echo "ERROR: $CHANNELS_JSON_PATH is still missing after startup steps" >&2
  exit 1
fi

exec uvicorn main:app \
  --host 0.0.0.0 \
  --port 8787 \
  --proxy-headers \
  --forwarded-allow-ips '*' \
  "$@"
