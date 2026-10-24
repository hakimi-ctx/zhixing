$ErrorActionPreference = 'Stop'
$BuildRoot = 'D:\ZhixingBuild'
$AppRoot = Join-Path $BuildRoot 'zhixing'
$Tar = Join-Path $BuildRoot 'zhixing-pack-src.tar.gz'
$Seed = Join-Path $BuildRoot 'seed-config.json'
$SeedInApp = Join-Path $AppRoot 'seed-config.json'
$SeedExample = Join-Path $AppRoot 'seed-config.example.json'
$Log = Join-Path $BuildRoot 'install-log.txt'
function Log($m){ $line = "[{0}] {1}" -f (Get-Date -Format o), $m; Add-Content -Path $Log -Value $line; Write-Host $line }

New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
Log "start"

# Extract if tar present
if (Test-Path $Tar) {
  New-Item -ItemType Directory -Force -Path $AppRoot | Out-Null
  if (Get-Command tar -ErrorAction SilentlyContinue) {
    Log "extracting tar"
    tar -xzf $Tar -C $AppRoot
  } else {
    Log "tar.exe missing"
  }
} else {
  Log "missing tar: $Tar"
}

# Find WorkBuddy
$wb = $null
foreach ($c in @(
  'D:\WorkBuddy\WorkBuddy.exe',
  'D:\WorkBuddy\workbuddy.exe',
  'D:\WorkBuddy\bin\WorkBuddy.exe',
  'D:\WorkBuddy\codebuddy.exe'
)) { if (Test-Path $c) { $wb = $c; break } }
if (-not $wb) {
  $hit = Get-ChildItem -Path 'D:\WorkBuddy' -Recurse -Include WorkBuddy.exe,workbuddy.exe,codebuddy.exe,CodeBuddy.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { $wb = $hit.FullName }
}
Log "WorkBuddy=$wb"

# Find DeepSeek Harness
$ds = $null
foreach ($c in @(
  'E:\DeepSeek\dsh.exe',
  'E:\DeepSeek\deepseek-harness.exe',
  'E:\DeepSeek\DeepSeek Harness.exe',
  'E:\DeepSeek\bin\dsh.exe'
)) { if (Test-Path $c) { $ds = $c; break } }
if (-not $ds) {
  $hit = Get-ChildItem -Path 'E:\DeepSeek' -Recurse -Include dsh.exe,deepseek-harness.exe,'DeepSeek Harness.exe',DeepSeek*.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { $ds = $hit.FullName }
}
Log "DeepSeek=$ds"

# User Zhixing home
$homeDir = Join-Path $env:USERPROFILE 'Zhixing'
$vault = Join-Path $homeDir 'vault'
New-Item -ItemType Directory -Force -Path $homeDir,$vault | Out-Null
$cfgPath = Join-Path $homeDir 'config.json'
if (-not (Test-Path $Seed)) {
  if (Test-Path $SeedInApp) {
    $Seed = $SeedInApp
  } elseif (Test-Path $SeedExample) {
    Copy-Item -Path $SeedExample -Destination $SeedInApp -Force
    $Seed = $SeedInApp
    Log "copied seed-config.example.json -> seed-config.json (fill in your API keys before use)"
  } else {
    throw "missing seed-config.json / seed-config.example.json"
  }
}
$cfg = Get-Content -Raw -Path $Seed | ConvertFrom-Json
$cfg.vaultPath = $vault
if ($wb) {
  foreach ($ex in $cfg.executors) { if ($ex.id -eq 'workbuddy') { $ex.command = $wb; $ex.enabled = $true } }
} else { Log 'WARN WorkBuddy not found' }
if ($ds) {
  foreach ($ex in $cfg.executors) { if ($ex.id -eq 'deepseek-harness') { $ex.command = $ds; $ex.enabled = $true } }
} else { Log 'WARN DeepSeek not found' }
$cfg | ConvertTo-Json -Depth 10 | Set-Content -Path $cfgPath -Encoding UTF8
Log "wrote $cfgPath"

# Desktop shortcut to Start-Zhixing.bat
$bat = Join-Path $AppRoot 'Start-Zhixing.bat'
if (-not (Test-Path $bat)) { $bat = Join-Path $AppRoot 'Start-Zhixing-Browser.bat' }
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '鐭ヨ.lnk'
$w = New-Object -ComObject WScript.Shell
$sc = $w.CreateShortcut($lnkPath)
$sc.TargetPath = $bat
$sc.WorkingDirectory = $AppRoot
$sc.WindowStyle = 1
$sc.Description = '鐭ヨ'
$ico = Join-Path $AppRoot 'build\icon.ico'
if (-not (Test-Path $ico)) { $ico = Join-Path $AppRoot 'desktop\icon.ico' }
if (Test-Path $ico) { $sc.IconLocation = $ico }
$sc.Save()
Log "shortcut $lnkPath -> $bat"

# Ensure Node and install deps (best effort)
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Log "node $($node.Source)"
  Push-Location $AppRoot
  try {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm install }
    elseif (Get-Command corepack -ErrorAction SilentlyContinue) { corepack enable; corepack pnpm install }
    else { npm install -g pnpm; pnpm install }
  } catch { Log "install err $_" }
  Pop-Location
} else {
  Log 'Node.js not found 鈥?user must install Node 20+ or use later exe pack'
}

Log 'done'
Write-Host 'INSTALL_OK'

