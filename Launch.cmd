@echo off
rem Opens Being. The first time, runs Setup.
if exist "%~dp0.setup\ready.json" if exist "%~dp0node_modules\electron\dist\electron.exe" (start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." & exit /b 0)
call "%~dp0Setup.cmd" --launch %*
