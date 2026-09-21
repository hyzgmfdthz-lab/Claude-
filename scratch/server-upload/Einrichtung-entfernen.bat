@echo off
REM Nimmt die Einrichtung zurueck: kein automatischer Start, keine
REM Firewall-Regel. Die Daten im Ordner "daten" bleiben erhalten.
setlocal
cd /d "%~dp0"
net session >nul 2>nul
if errorlevel 1 (
  echo   Bitte mit Rechtsklick - "Als Administrator ausfuehren" starten.
  pause
  exit /b 1
)
schtasks /end /tn "Armaturenbau MEGC" >nul 2>nul
schtasks /delete /tn "Armaturenbau MEGC" /f >nul 2>nul
netsh advfirewall firewall delete rule name="Armaturenbau MEGC" >nul 2>nul
echo.
echo   Einrichtung entfernt. Die Daten im Ordner "daten" sind unveraendert.
echo   Zum Arbeiten weiter Start-Armaturenbau.bat verwenden.
echo.
pause
endlocal
