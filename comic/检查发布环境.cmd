@echo off
chcp 65001 >nul
setlocal
call "%~dp0tools\release-env.cmd"
"%COMIC_NODE%" "%~dp0tools\check-release-environment.mjs"
if errorlevel 1 pause
