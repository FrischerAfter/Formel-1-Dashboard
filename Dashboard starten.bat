@echo off
title F1 Live Dashboard
cd /d "%~dp0"

echo ============================================================
echo   F1 Live Dashboard wird gestartet...
echo   Browser oeffnet sich gleich automatisch.
echo   Zum Beenden dieses Fenster schliessen oder STRG+C druecken.
echo ============================================================

if not exist "node_modules" (
  echo   (Einmalig) Abhaengigkeiten werden installiert - kurz Geduld...
  call npm install
)

start "" http://localhost:8712
npm start

pause
