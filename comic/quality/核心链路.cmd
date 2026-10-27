@echo off
setlocal
cd /d "%~dp0.."
node quality\run.mjs --suite core-flows %*
exit /b %errorlevel%
