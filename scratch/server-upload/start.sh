#!/usr/bin/env bash
# Startet die Anwendung unter Linux/macOS.
#
# Nur dieser Rechner:      ./start.sh
# Fuer Kollegen im Netz:   MEGC_HOST=0.0.0.0 ./start.sh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "FEHLER: Node.js (Version 20 oder neuer) wird benoetigt: https://nodejs.org"
  exit 1
fi
exec node server/server.js
