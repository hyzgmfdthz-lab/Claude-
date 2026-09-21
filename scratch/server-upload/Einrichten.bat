@echo off
REM =====================================================================
REM  Armaturenbau MEGC - Einrichtung fuer den Mehrbenutzerbetrieb
REM
REM  Einmal ausfuehren. Am besten mit Rechtsklick - "Als Administrator
REM  ausfuehren"; ohne Administratorrechte laeuft es auch, dann fehlen
REM  nur Firewallregel und automatischer Start.
REM
REM  Dieses Skript ERZEUGT die Datei "Einladung.txt" mit dem Link fuer
REM  die Kollegen. Sie muss nicht von Hand geschrieben werden.
REM
REM  Alles, was hier passiert, steht anschliessend auch in
REM  "Einrichtung-Protokoll.txt" - das Fenster kann also nichts
REM  verschlucken.
REM =====================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Armaturenbau MEGC - Einrichtung
set "LOG=%~dp0Einrichtung-Protokoll.txt"
set "PORT=7311"
if not "%MEGC_PORT%"=="" set "PORT=%MEGC_PORT%"

> "%LOG%" echo Einrichtung Armaturenbau MEGC
>>"%LOG%" echo Zeitpunkt: %DATE% %TIME%
>>"%LOG%" echo Ordner:    %~dp0
>>"%LOG%" echo Benutzer:  %USERNAME% auf %COMPUTERNAME%
>>"%LOG%" echo.

echo.
echo   Armaturenbau MEGC - Einrichtung fuer den Mehrbenutzerbetrieb
echo   ===========================================================
echo.

REM ---------- 0. Wird aus dem ZIP heraus gestartet? ----------
echo %~dp0 | find /i "\AppData\Local\Temp\" >nul
if not errorlevel 1 goto ausTemp
echo %~dp0 | find /i "\Temp\" >nul
if not errorlevel 1 goto ausTemp
goto ordnerOk

:ausTemp
echo   ABBRUCH: Diese Datei laeuft gerade aus einem Zwischenordner.
echo.
echo   Das passiert, wenn man das ZIP nur anklickt statt es zu entpacken.
echo   Windows legt den Inhalt dann in einen temporaeren Ordner, der
echo   spaeter geloescht wird.
echo.
echo   Bitte so vorgehen:
echo     1. Rechtsklick auf die ZIP-Datei - "Alle extrahieren ..."
echo     2. Ziel zum Beispiel  C:\Armaturenbau-MEGC
echo     3. Dort "Einrichten.bat" starten.
echo.
>>"%LOG%" echo ABBRUCH: Start aus einem Zwischenordner ^(ZIP nicht entpackt^).
goto ende

:ordnerOk
if not exist "server\server.js" goto falscherOrdner
goto nodePruefen

:falscherOrdner
echo   ABBRUCH: In diesem Ordner fehlt "server\server.js".
echo.
echo   "Einrichten.bat" muss in demselben Ordner liegen wie die Ordner
echo   "server", "web" und "engine". Bitte das ZIP vollstaendig entpacken
echo   und die Datei dort starten.
echo.
>>"%LOG%" echo ABBRUCH: server\server.js fehlt - falscher Ordner.
goto ende

REM ---------- 1. Node.js ----------
:nodePruefen
set "NODEEXE="
where node >nul 2>nul
if not errorlevel 1 set "NODEEXE=node"
if not "!NODEEXE!"=="" goto nodeGefunden
if exist "%ProgramFiles%\nodejs\node.exe" set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
if not "!NODEEXE!"=="" goto nodeGefunden
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODEEXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not "!NODEEXE!"=="" goto nodeGefunden
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODEEXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not "!NODEEXE!"=="" goto nodeGefunden

echo   ABBRUCH: Node.js ist auf diesem Rechner nicht installiert.
echo.
echo   Node.js wird NUR auf diesem einen Rechner gebraucht. Die Kollegen
echo   brauchen spaeter nichts ausser ihrem Browser.
echo.
echo   Bitte einmalig installieren - LTS, Version 20 oder neuer:
echo       https://nodejs.org/de/download
echo.
echo   Danach diese Datei noch einmal starten.
echo.
>>"%LOG%" echo ABBRUCH: Node.js nicht gefunden.
goto ende

:nodeGefunden
for /f "tokens=*" %%v in ('"!NODEEXE!" -v 2^>nul') do set "NODEVER=%%v"
echo   Node.js gefunden: !NODEVER!
>>"%LOG%" echo Node.js: !NODEVER! ^(!NODEEXE!^)
if not exist "daten" mkdir "daten" >nul 2>nul

