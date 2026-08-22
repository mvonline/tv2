#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> 1. Building React Frontend..."
cd "$ROOT_DIR/frontend"
npm run build

echo "==> 2. Syncing frontend bundle into desktop/frontend_dist..."
rm -rf "$SCRIPT_DIR/frontend_dist"
mkdir -p "$SCRIPT_DIR/frontend_dist"
cp -r "$ROOT_DIR/frontend/dist"/* "$SCRIPT_DIR/frontend_dist/"

echo "==> 3. Compiling Wails v3 Desktop Binary..."
cd "$SCRIPT_DIR"
export PATH=$PATH:/usr/local/go/bin:~/go/bin
go build -ldflags="-s -w" -o tv2-desktop .

echo "==> Success! TV2 Desktop Binary compiled at:"
echo "    $SCRIPT_DIR/tv2-desktop"
