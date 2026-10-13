#!/usr/bin/env bash
# THE COLLECTIVE photo booth - macOS / Linux launcher.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
node server.js &
SERVER=$!
sleep 2
if command -v google-chrome >/dev/null; then B=google-chrome;
elif command -v chromium >/dev/null; then B=chromium;
elif command -v chromium-browser >/dev/null; then B=chromium-browser;
elif [ -d "/Applications/Google Chrome.app" ]; then B="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
else echo "Open http://localhost:3000 in Chrome"; wait $SERVER; exit; fi
"$B" --kiosk --app=http://localhost:3000 --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --noerrdialogs
kill $SERVER
