@echo off
chcp 65001 >nul
setlocal
call "%~dp0tools\release-env.cmd"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-release-dependencies.ps1"
if errorlevel 1 pause
