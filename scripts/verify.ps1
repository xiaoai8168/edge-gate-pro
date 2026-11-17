$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { $NodeExe = "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $NodeExe)) { throw "Node.js 22+ is required" }
Push-Location $Root
try {
  $PythonExe = Join-Path $Root ".venv\Scripts\python.exe"
  if (Test-Path $PythonExe) {
    & $PythonExe -m pytest -q
    & (Join-Path $Root ".venv\Scripts\ruff.exe") check .
  } else {
    $PythonExe = "python"
    & $PythonExe -m pytest -q
    & $PythonExe -m ruff check .
  }
  & $NodeExe --test workers/checker-gate/test/gate.test.js scripts/test/github-secrets.test.mjs
  & $PythonExe scripts/diagnose.py
} finally {
  Pop-Location
}
