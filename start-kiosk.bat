@echo off
REM THE COLLECTIVE photo booth - Windows launcher.
REM Starts the print server, then opens Chrome full-screen in kiosk mode.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
start "Collective Booth Server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
start "" %CHROME% --kiosk --app=http://localhost:3000 --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --disable-session-crashed-bubble --noerrdialogs --overscroll-history-navigation=0
