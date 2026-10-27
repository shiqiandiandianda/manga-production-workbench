@echo off
setlocal
cd /d "%~dp0.."
node quality\run.mjs --suite large %*
exit /b %errorlevel%
