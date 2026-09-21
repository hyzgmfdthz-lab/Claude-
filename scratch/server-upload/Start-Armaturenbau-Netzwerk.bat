@echo off
REM =====================================================================
REM  Armaturenbau MEGC - Start fuer mehrere Benutzer im Firmennetz
REM
REM  Dieses Fenster muss geoeffnet bleiben, solange die Kollegen
REM  arbeiten. Zum Beenden das Fenster schliessen oder Strg+C druecken.
REM =====================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Armaturenbau MEGC - laeuft
set "PORT=7311"
if not "%MEGC_PORT%"=="" set "PORT=%MEGC_PORT%"

if not exist "server\server.js" (
  echo.
  echo   ABBRUCH: In diesem Ordner fehlt "server\server.js".
  echo   Bitte das ZIP vollstaendig entpacken und diese Datei dort starten.
  echo.
  pause
  exit /b 1
)

set "NODEEXE="
where node >nul 2>nul
if not errorlevel 1 set "NODEEXE=node"
if "!NODEEXE!"=="" if exist "%ProgramFiles%\nodejs\node.exe" set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
if "!NODEEXE!"=="" if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODEEXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if "!NODEEXE!"=="" (
  echo.
  echo   ABBRUCH: Node.js ist auf diesem Rechner nicht installiert.
  echo.
  echo   Node.js wird NUR hier gebraucht - die Kollegen brauchen nur
  echo   ihren Browser. Einmalig installieren, LTS Version 20 oder neuer:
  echo       https://nodejs.org/de/download
  echo.
  pause
  exit /b 1
)

set MEGC_HOST=0.0.0.0
echo.
echo   Armaturenbau MEGC - Mehrbenutzerbetrieb
echo   =======================================
echo.
echo   Link fuer die Kollegen:
echo.
echo       http://%COMPUTERNAME%:%PORT%/
echo.
echo   Dieses Fenster muss geoeffnet bleiben, solange gearbeitet wird.
echo.
"!NODEEXE!" server\server.js
echo.
echo   Die Anwendung wurde beendet.
pause
endlocal
