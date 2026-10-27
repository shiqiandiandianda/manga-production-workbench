@echo off
chcp 65001 >nul
cd /d "%~dp0"
"runtime\node\node.exe" "%~dp0start-all.mjs" --center-port 18911
if errorlevel 1 pause
