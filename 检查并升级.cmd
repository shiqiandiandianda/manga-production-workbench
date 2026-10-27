@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0runtime\node\node.exe" (
  echo 请先运行“安装并接入.cmd”。
  exit /b 1
)
"%~dp0runtime\node\node.exe" "%~dp0distribution\colleague.mjs" apply --root "%~dp0."
pause
