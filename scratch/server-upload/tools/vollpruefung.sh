#!/usr/bin/env bash
#
# Vollstaendige Pruefung der Anwendung.
#
#   bash tools/vollpruefung.sh [Anzahl Durchlaeufe]
#
# Geprueft werden je Durchlauf:
#   1. statische Pruefung (ESLint)      - vergessene Funktionen, Tippfehler
#   2. Typpruefung (TypeScript/JSDoc)
#   3. alle automatisierten Tests
#   4. Neuaufbau der Einzeldatei
#   5. Oberflaeche der Serverfassung    (Playwright, optional)
#   6. Oberflaeche der Einzeldatei      (Playwright, optional)
#   7. Dauerhaftigkeit der Einzeldatei  (Playwright, optional)
#
# Die Oberflaechenpruefungen werden uebersprungen, wenn Playwright fehlt.
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DURCHLAEUFE=${1:-2}
PORT=${MEGC_TEST_PORT:-7391}
ARBEIT=$(mktemp -d)
PROTOKOLL="$ARBEIT/protokoll.txt"
FEHLER=0

melde() { printf '%s\n' "$*" | tee -a "$PROTOKOLL"; }
schritt() {
  local name="$1"; shift
  local start=$SECONDS
  if "$@" > "$ARBEIT/letzter.log" 2>&1; then
    melde "   OK   $name ($((SECONDS - start)) s)"
  else
    FEHLER=$((FEHLER + 1))
    melde "   FEHL $name ($((SECONDS - start)) s)"
    tail -25 "$ARBEIT/letzter.log" | sed 's/^/        /' | tee -a "$PROTOKOLL"
  fi
}

# Playwright suchen (nicht Teil der Anwendung)
PW=${PLAYWRIGHT_MODULE:-}
if [ -z "$PW" ]; then
  for kandidat in \
    "$ROOT/node_modules/playwright/index.js" \
    "/usr/lib/node_modules/playwright/index.js" \
    "/usr/local/lib/node_modules/playwright/index.js" \
    "/opt/node22/lib/node_modules/playwright/index.js"; do
    [ -f "$kandidat" ] && PW="$kandidat" && break
  done
fi

server_start() {
  rm -rf "$ARBEIT/daten"
  MEGC_DATA_DIR="$ARBEIT/daten" MEGC_NO_BROWSER=1 MEGC_PORT="$PORT" \
    node server/server.js > "$ARBEIT/server.log" 2>&1 &
  echo $! > "$ARBEIT/server.pid"
  for _ in $(seq 1 30); do
    sleep 1
    if curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/"; then return 0; fi
  done
  return 1
}
server_stop() {
  [ -f "$ARBEIT/server.pid" ] && kill "$(cat "$ARBEIT/server.pid")" 2>/dev/null
  rm -f "$ARBEIT/server.pid"
  sleep 1
}
trap server_stop EXIT

melde "=== Vollprüfung Armaturenbau MEGC ==="
melde "Durchläufe: $DURCHLAEUFE · Playwright: ${PW:-nicht gefunden (Oberfläche wird übersprungen)}"

for i in $(seq 1 "$DURCHLAEUFE"); do
  melde ""
  melde "--- Durchlauf $i von $DURCHLAEUFE ---"
  schritt "Statische Prüfung" npm run --silent lint
  schritt "Typprüfung" npm run --silent typecheck
  schritt "Automatisierte Tests" npm run --silent test:all
  schritt "Einzeldatei bauen" npm run --silent build:html

  if [ -n "$PW" ]; then
    if server_start; then
      PLAYWRIGHT_MODULE="$PW" BASE="http://127.0.0.1:$PORT" \
        schritt "Oberfläche (Serverfassung)" node tools/ui-test.mjs
      server_stop
    else
      FEHLER=$((FEHLER + 1))
      melde "   FEHL Server startet nicht"
    fi
    PLAYWRIGHT_MODULE="$PW" BASE="file://$ROOT/dist/Armaturenbau-MEGC.html" \
      schritt "Oberfläche (Einzeldatei)" node tools/ui-test.mjs
    PLAYWRIGHT_MODULE="$PW" schritt "Dauerhaftigkeit der Einzeldatei" node tools/standalone-test.mjs
  fi
done

melde ""
if [ "$FEHLER" -eq 0 ]; then
  melde "=== Alles bestanden ($DURCHLAEUFE Durchläufe) ==="
else
  melde "=== $FEHLER Prüfung(en) nicht bestanden ==="
fi
melde "Protokoll: $PROTOKOLL"
exit $((FEHLER > 0))
