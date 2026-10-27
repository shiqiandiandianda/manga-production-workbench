@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title PhotoCraft 局域网协作 · 工作节点

set "NODE=%~dp0..\workbench\运行环境\node\node.exe"

if not exist "%NODE%" (
  echo [错误] 找不到包内 Node 运行环境：
  echo         %NODE%
  echo 请确认软件包目录完整（不要单独复制本文件到别处）。
  pause
  exit /b 1
)

rem 优先使用手动复制的 config\node.json；否则自动查找 节点.mjs pair 生成的运行数据配置。
set "CONFIG="
if exist "%~dp0config\node.json" set "CONFIG=%~dp0config\node.json"

if not defined CONFIG (
  for /d %%D in ("%~dp0..\运行数据\协作\节点-*") do (
    if exist "%%~fD\config.json" (
      if defined CONFIG (
        echo [错误] 找到多个已配对节点的配置文件，无法确定使用哪一个：
        echo         已有：!CONFIG!
        echo         又发现：%%~fD\config.json
        echo 请删除不用的「开发\运行数据\协作\节点-*」目录，或改为手动指定配置启动。
        pause
        exit /b 1
      )
      set "CONFIG=%%~fD\config.json"
    )
  )
)

if not defined CONFIG (
  echo [首次运行] 还没有已配对的节点配置。
  echo 查找位置：config\node.json 或 运行数据\协作\节点-*\config.json
  echo.
  echo 节点必须先配对取得令牌。请在 A 电脑中控启动后，拿到「中控地址」和「配对码」，
  echo 然后在本目录打开命令行（或把下面命令存成 .cmd）执行：
  echo.
  echo   "%~dp0..\workbench\运行环境\node\node.exe" "%~dp0节点.mjs" pair --hub http://A电脑IP:18897 --code 配对码 --name B电脑
  echo.
  echo 配对成功会把配置写到 开发\运行数据\协作\节点-^<名字^>\config.json，
  echo 之后再双击本脚本即可自动找到配置并启动节点。
  echo 注意：本机需要先启动现有漫画工具（18896 漫画服务），节点只调用本机回环地址生图，
  echo       节点不开放任何入站端口，也不需要在中控电脑上做端口映射。
  pause
  exit /b 1
)

echo ==================================================
echo  PhotoCraft 局域网协作 · 工作节点
echo  配置：%CONFIG%
echo.
echo  节点不开放入站端口，只主动连中控；本机 18896 漫画服务必须已启动。
echo  关闭本窗口即停止节点，中控会把它标记为离线。
echo ==================================================
echo.

"%NODE%" "%~dp0节点.mjs" run --config "%CONFIG%" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo [错误] 协作节点退出，错误码 %EXITCODE%。
  echo 常见原因：中控地址填错/中控没启动、令牌无效（需要重新 pair）、本机 18896 漫画服务没启动。
  echo 请把上面的中文报错截图发给维护人员。
) else (
  echo 协作节点已停止。
)
pause
exit /b %EXITCODE%
