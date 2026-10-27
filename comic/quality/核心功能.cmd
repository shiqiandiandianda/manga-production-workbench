@echo off
setlocal
cd /d "%~dp0.."
node quality\run.mjs --suite core-functions %*
exit /b %errorlevel%
