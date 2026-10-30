@echo off
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0平台启动配置\控制工作台.ps1" -Mode Restart %*
if errorlevel 1 (
  pause
  exit /b 1
)
exit /b 0