REM ---------- 2. Administratorrechte ----------
REM  fltmc ist der verlaessliche Test. Der frueher verwendete Befehl
REM  "net session" meldet auch dann einen Fehler, wenn der Dienst
REM  "Server" abgeschaltet ist - dann sah es so aus, als fehlten
REM  Administratorrechte, obwohl sie da waren.
set "ADMIN=0"
fltmc >nul 2>&1
if not errorlevel 1 set "ADMIN=1"
if "!ADMIN!"=="1" (
  echo   Administratorrechte: vorhanden
  >>"%LOG%" echo Administratorrechte: ja
) else (
  echo   Administratorrechte: NEIN - Firewall und Autostart werden uebersprungen.
  echo   Die Anwendung startet trotzdem. Fuer den Zugriff der Kollegen
  echo   diese Datei spaeter einmal als Administrator ausfuehren.
  >>"%LOG%" echo Administratorrechte: nein
)

REM ---------- 3. Firewall ----------
if "!ADMIN!"=="0" goto autostart
netsh advfirewall firewall delete rule name="Armaturenbau MEGC" >nul 2>nul
netsh advfirewall firewall add rule name="Armaturenbau MEGC" dir=in action=allow protocol=TCP localport=%PORT% profile=domain,private >nul 2>nul
if errorlevel 1 goto firewallFehler
echo   Firewall: Zugriff der Kollegen auf Port %PORT% erlaubt.
>>"%LOG%" echo Firewall: Regel fuer Port %PORT% angelegt.
goto autostart

:firewallFehler
echo   Hinweis: Die Firewallregel konnte nicht angelegt werden.
echo   Bitte die IT bitten, Port %PORT% im Firmennetz freizugeben.
>>"%LOG%" echo Firewall: Regel konnte NICHT angelegt werden.

REM ---------- 4. Automatischer Start ----------
:autostart
if "!ADMIN!"=="0" goto einladung
schtasks /delete /tn "Armaturenbau MEGC" /f >nul 2>nul
REM  Die Anfuehrungszeichen um den Pfad muessen mit \" geschrieben werden.
REM  Mit einfachen Anfuehrungszeichen legt Windows die Aufgabe zwar an, aber
REM  wscript sucht dann eine Datei, deren Name die Zeichen enthaelt - die
REM  Aufgabe startete und brach sofort wieder ab.
schtasks /create /tn "Armaturenbau MEGC" /sc onlogon /rl highest /tr "wscript.exe \"%~dp0start-unsichtbar.vbs\"" /f >nul 2>nul
if errorlevel 1 goto autostartFehler
echo   Automatischer Start: bei jeder Windows-Anmeldung, ohne Fenster.
>>"%LOG%" echo Autostart: Aufgabe angelegt.
goto einladung

:autostartFehler
echo   Hinweis: Der automatische Start konnte nicht eingerichtet werden.
echo   Die Anwendung laesst sich weiter mit Start-Armaturenbau-Netzwerk.bat starten.
>>"%LOG%" echo Autostart: Aufgabe konnte NICHT angelegt werden.

REM ---------- 5. Einladung schreiben ----------
:einladung
set "LINK=http://%COMPUTERNAME%:%PORT%/"
> "Einladung.txt" echo Einladung zur Produktionsplanung Armaturenbau MEGC
>>"Einladung.txt" echo ==================================================
>>"Einladung.txt" echo.
>>"Einladung.txt" echo Diesen Link im Browser oeffnen:
>>"Einladung.txt" echo     %LINK%
>>"Einladung.txt" echo.
>>"Einladung.txt" echo So melden Sie sich an:
>>"Einladung.txt" echo   1. Link oeffnen - Edge, Chrome oder Firefox.
>>"Einladung.txt" echo   2. Eigenes Kuerzel eingeben, zum Beispiel STWUE, SVHE, DOHE, KEER.
>>"Einladung.txt" echo   3. Beim ersten Mal ein eigenes Passwort vergeben.
>>"Einladung.txt" echo.
>>"Einladung.txt" echo Es ist keine Installation noetig - nur der Browser.
>>"Einladung.txt" echo Alle arbeiten im selben Datenbestand; Aenderungen der Kollegen
>>"Einladung.txt" echo werden oben rechts gemeldet.
>>"Einladung.txt" echo.
>>"Einladung.txt" echo Falls der Rechnername nicht funktioniert, diese Adressen probieren:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "ADR=%%a"
  set "ADR=!ADR: =!"
  >>"Einladung.txt" echo     http://!ADR!:%PORT%/
)
echo   Einladung.txt geschrieben.
>>"%LOG%" echo Einladung.txt geschrieben: %LINK%

REM ---------- 6. Starten ----------
REM  Geprueft wird der Port, nicht der Prozess: "node.exe laeuft" kann
REM  auch ein ganz anderes Programm sein.
powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',%PORT%);exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto laeuftSchon

