@echo off
REM THE COLLECTIVE photo booth - Windows launcher.
REM Double-click to start. Uses the PC's webcam and its default printer.
REM To leave the kiosk: press Alt+F4, then close the "Collective Booth Server" window.
title The Collective Booth
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this PC.
  echo Opening the download page. Install the LTS version, then double-click this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing the booth, one time only...
  call npm install --omit=dev
  if errorlevel 1 ( echo Install failed. Check the internet connection and try again. & pause & exit /b 1 )
)

echo.
echo Printers on this PC (* = default, the booth uses the default unless config.json names one):
node server.js --list-printers
echo.

start "Collective Booth Server" /min cmd /c "node server.js"
timeout /t 3 /nobreak >nul

set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME="%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set CHROME="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set CHROME="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME (
  echo Chrome or Edge was not found. Open http://localhost:3000 in any browser and press F11.
  pause
  exit /b 0
)

REM A separate profile makes the kiosk flags apply even if Chrome is already open.
start "" %CHROME% --user-data-dir="%LocalAppData%\CollectiveBooth" --kiosk --app=http://localhost:3000 --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --disable-session-crashed-bubble --noerrdialogs --no-first-run --overscroll-history-navigation=0 --disable-pinch
