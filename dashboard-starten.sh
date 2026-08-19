#!/usr/bin/env bash
# F1 Live Dashboard – Starter für macOS/Linux
cd "$(dirname "$0")"

echo "============================================================"
echo "  F1 Live Dashboard wird gestartet..."
echo "  Browser oeffnet sich gleich automatisch."
echo "  Zum Beenden: STRG + C"
echo "============================================================"

if [ ! -d "node_modules" ]; then
  echo "  (Einmalig) Abhaengigkeiten werden installiert - kurz Geduld..."
  npm install
fi

# Browser im Hintergrund oeffnen (best effort, je nach System)
( sleep 1 && (xdg-open http://localhost:8712 2>/dev/null || open http://localhost:8712 2>/dev/null) ) &

npm start