REM  Bewusst der einfache Weg zuerst: ein kleines, minimiertes Fenster.
REM  Der Start ohne Fenster laeuft ueber den Windows Script Host. Ist der
REM  im Firmennetz gesperrt, passiert dabei wortlos nichts - und genau das
REM  ist schon passiert. Beim naechsten Anmelden uebernimmt die
REM  Aufgabenplanung, dann ohne Fenster.
set MEGC_HOST=0.0.0.0
set MEGC_NO_BROWSER=1
REM  Die Ausgabe geht in die Protokolldatei: Scheitert der Start, waere
REM  das minimierte Fenster sonst sofort wieder zu und die Meldung weg.
start "Armaturenbau MEGC" /min cmd /c ""!NODEEXE!" "%~dp0server\server.js" >> "%~dp0daten\server.log" 2>&1"
goto gestartet

:laeuftSchon
echo   Die Anwendung laeuft bereits.
>>"%LOG%" echo Anwendung lief bereits.

:gestartet
>>"%LOG%" echo Start ausgeloest.

REM ---------- 7. Nachsehen, ob die Anwendung antwortet ----------
echo.
echo   Warte auf die Anwendung ...
set "ANTWORT=0"
for /l %%i in (1,1,15) do (
  if "!ANTWORT!"=="0" (
    powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',%PORT%);exit 0}catch{exit 1}" >nul 2>&1
    if not errorlevel 1 set "ANTWORT=1"
    if "!ANTWORT!"=="0" ping -n 2 127.0.0.1 >nul
  )
)

echo.
if "!ANTWORT!"=="1" goto laeuft

REM ---------- 7b. Zweiter Versuch: Start ohne Fenster ----------
echo   Das Fenster hat nicht angeschlagen - zweiter Versuch im Hintergrund ...
>>"%LOG%" echo Sichtbares Fenster ohne Wirkung - Start ueber wscript wird versucht.
start "" wscript.exe "%~dp0start-unsichtbar.vbs"
set "ANTWORT=0"
for /l %%i in (1,1,15) do (
  if "!ANTWORT!"=="0" (
    powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',%PORT%);exit 0}catch{exit 1}" >nul 2>&1
    if not errorlevel 1 set "ANTWORT=1"
    if "!ANTWORT!"=="0" ping -n 2 127.0.0.1 >nul
  )
)
if "!ANTWORT!"=="1" (
  echo   Zweiter Versuch erfolgreich.
  >>"%LOG%" echo Start ueber wscript erfolgreich.
  goto laeuft
)

echo.
echo   Die Anwendung antwortet nicht auf Port %PORT%.
>>"%LOG%" echo ERGEBNIS: Anwendung antwortet NICHT auf Port %PORT%.
if exist "daten\server.log" (
  echo.
  echo   Letzte Zeilen aus daten\server.log:
  echo   ----------------------------------------
  powershell -NoProfile -Command "Get-Content 'daten\server.log' -Tail 15"
  powershell -NoProfile -Command "Get-Content 'daten\server.log' -Tail 15" >>"%LOG%" 2>nul
  echo   ----------------------------------------
) else (
  echo   Es wurde kein Serverprotokoll geschrieben - der Start kam gar nicht zustande.
)
echo.
echo   Bitte "Diagnose.bat" ausfuehren und mir
echo   "Diagnose-Protokoll.txt" schicken.
goto ende

:laeuft
echo   Fertig. Die Anwendung laeuft.
echo.
echo   Der Link fuer die Kollegen:
echo.
echo       %LINK%
echo.
echo   Er steht auch in der Datei "Einladung.txt" in diesem Ordner.
echo   In der Anwendung selbst: oben rechts auf "Einladung".
echo.
echo   Wichtig zu wissen:
echo     - Dieser Rechner muss laufen, solange die Kollegen arbeiten.
echo       Nachts kann er aus sein, es geht nichts verloren.
echo     - Die Daten liegen im Ordner "daten".
echo     - Heute laeuft die Anwendung in einem kleinen Fenster in der
echo       Taskleiste. Es darf minimiert bleiben, aber nicht geschlossen
echo       werden. Ab der naechsten Windows-Anmeldung startet sie von
echo       selbst und ohne Fenster.
if "!ADMIN!"=="0" echo     - Ohne Administratorrechte fehlen Firewallregel und Autostart.
>>"%LOG%" echo ERGEBNIS: Anwendung laeuft auf %LINK%
start "" "%LINK%"

:ende
echo.
echo   Dieses Protokoll steht in "Einrichtung-Protokoll.txt".
echo.
pause
endlocal
