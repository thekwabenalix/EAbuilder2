param(
  [string]$OutputDir = "$PSScriptRoot\..\dist"
)

$ErrorActionPreference = "Stop"
$RunnerRoot = Resolve-Path "$PSScriptRoot\.."
$OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)

Push-Location $RunnerRoot
try {
  if (!(Test-Path ".\node_modules\.bin\pkg.cmd")) {
    npm install
  }

  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  npx pkg .\server.mjs --targets node20-win-x64 --output (Join-Path $OutputDir "mt5-local-runner.exe")

  Write-Host "Built MT5 Local Runner:"
  Write-Host (Join-Path $OutputDir "mt5-local-runner.exe")
} finally {
  Pop-Location
}
