#!/usr/bin/env bash
# Renders public/icon.svg into the committed PNG icons with headless Chrome (no npm dependency).
# Manual only: run it after editing icon.svg and commit the PNGs. CI and Docker never run it.
#   bash apps/web/scripts/make-icons.sh            # from anywhere
#   CHROME_BIN=chromium bash apps/web/scripts/...  # another Chrome-family binary
set -euo pipefail
cd "$(dirname "$0")/.."
chrome="${CHROME_BIN:-google-chrome}"
command -v "$chrome" >/dev/null || { echo "make-icons: '$chrome' not found; set CHROME_BIN" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
headless=(--headless=new --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1
  --user-data-dir="$tmp/profile") # a throwaway profile keeps this off any Chrome already running

# A broken SVG still "renders" (a broken-image glyph on the background), so prove it decodes first.
printf '<!doctype html><title>pending</title><img src="file://%s/public/icon.svg" onload="document.title=this.naturalWidth?%s:%s" onerror="document.title=%s">' \
  "$PWD" "'decoded'" "'empty'" "'failed'" >"$tmp/check.html"
"$chrome" "${headless[@]}" --dump-dom "file://$tmp/check.html" 2>/dev/null | grep -q '<title>decoded</title>' \
  || { echo "make-icons: public/icon.svg does not decode as an image (invalid SVG/XML?)" >&2; exit 1; }

render() { # <size> <out>
  printf '<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#06090f}img{display:block}</style><img src="file://%s/public/icon.svg" width="%s" height="%s">' \
    "$PWD" "$1" "$1" >"$tmp/r.html"
  "$chrome" "${headless[@]}" --window-size="$1,$1" --screenshot="$PWD/$2" "file://$tmp/r.html" >/dev/null 2>&1
  file "$2" | grep -q "PNG image data, $1 x $1" || { echo "make-icons: bad render $2" >&2; exit 1; }
  echo "$2"
}

mkdir -p public/icons
render 192 public/icons/icon-192.png
render 512 public/icons/icon-512.png
# The art stays inside the 80% safe circle, so the maskable icon is the same pixels.
cp public/icons/icon-512.png public/icons/icon-maskable-512.png
echo public/icons/icon-maskable-512.png
render 180 public/apple-touch-icon.png
