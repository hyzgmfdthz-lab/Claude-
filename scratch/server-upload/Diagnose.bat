@echo off
REM =====================================================================
REM  Armaturenbau MEGC - Diagnose
REM
REM  Sagt in einfachen Worten, woran es liegt, wenn etwas nicht laeuft.
REM  Aendert nichts. Kann beliebig oft gestartet werden.
REM  Das Ergebnis steht danach auch in "Diagnose-Protokoll.txt".
REM =====================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Armaturenbau MEGC - Diagnose
set "LOG=%~dp0Diagnose-Protokoll.txt"
set "PORT=7311"
if not "%MEGC_PORT%"=="" set "PORT=%MEGC_PORT%"

> "%LOG%" echo Diagnose Armaturenbau MEGC - %DATE% %TIME%
>>"%LOG%" echo Ordner: %~dp0
>>"%LOG%" echo Rechner: %COMPUTERNAME% / Benutzer: %USERNAME%

echo.
echo   Armaturenbau MEGC - Diagnose
echo   ============================
echo.
echo   Ordner:   %~dp0
echo   Rechner:  %COMPUTERNAME%
echo.

REM ---------- Dateien ----------
if exist "server\server.js" (
  echo   [ok]     Programmdateien sind vorhanden.
  >>"%LOG%" echo Programmdateien: vorhanden
) else (
  echo   [FEHLT]  server\server.js fehlt - das ZIP ist nicht vollstaendig entpackt.
  >>"%LOG%" echo Programmdateien: FEHLEN
)

REM ---------- Node.js ----------
set "NODEEXE="
where node >nul 2>nul
if not errorlevel 1 set "NODEEXE=node"
if "!NODEEXE!"=="" if exist "%ProgramFiles%\nodejs\node.exe" set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
if "!NODEEXE!"=="" if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODEEXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if "!NODEEXE!"=="" (
  echo   [FEHLT]  Node.js ist nicht installiert - https://nodejs.org/de/download
  >>"%LOG%" echo Node.js: FEHLT
) else (
  for /f "tokens=*" %%v in ('"!NODEEXE!" -v 2^>nul') do set "NODEVER=%%v"
  echo   [ok]     Node.js !NODEVER!
  >>"%LOG%" echo Node.js: !NODEVER!
)

REM ---------- Administratorrechte ----------
fltmc >nul 2>&1
if not errorlevel 1 (
  echo   [ok]     Dieses Fenster hat Administratorrechte.
  >>"%LOG%" echo Adminrechte: ja
) else (
  echo   [Hinweis] Dieses Fenster hat KEINE Administratorrechte.
  >>"%LOG%" echo Adminrechte: nein
)

REM ---------- Laeuft die Anwendung? ----------
tasklist /fi "imagename eq node.exe" 2>nul | find /i "node.exe" >nul
if not errorlevel 1 (
  echo   [ok]     Ein node.exe-Prozess laeuft ^(kann auch ein anderes Programm sein^).
  >>"%LOG%" echo Prozess: laeuft
) else (
  echo   [nein]   Es laeuft kein node.exe-Prozess.
  >>"%LOG%" echo Prozess: laeuft nicht
)

powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',%PORT%);exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  echo   [ok]     Die Anwendung antwortet auf Port %PORT%.
  >>"%LOG%" echo Port %PORT%: antwortet
) else (
  echo   [nein]   Auf Port %PORT% antwortet nichts.
  >>"%LOG%" echo Port %PORT%: keine Antwort
)

REM ---------- Firewall und Autostart ----------
netsh advfirewall firewall show rule name="Armaturenbau MEGC" >nul 2>nul
if not errorlevel 1 (
  echo   [ok]     Firewallregel ist angelegt.
  >>"%LOG%" echo Firewall: Regel vorhanden
) else (
  echo   [nein]   Keine Firewallregel - Kollegen kommen nicht auf den Rechner.
  >>"%LOG%" echo Firewall: keine Regel
)

schtasks /query /tn "Armaturenbau MEGC" >nul 2>nul
if not errorlevel 1 (
  echo   [ok]     Automatischer Start ist eingerichtet.
  >>"%LOG%" echo Autostart: eingerichtet
) else (
  echo   [nein]   Kein automatischer Start eingerichtet.
  >>"%LOG%" echo Autostart: nicht eingerichtet
)

REM ---------- Letzte Zeilen des Serverprotokolls ----------
echo.
if exist "daten\server.log" (
  echo   Letzte Zeilen aus daten\server.log:
  >>"%LOG%" echo.
  >>"%LOG%" echo --- Ende von daten\server.log ---
  powershell -NoProfile -Command "Get-Content 'daten\server.log' -Tail 12"
  powershell -NoProfile -Command "Get-Content 'daten\server.log' -Tail 12" >>"%LOG%" 2>nul
) else (
  echo   Es gibt noch kein Serverprotokoll ^(daten\server.log^).
  >>"%LOG%" echo server.log: nicht vorhanden
)

echo.
echo   Der Link fuer die Kollegen waere:  http://%COMPUTERNAME%:%PORT%/
echo.
echo   Das Ergebnis steht auch in "Diagnose-Protokoll.txt".
echo.
pause
endlocal
