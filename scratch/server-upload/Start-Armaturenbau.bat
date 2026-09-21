@echo off
REM =====================================================================
REM  Armaturenbau MEGC - Produktionsplanung
REM  Startet die Anwendung lokal und oeffnet den Browser.
REM =====================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   FEHLER: Node.js wurde nicht gefunden.
  echo.
  echo   Bitte einmalig Node.js installieren ^(LTS-Version, Version 20 oder neuer^):
  echo   https://nodejs.org/de/download
  echo.
  echo   Danach diese Datei erneut starten. Eine weitere Installation
  echo   ist nicht erforderlich - die Anwendung benoetigt keine Zusatzpakete.
  echo.
  pause
  exit /b 1
)

echo.
echo   Armaturenbau MEGC - Produktionsplanung wird gestartet ...
echo   Zum Beenden dieses Fenster schliessen.
echo.
node server\server.js
if errorlevel 1 pause
endlocal
