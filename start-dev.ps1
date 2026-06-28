# ACRA — one-command local dev startup.
#   .\start-dev.ps1
# Sets up the backend venv + frontend deps if missing, then launches
# FastAPI (port 8000) and the Vite dev server (port 5173) in two windows.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Backend: venv + dependencies
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
        Write-Error "Could not create venv. Install Python 3.11+ and retry."
    }
}

& $venvPython -c "import fastapi" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ACRA] Installing backend dependencies (first run may take several minutes) ..." -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade pip -q
    & $venvPython -m pip install -r (Join-Path $root "code\requirements.txt")
    if ($LASTEXITCODE -ne 0) { Write-Error "pip install failed." }
}

# Frontend .env
$frontendEnv = Join-Path $root ".env.local"
if (-not (Test-Path $frontendEnv)) {
    @(
        "VITE_API_URL=http://localhost:8000"
        "VITE_SUPABASE_URL="
        "VITE_SUPABASE_ANON_KEY="
    ) | Set-Content -Path $frontendEnv -Encoding utf8
    Write-Host "[ACRA] Created .env.local with VITE_API_URL=http://localhost:8000" -ForegroundColor Yellow
}

# Backend .env
$envFile = Join-Path $root "code\.env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $root "code\.env.example") $envFile
    Write-Host "[ACRA] Created code\.env from code\.env.example" -ForegroundColor Yellow
}

# Model check
if (-not (Test-Path (Join-Path $root "code\acra_medium_v7_best.onnx")) -and
    -not (Test-Path (Join-Path $root "code\best.pt"))) {
    Write-Host "[ACRA] WARNING: No YOLO model in code\ — place acra_medium_v7_best.onnx (FCM-only fallback)." -ForegroundColor Yellow
}

# Frontend deps
if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-Host "[ACRA] Installing frontend dependencies ..." -ForegroundColor Cyan
    Push-Location $root
    npm install
    Pop-Location
}

# Launch both servers
$backendUrl = "http://127.0.0.1:8000"

function Test-AcraBackend($Url) {
    try {
        $r = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 4
        return ($r.status -eq "ok")
    } catch {
        return $false
    }
}

function Get-PortOwner($Port) {
    $line = netstat -ano | Select-String ":$Port\s" | Select-String "LISTENING" | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -replace '\s+', ' ').ToString().Trim().Split(' ')[-1]
}

if (Test-AcraBackend $backendUrl) {
    Write-Host "[ACRA] Backend already healthy at $backendUrl" -ForegroundColor Green
} else {
    $pidOnPort = Get-PortOwner 8000
    if ($pidOnPort) {
        Write-Host "[ACRA] Port 8000 is taken (PID $pidOnPort) but /health did not respond." -ForegroundColor Red
        Write-Host "[ACRA] Kill the stale process, then rerun start-dev.ps1:" -ForegroundColor Yellow
        Write-Host "       taskkill /PID $pidOnPort /F" -ForegroundColor Yellow
    } else {
        Write-Host "[ACRA] Starting backend  ->  $backendUrl" -ForegroundColor Green
        Start-Process powershell -ArgumentList @(
            "-NoExit", "-Command",
            "Set-Location '$root\code'; & '.\.venv\Scripts\python.exe' -m uvicorn main:app --reload --port 8000"
        )
        Start-Sleep -Seconds 3
        if (Test-AcraBackend $backendUrl) {
            Write-Host "[ACRA] Backend health check passed." -ForegroundColor Green
        } else {
            Write-Host "[ACRA] Backend started but /health not ready yet — check the backend window for errors." -ForegroundColor Yellow
        }
    }
}

Write-Host "[ACRA] Starting frontend ->  http://localhost:5173" -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root'; npm run dev"
)

Write-Host "[ACRA] Both servers launching in separate windows. Close those windows to stop." -ForegroundColor Green
