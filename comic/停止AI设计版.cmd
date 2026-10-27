@echo off
chcp 65001 >nul
setlocal
if not defined COMIC_NODE set "COMIC_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
call "%~dp0tools\release-env.cmd"
"%COMIC_NODE%" "%~dp0tools\stop-integrated.mjs"
if errorlevel 1 pause
