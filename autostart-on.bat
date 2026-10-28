@echo off
REM THE COLLECTIVE photo booth - start the booth every time this PC is switched on.
REM Also stops the PC and screen from going to sleep while plugged in.
REM Undo with autostart-off.bat.
cd /d "%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK=%STARTUP%\Collective Booth.bat"
> "%LINK%" echo @echo off
>> "%LINK%" echo REM Starts The Collective photo booth at sign-in. Remove with autostart-off.bat.
>> "%LINK%" echo timeout /t 20 /nobreak ^>nul
>> "%LINK%" echo cd /d "%~dp0"
>> "%LINK%" echo call "%~dp0start-kiosk.bat"
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
echo.
echo Done. The booth will open by itself about 20 seconds after Windows signs in.
echo Sleep and screen-off are turned off while the PC is plugged in.
pause
