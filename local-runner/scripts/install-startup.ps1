param(
  [string]$ExePath = "$PSScriptRoot\..\dist\mt5-local-runner.exe"
)

$ErrorActionPreference = "Stop"
$ResolvedExe = Resolve-Path $ExePath
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "MT5 Local Runner.lnk"

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ResolvedExe.Path
$Shortcut.WorkingDirectory = Split-Path $ResolvedExe.Path
$Shortcut.WindowStyle = 7
$Shortcut.Description = "MT5 AI Builder local companion"
$Shortcut.Save()

Write-Host "Installed startup shortcut:"
Write-Host $ShortcutPath
