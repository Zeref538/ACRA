# ACRA — one-command local dev startup.
#   .\start-dev.ps1
# Sets up the backend venv + frontend deps if missing, then launches
# FastAPI (port 8000) and the Vite dev server (port 5173) in two windows.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# ── Backend: venv + dependencies ───────────────────────────────────────────────
$venvPython = Join-Path $root "code\.venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "[ACRA] Creating Python venv in code\.venv ..." -ForegroundColor Cyan
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        & py -3.12 -m venv (Join-Path $root "code\.venv")
        if ($LASTEXITCODE -ne 0) { & py -3 -m venv (Join-Path $root "code\.venv") }
    } else {
        & python -m venv (Join-Path $root "code\.venv")
    }
    if (-not (Test-Path $venvPython)) {
        Write-Error "Could not create venv. Install Python 3.12+ and retry."
    }
}

# Install/refresh deps if fastapi is missing
& $venvPython -c "import fastapi" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ACRA] Installing backend dependencies (first run may take several minutes) ..." -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade pip -q
    & $venvPython -m pip install -r (Join-Path $root "code\requirements.txt")
    if ($LASTEXITCODE -ne 0) { Write-Error "pip install failed." }
}

# ── Backend .env ───────────────────────────────────────────────────────────────
$envFile = Join-Path $root "code\.env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $root "code\.env.example") $envFile
    Write-Host "[ACRA] Created code\.env from code\.env.example" -ForegroundColor Yellow
}

# ── Model check ────────────────────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $root "code\acra_medium_v7_best.onnx"))) {
    Write-Host "[ACRA] WARNING: code\acra_medium_v7_best.onnx not found - YOLO segmentation disabled (FCM-only fallback)." -ForegroundColor Yellow
}

# ── Frontend deps ──────────────────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-Host "[ACRA] Installing frontend dependencies ..." -ForegroundColor Cyan
    Push-Location $root
    npm install
    Pop-Location
}

# ── Launch both servers ────────────────────────────────────────────────────────
Write-Host "[ACRA] Starting backend  ->  http://localhost:8000" -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root\code'; & '.\.venv\Scripts\python.exe' -m uvicorn main:app --reload --port 8000"
)

Write-Host "[ACRA] Starting frontend ->  http://localhost:5173" -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root'; npm run dev"
)

Write-Host "[ACRA] Both servers launching in separate windows. Close those windows to stop." -ForegroundColor Green
