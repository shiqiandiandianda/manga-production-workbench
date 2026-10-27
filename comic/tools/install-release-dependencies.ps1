param()
$ErrorActionPreference='Stop'
$taskReleaseRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskReleaseRoot
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or ![Environment]::Is64BitOperatingSystem) {throw 'Windows x64 is required.'}
$taskNode=$env:COMIC_NODE
if (!(Test-Path -LiteralPath $taskNode)) {throw 'Install Node.js 24 x64 first or configure COMIC_NODE.'}
& $taskNode -e 'if(process.platform!=="win32"||process.arch!=="x64"||Number(process.versions.node.split(".")[0])<22)process.exit(1)'
if ($LASTEXITCODE) {throw 'Node.js >=22 for Windows x64 is required.'}
$taskNpm=$env:COMIC_NPM
if (!$taskNpm) {$taskNpm=Join-Path (Split-Path $taskNode) 'npm.cmd'}
if (!(Test-Path -LiteralPath $taskNpm)) {throw 'npm.cmd not found; configure COMIC_NPM.'}
$taskPython=$env:COMIC_PYTHON_BASE
if (!$taskPython) {
  $taskCommand=Get-Command python.exe -ErrorAction SilentlyContinue
  if ($taskCommand -and $taskCommand.Source -notlike '*WindowsApps*') {$taskPython=$taskCommand.Source}
  elseif (Test-Path -LiteralPath $env:COMIC_PYTHON_BIN) {$taskPython=$env:COMIC_PYTHON_BIN}
}
if (!$taskPython -or !(Test-Path -LiteralPath $taskPython)) {throw 'Install Python 3.12 x64 first or configure COMIC_PYTHON_BASE.'}
& $taskPython -c 'import sys; assert sys.version_info[:2]==(3,12), "Python 3.12 is required"'
if ($LASTEXITCODE) {throw 'Python version check failed.'}
if (!(Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
 & $taskPython -m venv .venv
 if ($LASTEXITCODE) {throw 'Cannot create isolated Python environment.'}
}
& '.\.venv\Scripts\python.exe' -m pip --isolated install --disable-pip-version-check --index-url https://pypi.org/simple --only-binary=:all: -r requirements.lock.txt
if ($LASTEXITCODE) {throw 'Locked Python dependency installation failed; check PyPI access.'}
& $taskNpm ci --prefix dependencies --registry=https://registry.npmjs.org --offline=false --cache "$taskReleaseRoot\.runtime\npm-cache" --omit=optional --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE) {throw 'Locked Canvas installation failed; check npm registry access.'}
Write-Host 'Dependencies installed in this new release directory. Run the environment check before starting.'
