$ErrorActionPreference = "Stop"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "MT5 Local Runner.lnk"

if (Test-Path $ShortcutPath) {
  Remove-Item -LiteralPath $ShortcutPath
  Write-Host "Removed startup shortcut:"
  Write-Host $ShortcutPath
} else {
  Write-Host "No MT5 Local Runner startup shortcut was found."
}
