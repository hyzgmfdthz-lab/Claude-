# Startet die Anwendung ueber PowerShell.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "  FEHLER: Node.js wurde nicht gefunden." -ForegroundColor Red
  Write-Host "  Bitte Node.js (LTS, Version 20 oder neuer) installieren: https://nodejs.org/de/download"
  Write-Host ""
  Read-Host "Zum Beenden Eingabetaste druecken"
  exit 1
}
node server/server.js
