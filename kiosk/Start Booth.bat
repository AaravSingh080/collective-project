@echo off
REM THE COLLECTIVE photo booth - no-install launcher for Windows.
REM Needs only Google Chrome (or Edge), a webcam, and the photo printer set as the DEFAULT printer.
REM Prints go straight to the default printer with no dialog (Chrome's kiosk printing).
REM To leave the booth: press Alt+F4.
title The Collective Booth
cd /d "%~dp0"

set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME="%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set CHROME="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set CHROME="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME (
  echo Google Chrome was not found. Opening the download page.
  start "" https://www.google.com/chrome/
  pause
  exit /b 1
)

set PAGE=%~dp0booth.html
set PAGE=%PAGE:\=/%

REM A separate profile makes these flags apply even if Chrome is already open.
start "" %CHROME% --user-data-dir="%LocalAppData%\CollectiveBoothKiosk" --kiosk --kiosk-printing --app="file:///%PAGE%" --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --disable-session-crashed-bubble --noerrdialogs --no-first-run --disable-pinch --overscroll-history-navigation=0
