@echo off
REM THE COLLECTIVE photo booth - stop the booth from starting with Windows.
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Collective Booth.bat"
if exist "%LINK%" del "%LINK%"
echo The booth will no longer start by itself. Sleep settings were left as they are.
pause
