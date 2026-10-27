@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0distribution\Install.ps1" -CodeDirectory "%~dp0." -Interactive
pause
