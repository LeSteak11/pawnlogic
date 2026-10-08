param(
  [string]$Version = '',
  [string]$IsccPath = '',
  [switch]$SkipInstaller,
  [switch]$Install
)
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $releaseRoot
if (!$Version) { $Version = (Get-Content -LiteralPath (Join-Path $releaseRoot 'VERSION') -Raw).Trim() }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a MAJOR.MINOR.PATCH version.' }
if ($Install -and $SkipInstaller) { throw '-Install requires an installer build.' }
$python = Join-Path $releaseRoot '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $python)) { throw 'Create .venv and install requirements.txt first.' }
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}
Invoke-Checked $python @('-m','pip','install','-r','requirements-build.txt')
Invoke-Checked $python @('-m','compileall','-q','app','run.py')
foreach ($script in @('app/static/app.js','extension/content.js','extension/background.js')) {
  Invoke-Checked 'node' @('--check', $script)
}
Invoke-Checked $python @('-m','unittest','discover','-s','tests','-v')
Invoke-Checked 'node' @('tests/extension-sync.test.js')
Invoke-Checked 'node' @('tests/player-color.test.js')
Invoke-Checked $python @('scripts/prepare-release.py','--version',$Version)
Invoke-Checked $python @('-m','PyInstaller','--noconfirm','packaging/chesslab.spec')
if (!$SkipInstaller) {
  if (!$IsccPath) {
    $candidates = @((Join-Path $releaseRoot '.tools\Inno Setup\ISCC.exe'),
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 7\ISCC.exe")
    $IsccPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  }
  if (!$IsccPath) { throw 'Install Inno Setup or pass -IsccPath. EXE and extension ZIP have been built.' }
  Invoke-Checked $IsccPath @("/DAppVersion=$Version", "/DLegacyRoot=$releaseRoot", 'packaging/chesslab.iss')
}
$artifacts = Get-ChildItem -LiteralPath (Join-Path $releaseRoot 'dist') -File | Where-Object { $_.Name -match [regex]::Escape($Version) -and $_.Extension -in @('.exe','.zip') }
$checksumLines = $artifacts | ForEach-Object { $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256; "$($hash.Hash.ToLower())  $($_.Name)" }
$checksumLines | Set-Content -LiteralPath (Join-Path $releaseRoot "dist\SHA256SUMS-$Version.txt")
if ($Install) {
  $installer = Join-Path $releaseRoot "dist\ChessLab-Setup-$Version.exe"
  $setupProcess = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -WindowStyle Hidden -Wait -PassThru
  if ($setupProcess.ExitCode -ne 0) { throw "Installer failed: $($setupProcess.ExitCode)" }
}
Write-Output "Release $Version built in $releaseRoot\dist"
