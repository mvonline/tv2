#!/bin/sh
set -e
# api populates the shared volume before uvicorn; wait so nginx does not serve an empty /data/
i=0
while [ ! -f /usr/share/nginx/html/data/channels.json ] && [ "$i" -lt 120 ]; do
  sleep 1
  i=$((i + 1))
done
if [ ! -f /usr/share/nginx/html/data/channels.json ]; then
  echo "web: channels.json not found on volume after wait; nginx will still start" >&2
fi
exec nginx -g "daemon off;"
