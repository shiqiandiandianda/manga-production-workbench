param([string]$CodeDirectory=(Split-Path $PSScriptRoot -Parent),[string]$MokuSessionFile,[string]$PackageDirectory,[switch]$Interactive,[switch]$SkipJoin,[switch]$NoStart)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($CodeDirectory).TrimEnd('\')
if($taskRoot -notmatch '^[d-zD-Z]:\\'){throw '请把完整代码目录解压到 D 盘或其他数据盘，不能安装到 C 盘。'}
if(!(Test-Path -LiteralPath (Join-Path $taskRoot 'comic\server.mjs'))){throw '代码目录不完整，缺少 comic/server.mjs。'}
$taskSpec=Get-Content -LiteralPath (Join-Path $taskRoot 'distribution\environments.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskCache=if($PackageDirectory){[IO.Path]::GetFullPath($PackageDirectory)}else{Join-Path $taskRoot '.runtime\downloads'}
[IO.Directory]::CreateDirectory($taskCache)|Out-Null
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskHandler=New-Object Net.Http.HttpClientHandler
$taskHandler.UseProxy=$false
$taskClient=New-Object Net.Http.HttpClient($taskHandler)
$taskClient.Timeout=[TimeSpan]::FromMinutes(30)
$taskCookie=''
$taskChannel=if(Test-Path -LiteralPath (Join-Path $taskRoot 'distribution\channel.json')){Get-Content -LiteralPath (Join-Path $taskRoot 'distribution\channel.json') -Raw -Encoding UTF8|ConvertFrom-Json}else{$null}
$taskRelay=$false
if($taskChannel){try{$r=$taskClient.GetAsync($taskChannel.masterUrl+'/health').GetAwaiter().GetResult();try{$info=$r.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json;$taskRelay=$r.IsSuccessStatusCode -and $info.application -eq 'comic-team-publisher' -and $info.environmentRelay}finally{$r.Dispose()}}catch{}}
function Test-Archive($TaskFile,$TaskPackage){return (Test-Path -LiteralPath $TaskFile) -and (Get-Item -LiteralPath $TaskFile).Length -eq $TaskPackage.bytes -and (Get-FileHash -LiteralPath $TaskFile -Algorithm SHA256).Hash.ToLowerInvariant() -eq $TaskPackage.sha256}
function Test-Session($TaskCandidate){
 if(!$TaskCandidate){return $false}
 $q=New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get,($taskSpec.mokuBase+'/api/auth/me'))
 $q.Headers.TryAddWithoutValidation('Cookie',$TaskCandidate)|Out-Null
 try{$r=$taskClient.SendAsync($q).GetAwaiter().GetResult();try{return $r.IsSuccessStatusCode}finally{$r.Dispose()}}catch{return $false}finally{$q.Dispose()}
}
function Get-Session {
 $paths=@($MokuSessionFile,(Join-Path $taskRoot 'runtime-data\comic\library-session.local.json'))|Where-Object {$_}
 foreach($f in $paths){if(Test-Path -LiteralPath $f){try{$s=Get-Content -LiteralPath $f -Raw -Encoding UTF8|ConvertFrom-Json;if($s.base -and $s.base.TrimEnd('/') -ne $taskSpec.mokuBase.TrimEnd('/')){continue};if(Test-Session $s.cookie){return [string]$s.cookie}}catch{}}}
 if(!$Interactive){throw 'MOKU_LOGIN_REQUIRED：缺少此电脑自己的墨库登录。双击“安装并接入.cmd”登录，或传入 -MokuSessionFile；不要向同事索取其他人的会话。'}
 $username=Read-Host '墨库用户名（使用本人的账号）'
 $secret=Read-Host '墨库密码' -AsSecureString
 $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
 try{$password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr);$payload=@{username=$username;password=$password}|ConvertTo-Json -Compress;$content=New-Object Net.Http.StringContent($payload,[Text.Encoding]::UTF8,'application/json');$r=$taskClient.PostAsync($taskSpec.mokuBase+'/api/auth/login',$content).GetAwaiter().GetResult();try{if(!$r.IsSuccessStatusCode){throw ('墨库登录失败，HTTP '+[int]$r.StatusCode)}}finally{$r.Dispose();$content.Dispose()}}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$password=$null;$payload=$null}
 $cookie=$taskHandler.CookieContainer.GetCookieHeader([Uri]$taskSpec.mokuBase)
 if(!(Test-Session $cookie)){throw '墨库没有返回有效登录，请核对账号。'}
 $file=Join-Path $taskRoot 'runtime-data\comic\library-session.local.json';[IO.Directory]::CreateDirectory((Split-Path $file -Parent))|Out-Null
 [IO.File]::WriteAllText($file,(@{base=$taskSpec.mokuBase;cookie=$cookie}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 return $cookie
}
function Download-Package($TaskPackage,$TaskFile){
 $partial=$TaskFile+'.part'
 for($attempt=0;$attempt -lt 3;$attempt++){
  $url=if($taskRelay){$taskChannel.masterUrl+'/api/environments/'+$TaskPackage.revisionId}else{$taskSpec.mokuBase+'/api/revisions/'+$TaskPackage.revisionId+'/download'}
  $q=New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get,$url)
  if($taskRelay){$q.Headers.TryAddWithoutValidation('X-Setup-Invitation',$taskChannel.enrollmentCode)|Out-Null}else{$q.Headers.TryAddWithoutValidation('Cookie',$taskCookie)|Out-Null}
  $offset=if(Test-Path -LiteralPath $partial){(Get-Item -LiteralPath $partial).Length}else{0}
  if($offset -gt 0 -and $offset -lt $TaskPackage.bytes){$q.Headers.Range=New-Object Net.Http.Headers.RangeHeaderValue($offset,$null)}else{$offset=0}
  try{
   $r=$taskClient.SendAsync($q,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
   try{
    if(!$r.IsSuccessStatusCode){throw ('墨库环境包下载失败，HTTP '+[int]$r.StatusCode)}
    if([int]$r.StatusCode -ne 206){$offset=0}
    elseif(!$r.Content.Headers.ContentRange -or $r.Content.Headers.ContentRange.From -ne $offset){throw '下载续传位置不一致'}
    $input=$r.Content.ReadAsStreamAsync().GetAwaiter().GetResult();$mode=if($offset){[IO.FileMode]::Append}else{[IO.FileMode]::Create};$output=[IO.File]::Open($partial,$mode,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$buffer=New-Object byte[] (1024*1024);$total=$offset;$next=$total+32MB;while(($read=$input.Read($buffer,0,$buffer.Length)) -gt 0){$output.Write($buffer,0,$read);$total+=$read;if($total -gt $TaskPackage.bytes){throw '下载内容超过已登记长度'};if($total -ge $next){Write-Host ($TaskPackage.name+' · '+[Math]::Round($total*100/$TaskPackage.bytes)+'%');$next=$total+32MB}}}finally{$input.Dispose();$output.Dispose()}
   }finally{$r.Dispose()}
   if(!(Test-Archive $partial $TaskPackage)){if(Test-Path -LiteralPath $partial){Remove-Item -LiteralPath $partial -Force};throw '下载包 SHA-256 不一致，未解压'}
   Move-Item -LiteralPath $partial -Destination $TaskFile -Force;return
  }catch{if($attempt -eq 2){throw};Write-Host '下载中断，将保留分片并重试。';Start-Sleep -Seconds 2}finally{$q.Dispose()}
 }
}
function Expand-Verified($TaskFile){
 $taskEnvironmentPython=Join-Path $taskRoot 'runtime\python\python.exe'
 if(Test-Path -LiteralPath $taskEnvironmentPython){
  & $taskEnvironmentPython -B (Join-Path $taskRoot 'distribution\restore-environment.py') --root $taskRoot --archive $TaskFile
  if($LASTEXITCODE){throw '环境逐文件恢复失败，原件和下载缓存保留。'}
  return
 }
 $archive=[IO.Compression.ZipFile]::OpenRead($TaskFile)
 try{
  $entry=$archive.GetEntry('ENVIRONMENT.sha256.json');if(!$entry){throw '环境包缺少内部文件清单'}
  $reader=New-Object IO.StreamReader($entry.Open(),[Text.Encoding]::UTF8);try{$items=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
  foreach($item in $items){
   $relative=[string]$item.path
   if($relative -match '(^/|\\|:|(^|/)\.\.(/|$))' -or $relative -notmatch '^(runtime/|\.runtime/image-tools/|comic/public/fonts/|comic/repair-engine/public/fonts/)'){throw ('环境包含非环境路径：'+$relative)}
   $target=[IO.Path]::GetFullPath((Join-Path $taskRoot $relative));if(!$target.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '环境包路径越界'}
   $walk=$taskRoot;foreach($piece in ($relative -split '/')){$walk=Join-Path $walk $piece;if((Test-Path -LiteralPath $walk) -and ((Get-Item -LiteralPath $walk -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw ('环境目录包含链接，停止安装：'+$relative)}}
   if((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $item.sha256){continue}
   $source=$archive.GetEntry($relative);if(!$source -or $source.Length -ne $item.bytes){throw ('环境包条目不一致：'+$relative)}
   [IO.Directory]::CreateDirectory((Split-Path $target -Parent))|Out-Null
   $temp=$target+'.installing';[IO.Compression.ZipFileExtensions]::ExtractToFile($source,$temp,$true)
   if((Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256){throw ('解压后校验失败：'+$relative)}
   if(Test-Path -LiteralPath $target){$backup=Join-Path $taskRoot ('.runtime\installer-backups\'+(Get-Date -Format yyyyMMddHHmmss)+'\'+$relative);[IO.Directory]::CreateDirectory((Split-Path $backup -Parent))|Out-Null;Copy-Item -LiteralPath $target -Destination $backup}
   Move-Item -LiteralPath $temp -Destination $target -Force
  }
 }finally{$archive.Dispose()}
}
try{
 $missing=@($taskSpec.packages|Where-Object {!(Test-Archive (Join-Path $taskCache $_.name) $_)})
 if($missing.Count -and !$taskRelay){$taskCookie=Get-Session}
 foreach($package in $taskSpec.packages){$file=Join-Path $taskCache $package.name;if(!(Test-Archive $file $package)){Write-Host ('正在从墨库下载：'+$package.name);Download-Package $package $file};Write-Host ('校验并恢复：'+$package.name);Expand-Verified $file}
 $node=Join-Path $taskRoot 'runtime\node\node.exe'
 & $node (Join-Path $taskRoot 'distribution\colleague.mjs') setup --root $taskRoot $(if($SkipJoin){'--skip-join'}else{'--join'})
 if($LASTEXITCODE){throw '运行环境或接入检查未通过，请查看上方具体原因。'}
 if(!$NoStart){& $node (Join-Path $taskRoot 'start-all.mjs');if($LASTEXITCODE){throw '工具启动未完成'}}
 Write-Host '三个本地模型、字体和运行环境已恢复并校验。'
}finally{$taskClient.Dispose();$taskHandler.Dispose()}
