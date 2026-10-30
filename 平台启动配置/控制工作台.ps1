param(
    [ValidateSet('Start', 'Restart')][string]$Mode = 'Start',
    [string]$PlatformRoot = (Split-Path $PSScriptRoot -Parent),
    [int]$ComicPort = 18909,
    [int]$AssetPort = 8796,
    [int]$CenterPort = 18911,
    [int]$ControlPort = 18913,
    [int]$TimeoutSeconds = 180,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$PlatformRoot = [IO.Path]::GetFullPath($PlatformRoot).TrimEnd('\')
$controlUrl = "http://127.0.0.1:$ControlPort"
$editorUrl = "http://127.0.0.1:$ComicPort/"
$hubUrl = "http://127.0.0.1:$CenterPort/tools"
$logDirectory = Join-Path $PlatformRoot 'runtime-data\logs'
$launcherLog = Join-Path $logDirectory 'one-click-control.log'
$lockHeld = $false
$launcherMutex = $null

function Write-ProgressLine([string]$Message) {
    Write-Host $Message
    Add-Content -LiteralPath $launcherLog -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
}
function Read-Service([string]$Url) {
    try { return Invoke-RestMethod -Uri $Url -TimeoutSec 4 -Proxy $null } catch { return $null }
}
function Same-Path([string]$Left, [string]$Right) {
    if (-not $Left -or -not $Right) { return $false }
    return [IO.Path]::GetFullPath($Left).TrimEnd('\') -ieq [IO.Path]::GetFullPath($Right).TrimEnd('\')
}
function Port-InUse([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $connect = $client.ConnectAsync('127.0.0.1', $Port)
        return $connect.Wait(400) -and $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}
function Read-Manager {
    $status = Read-Service "$controlUrl/api/status"
    if ($null -ne $status) {
        if ($status.application -notin @('comic-team-primary', 'comic-team-colleague') -or -not (Same-Path $status.root $PlatformRoot)) {
            throw "版本管理端口 $ControlPort 属于其他工具或其他目录，已停止本次操作。"
        }
    }
    return $status
}
function Recover-StandaloneEditor {
    $occupied = @(@($ComicPort, $AssetPort, $CenterPort, $ControlPort) | Where-Object { Port-InUse $_ })
    if ($occupied.Count -ne 1 -or $occupied[0] -ne $ComicPort) { return }
    $editorState = Read-Service "${editorUrl}api/health"
    if ($editorState.application -ne 'comic-merged-studio' -or -not (Same-Path $editorState.codeRoot (Join-Path $PlatformRoot 'comic')) -or -not (Same-Path $editorState.dataRoot (Join-Path $PlatformRoot 'runtime-data\comic'))) {
        throw "端口 $ComicPort 上的独立服务不属于当前工作台，未停止其他工具。"
    }
    $editorData = Read-Service "${editorUrl}api/state"
    if ($null -eq $editorData -or $null -eq $editorData.jobs -or $null -eq $editorState.generation) { throw '无法确认独立编辑器的任务状态，未执行恢复。' }
    $activeJobs = @($editorData.jobs | Where-Object { $_.status -in @('queued', 'preparing', 'running', 'awaiting_confirmation', 'recoverable', 'delegated') })
    if ($activeJobs.Count -or $editorState.generation.running -gt 0 -or $editorState.generation.queued -gt 0 -or $editorState.generation.remoteUnknown -gt 0 -or $editorState.generation.activeEpisodeBatches -gt 0 -or $editorState.promptRewrite.running -gt 0 -or $editorState.styleDesign.running -gt 0) {
        throw '独立编辑器仍有任务需要完成或核对，未停止服务；请先在生成记录中处理原任务。'
    }
    Write-ProgressLine '检测到同目录的独立编辑器；任务已空闲，正在正常退出并恢复完整工作台…'
    $stopBody = @{expectedCodeRoot=$editorState.codeRoot} | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Uri "${editorUrl}api/project-center/service/stop" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($stopBody)) -TimeoutSec 15 -Proxy $null
    if ($result.ok -ne $true) { throw '独立编辑器未确认安全退出，未强制结束。' }
    $deadline = (Get-Date).AddSeconds(20)
    while (Port-InUse $ComicPort) {
        if ((Get-Date) -gt $deadline) { throw '独立编辑器尚未释放端口，请稍后再次启动；未强制结束进程。' }
        Start-Sleep -Milliseconds 200
    }
}
function Get-MissingTools($Manager) {
    $missing = @()
    if ($null -eq $Manager) { $missing += '版本管理' }
    else {
        foreach ($name in @('comic', 'assets', 'center')) {
            if (-not @($Manager.services | Where-Object { $_.name -eq $name -and $_.running }).Count) { $missing += $name }
        }
        foreach ($service in @($Manager.services)) {
            if (-not $service.running) { $missing += $service.name }
        }
    }
    $comic = Read-Service "${editorUrl}api/health"
    if ($null -eq $comic) { $missing += '漫画编辑器' }
    elseif ($comic.application -ne 'comic-merged-studio' -or -not (Same-Path $comic.codeRoot (Join-Path $PlatformRoot 'comic'))) { throw '漫画编辑器端口属于其他版本，已停止本次操作。' }
    else {
        foreach ($tool in @('upscale', 'cutout', 'inpaint')) {
            if ($comic.localImageTools.$tool.ready -ne $true) { $missing += "本地修图模型 $tool" }
        }
    }
    $center = Read-Service "http://127.0.0.1:$CenterPort/api/v1/center/status"
    if ($null -eq $center) { $missing += '本机工作台' }
    elseif ($center.application -ne 'project-production-center' -or -not (Same-Path $center.codeRoot (Join-Path $PlatformRoot 'workbench'))) { throw '本机工作台端口属于其他版本，已停止本次操作。' }
    $asset = Read-Service "http://127.0.0.1:$AssetPort/api/health"
    if ($null -eq $asset -or -not $asset.ok) { $missing += '资产工作室' }
    elseif (-not (Same-Path $asset.dataRoot (Join-Path $PlatformRoot 'runtime-data\asset-studio'))) { throw '资产工作室数据目录不匹配，已停止本次操作。' }
    $settingsFile = Join-Path $PlatformRoot 'runtime-data\center\settings.json'
    if (Test-Path -LiteralPath $settingsFile) {
        $settings = Get-Content -LiteralPath $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $scene = Read-Service ("http://127.0.0.1:{0}/api/status" -f $settings.scene.port)
        if ($scene.applicationId -ne 'scene-studio-local') { $missing += '场景引擎' }
        $workshop = Read-Service ("http://127.0.0.1:{0}/api/health" -f $settings.workshop.port)
        if ($workshop.app -ne 'comic-character-workbench' -or -not $workshop.ok) { $missing += '角色工房' }
    } else { $missing += '角色与场景配置' }
    if (Test-Path -LiteralPath (Join-Path $PlatformRoot 'auto-layout\learning-workbench\integration_server.py')) {
        $layoutPort = if ($env:AUTO_LAYOUT_PORT) { [int]$env:AUTO_LAYOUT_PORT } else { 19848 }
        $layout = Read-Service "http://127.0.0.1:$layoutPort/api/health"
        if ($layout.app -ne 'comic-layout-learning-workbench') { $missing += '自动排版' }
        elseif (-not (Same-Path $layout.root (Join-Path $PlatformRoot 'auto-layout\learning-workbench'))) { throw '自动排版端口属于其他版本，已停止本次操作。' }
    }
    return $missing | Select-Object -Unique
}

try {
    $nodeFile = Join-Path $PlatformRoot 'runtime\node\node.exe'
    if (-not (Test-Path -LiteralPath $nodeFile) -or -not (Test-Path -LiteralPath (Join-Path $PlatformRoot 'start-all.mjs'))) { throw '未找到工作台及内置运行环境，请把启动器保留在当前版本目录。' }
    foreach ($port in @($ComicPort, $AssetPort, $CenterPort, $ControlPort)) {
        if ($port -lt 1024 -or $port -gt 65535) { throw '启动端口无效。' }
    }
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $lockId = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($PlatformRoot.ToLowerInvariant()))).Replace('-', '') } finally { $hash.Dispose() }
    $launcherMutex = New-Object Threading.Mutex($false, ("Local\ComicWorkbenchControl-" + $lockId))
    try { $lockHeld = $launcherMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $lockHeld = $true }
    if (-not $lockHeld) { Write-Host '工作台正在启动或重启，请等待原窗口完成，不需要重复点击。'; exit 0 }
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Write-ProgressLine '正在核对工作台与各工具状态…'
    $manager = Read-Manager
    if ($Mode -eq 'Restart' -and $null -ne $manager) {
        if ($manager.busy -or $manager.readiness.allowed -ne $true -or $manager.forcedUpgrade) {
            $reasons = @($manager.readiness.blockers | ForEach-Object { (@($_.serviceName, $_.target, $_.status) | Where-Object { $_ }) -join ' · ' }) -join '；'
            throw "暂不能重启：还有任务正在执行、更新正在处理或状态尚未确认。$reasons"
        }
        # Verify the editor's identity before asking the manager to stop its services.
        $editorState = Read-Service "${editorUrl}api/health"
        if (-not (Same-Path $editorState.codeRoot (Join-Path $PlatformRoot 'comic'))) { throw '无法确认当前漫画编辑器身份，未执行重启。' }
        $managerPage = Invoke-WebRequest -Uri "$controlUrl/" -UseBasicParsing -TimeoutSec 8 -Proxy $null
        $nonceMatch = [regex]::Match($managerPage.Content, "const nonce='([a-fA-F0-9]{48})'")
        if (-not $nonceMatch.Success) { throw '无法取得本机安全停止入口，未执行重启。' }
        Write-ProgressLine '任务检查通过，正在安全停止各工具…'
        $stopped = Invoke-RestMethod -Uri "$controlUrl/api/stop" -Method Post -Headers @{'X-Local-Control'=$nonceMatch.Groups[1].Value; Origin=$controlUrl} -TimeoutSec 180 -Proxy $null
        if ($stopped.error) { throw $stopped.error }
        $stopDeadline = (Get-Date).AddSeconds(60)
        do {
            $occupied = @(@($ComicPort, $AssetPort, $CenterPort, $ControlPort) | Where-Object { Port-InUse $_ })
            if (-not $occupied.Count) { break }
            if ((Get-Date) -gt $stopDeadline) { throw ('旧服务尚未完全退出，未强制结束。占用端口：' + ($occupied -join ', ')) }
            Start-Sleep -Milliseconds 600
        } while ($true)
        $manager = $null
    }
    if ($null -eq $manager) {
        Recover-StandaloneEditor
        $occupied = @(@($ComicPort, $AssetPort, $CenterPort, $ControlPort) | Where-Object { Port-InUse $_ })
        if ($occupied.Count) { throw ('检测到已有服务，但无法确认统一管理器。请查看版本管理页；未结束任何进程。端口：' + ($occupied -join ', ')) }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $outputLog = Join-Path $logDirectory "one-click-$stamp.out.log"
        $errorLog = Join-Path $logDirectory "one-click-$stamp.err.log"
        Write-ProgressLine '正在后台启动漫画编辑器、资产工作室、场景引擎、角色工房、自动排版和配套服务…'
        $launchArgs = @('start-all.mjs', '--center-port', "$CenterPort", '--comic-port', "$ComicPort", '--asset-port', "$AssetPort", '--control-port', "$ControlPort", '--no-browser')
        $startedProcess = Start-Process -FilePath $nodeFile -ArgumentList $launchArgs -WorkingDirectory $PlatformRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
    } else { Write-ProgressLine '工作台已运行，直接复用当前服务。' }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if ($startedProcess -and $startedProcess.HasExited) { throw "启动进程已退出，请查看日志：$errorLog" }
        $manager = Read-Manager
        $missing = @(Get-MissingTools $manager)
        if (-not $missing.Count) { break }
        if ((Get-Date) -gt $deadline) { throw ('部分工具仍未就绪：' + ($missing -join '、') + "。日志目录：$logDirectory") }
        Write-ProgressLine ('正在等待：' + ($missing -join '、'))
        Start-Sleep -Seconds 2
    } while ($true)
    Write-ProgressLine '全部工具已就绪。关闭本窗口不会停止后台工具。'
    Write-Host "漫画工作台：$editorUrl"
    Write-Host "工具入口：$hubUrl"
    if (-not $NoBrowser) {
        Start-Process $editorUrl
        Start-Process $hubUrl
    }
    exit 0
} catch {
    Write-Host ("操作未完成：" + $_.Exception.Message) -ForegroundColor Red
    if (Test-Path -LiteralPath $logDirectory) { Add-Content -LiteralPath $launcherLog -Value ("[{0}] ERROR: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_.Exception.Message) -Encoding UTF8 }
    exit 1
} finally {
    if ($lockHeld) { $launcherMutex.ReleaseMutex() }
    if ($launcherMutex) { $launcherMutex.Dispose() }
}
