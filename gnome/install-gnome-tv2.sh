#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="tv2@mvonline.local"
EXT_SRC="$ROOT_DIR/gnome/tv2-shell-extension"
EXT_DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
APP_DEST="$HOME/.local/share/applications/tv2.desktop"

mkdir -p "$EXT_DEST" "$(dirname "$APP_DEST")"
cp "$EXT_SRC/metadata.json" "$EXT_SRC/extension.js" "$EXT_SRC/stylesheet.css" "$EXT_DEST/"
cp "$ROOT_DIR/gnome/tv2.desktop" "$APP_DEST"
chmod +x "$APP_DEST"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" || true
fi

cat <<MSG
Installed TV2 GNOME integration.

Enable the top-bar extension with:
  gnome-extensions enable $UUID

If GNOME does not see it yet, restart Shell:
  Alt+F2, type r, press Enter

On Wayland, log out and log back in instead.
MSG
