@echo off
setlocal
cd /d "%~dp0.."
node quality\run.mjs --suite all-functions %*
exit /b %errorlevel%
