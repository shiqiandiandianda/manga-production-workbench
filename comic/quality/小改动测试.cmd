@echo off
setlocal
cd /d "%~dp0.."
node quality\run.mjs --suite small %*
exit /b %errorlevel%
