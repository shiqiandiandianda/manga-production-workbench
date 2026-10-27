param([string]$ToolDirectory,[switch]$ValidateOnly,[switch]$NoUpgrade)
$ErrorActionPreference='Stop'
$repairPayload=Join-Path $PSScriptRoot 'connection-patch.json'
if(!(Test-Path -LiteralPath $repairPayload)){throw '缺少 connection-patch.json，请完整解压同事连接修复包。'}
$repairTarget=Get-Content -LiteralPath $repairPayload -Raw -Encoding UTF8|ConvertFrom-Json
$repairCandidates=New-Object 'System.Collections.Generic.List[string]'
function Add-RepairCandidate([string]$candidate){
 if(!$candidate){return}
 $candidate=[IO.Path]::GetFullPath($candidate).TrimEnd('\')
 if((Split-Path $candidate -Leaf) -eq 'comic'){$candidate=Split-Path $candidate -Parent}
 $channelFile=Join-Path $candidate 'distribution\channel.json'
 if((Test-Path -LiteralPath $channelFile) -and (Test-Path -LiteralPath (Join-Path $candidate 'runtime\node\node.exe'))){
  $known=Get-Content -LiteralPath $channelFile -Raw -Encoding UTF8|ConvertFrom-Json
  if($known.publicKey -eq $repairTarget.publicKey -and !$repairCandidates.Contains($candidate)){$repairCandidates.Add($candidate)}
 }
}
if($ToolDirectory){Add-RepairCandidate $ToolDirectory}else{
 Add-RepairCandidate $PSScriptRoot
 Add-RepairCandidate (Split-Path $PSScriptRoot -Parent)
 foreach($port in @(18909,18924)){try{$health=Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2;Add-RepairCandidate $health.codeRoot}catch{}}
 if($repairCandidates.Count -eq 0){foreach($port in @(18913,18925)){try{$state=Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/status" -TimeoutSec 2;Add-RepairCandidate $state.root}catch{}}}
}
if($repairCandidates.Count -eq 0){throw '未找到本团队的工具。请先打开自己的漫画工作台，再双击修复；也可以通过 -ToolDirectory 指定完整工具目录。'}
$repairRoot=$repairCandidates[0]
if($repairCandidates.Count -gt 1){
 Write-Host '发现多套工作台，请选择要修复的一套：'
 for($i=0;$i -lt $repairCandidates.Count;$i++){Write-Host ("{0}. {1}" -f ($i+1),$repairCandidates[$i])}
 $repairChoice=0
 if(![int]::TryParse((Read-Host '输入编号'),[ref]$repairChoice) -or $repairChoice -lt 1 -or $repairChoice -gt $repairCandidates.Count){throw '没有选择有效的工具目录，未修改。'}
 $repairRoot=$repairCandidates[$repairChoice-1]
}
Write-Host ('正在修复：'+$repairRoot)
$repairArguments=@((Join-Path $PSScriptRoot 'reconnect.mjs'),'--root',$repairRoot,'--payload',$repairPayload)
if($ValidateOnly){$repairArguments+='--validate-only'}
if($NoUpgrade){$repairArguments+='--no-upgrade'}
& (Join-Path $repairRoot 'runtime\node\node.exe') @repairArguments
if($LASTEXITCODE -ne 0){throw '连接修复没有完成，请保留窗口内的具体提示。'}
