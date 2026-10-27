@echo off
chcp 65001 >nul
setlocal
if not defined COMIC_NODE set "COMIC_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined COMIC_PORT set "COMIC_PORT=18896"
if not defined IMAGE_REPAIR_PORT set "IMAGE_REPAIR_PORT=14426"
call "%~dp0tools\release-env.cmd"
set "TEMP=%~dp0.runtime\temp"
set "TMP=%TEMP%"
set "PYTHONPYCACHEPREFIX=%~dp0.runtime\pycache"
if not exist "%TEMP%" mkdir "%TEMP%"
"%COMIC_NODE%" "%~dp0tools\start-integrated.mjs" --open %*
if errorlevel 1 pause
