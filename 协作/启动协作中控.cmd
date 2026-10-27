@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title PhotoCraft 局域网协作 · 中控

set "NODE=%~dp0..\workbench\运行环境\node\node.exe"

if not exist "%NODE%" (
  echo [错误] 找不到包内 Node 运行环境：
  echo         %NODE%
  echo 请确认软件包目录完整（不要单独复制本文件到别处）。
  pause
  exit /b 1
)

if not exist "%~dp0config\hub.json" (
  echo [首次运行] 还没有中控配置文件：config\hub.json
  echo.
  echo 请先复制配置示例，再按需修改端口 / 中控名 / 数据目录：
  echo     copy "%~dp0config\hub.example.json" "%~dp0config\hub.json"
  echo.
  echo 提示：config\hub.json 里 host 填 0.0.0.0 表示允许局域网其他电脑连接；
  echo       只想本机测试可改成 127.0.0.1。端口默认 18897。
  pause
  exit /b 1
)

echo ==================================================
echo  PhotoCraft 局域网协作 · 中控
echo  配置：%~dp0config\hub.json
echo.
echo  启动后会显示「中控地址」和 6 位配对码：
echo    - 控制台：在本机浏览器打开 http://127.0.0.1:18897/
echo    - B 电脑：用中控地址 + 配对码配对，再启动协作节点
echo  关闭本窗口即停止中控，节点会显示离线。
echo ==================================================
echo.

"%NODE%" "%~dp0中控.mjs" --config "%~dp0config\hub.json" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo [错误] 协作中控退出，错误码 %EXITCODE%。
  echo 请把上面的中文报错截图发给维护人员；常见原因：端口 18897 被占用、配置文件不是有效 JSON。
) else (
  echo 协作中控已停止。
)
echo.
echo 提示：局域网其他电脑连不上时，请在 Windows 防火墙放行 TCP 18897；
echo       本机地址可用 ipconfig 查看 IPv4 地址。
pause
exit /b %EXITCODE%
