# MT5 Local Runner

Windows companion service for MT5 AI Builder.

It runs on `http://127.0.0.1:8765`, discovers MetaTrader 5, compiles generated
MQL5 files with MetaEditor, and launches Strategy Tester jobs.

## Development

```powershell
node server.mjs
```

## Portable Windows Build

```powershell
.\scripts\build-runner.ps1
```

The portable executable is written to:

```text
local-runner\dist\mt5-local-runner.exe
```

## Auto Start

After building the executable:

```powershell
.\scripts\install-startup.ps1
```

Remove the startup shortcut:

```powershell
.\scripts\uninstall-startup.ps1
```

## Connection Token

The runner creates a per-machine token in:

```text
%LOCALAPPDATA%\MT5 AI Builder\Local Runner\config.json
```

Open `http://127.0.0.1:8765` on the same PC to copy the token into the web app
connection wizard.
