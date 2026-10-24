param(
  [Parameter(Mandatory = $true)]
  [string]$Exe
)

$target = (Resolve-Path -LiteralPath $Exe).Path
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '知行.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = Split-Path -Parent $target
$shortcut.WindowStyle = 1
$shortcut.Description = '知行'
$shortcut.IconLocation = "$target,0"
$shortcut.Save()
Write-Output "已创建桌面快捷方式：$shortcutPath"
