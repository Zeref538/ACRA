"""
main.py — ACRA FastAPI Backend
Adaptive Color Re-Encoding System

Endpoints
---------
POST   /process               Upload image → run CVD pipeline → return job
GET    /jobs                  List all active jobs for authenticated user
GET    /jobs/{job_id}         Full job detail with metrics + boxes
DELETE /jobs/{job_id}         Delete job and its images
GET    /health                Server / model health check

POST   /test-runs             Run pipeline, store result permanently (no expiry)
GET    /test-runs             List all test runs for user
GET    /test-runs/analytics   Aggregate stats + per-metric distributions
DELETE /test-runs/{run_id}    Delete one test run
DELETE /test-runs             Clear all test runs for user

Run locally:
    cd backend/code
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import time
import uuid
import shutil
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from PIL import Image
from dotenv import load_dotenv

# Load .env from backend/ (one level up from backend/code/)
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR  = Path(__file__).parent           # backend/code/
PROJ_DIR  = BASE_DIR.parent                 # backend/
ONNX_PATH = str(PROJ_DIR / "acra_medium_v7_best.onnx")
STATIC_DIR    = BASE_DIR / "static"
JOBS_DIR      = STATIC_DIR / "jobs"
TEST_RUNS_DIR = STATIC_DIR / "test-runs"
DB_PATH       = BASE_DIR / "jobs.db"

JOBS_DIR.mkdir(parents=True, exist_ok=True)
TEST_RUNS_DIR.mkdir(parents=True, exist_ok=True)

# Add pipeline package to path
sys.path.insert(0, str(BASE_DIR))

# ── Config from environment ────────────────────────────────────────────────────
SKIP_AUTH          = os.getenv("SKIP_AUTH", "true").lower() == "true"
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
BASE_URL           = os.getenv("BASE_URL", "http://localhost:8000")
JOB_EXPIRY_HOURS   = int(os.getenv("JOB_EXPIRY_HOURS", "24"))
MAX_IMAGE_BYTES    = 10 * 1024 * 1024   # 10 MB
ALLOWED_MIMES      = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "image/bmp", "image/tiff", "image/avif", "image/heic", "image/heif",
}

# ── Thread pool for blocking pipeline work ─────────────────────────────────────
_executor = ThreadPoolExecutor(max_workers=2)

# ── YOLO model cache ───────────────────────────────────────────────────────────
_yolo_model     = None
_model_loaded   = False
_startup_time   = time.time()


def _load_yolo() -> None:
    global _yolo_model, _model_loaded
    try:
        from pipeline.segmentation import _load_model
        _yolo_model   = _load_model(ONNX_PATH)  # primes the shared cache
        _model_loaded = True
        print(f"[ACRA] Model loaded: {ONNX_PATH}")
    except Exception as exc:
        print(f"[ACRA] Warning: could not load model: {exc}")
        _model_loaded = False
        _model_loaded = False


# ── Database ───────────────────────────────────────────────────────────────────
def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                job_id              TEXT PRIMARY KEY,
                user_id             TEXT NOT NULL,
                cvd_type            TEXT NOT NULL,
                severity            REAL NOT NULL,
                conf_threshold      REAL NOT NULL,
                use_segmentation    INTEGER NOT NULL DEFAULT 1,
                seg_soft            REAL NOT NULL DEFAULT 3.0,
                n_clusters          INTEGER,
                seg_clusters_per_roi INTEGER NOT NULL DEFAULT 3,
                created_at          TEXT NOT NULL,
                expires_at          TEXT NOT NULL,
                original_url        TEXT NOT NULL,
                corrected_url       TEXT NOT NULL,
                metrics             TEXT NOT NULL,
                boxes               TEXT NOT NULL
            )
        """)
        # Permanent diagnostic store — no expiry, denormalised metric columns
        # for fast aggregate queries without JSON parsing in SQLite.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS test_runs (
                run_id               TEXT PRIMARY KEY,
                user_id              TEXT NOT NULL,
                filename             TEXT NOT NULL,
                cvd_type             TEXT NOT NULL,
                severity             REAL NOT NULL,
                conf_threshold       REAL NOT NULL,
                use_segmentation     INTEGER NOT NULL DEFAULT 1,
                seg_soft             REAL NOT NULL DEFAULT 3.0,
                n_clusters           INTEGER,
                seg_clusters_per_roi INTEGER NOT NULL DEFAULT 3,
                created_at           TEXT NOT NULL,
                original_url         TEXT NOT NULL,
                corrected_url        TEXT NOT NULL,
                metrics              TEXT NOT NULL,
                boxes                TEXT NOT NULL,
                -- Denormalised for GROUP BY / AVG queries
                de_improvement      REAL,
                conflict_resolution REAL,
                naturalness         REAL,
                wcag_contrast       REAL,
                conflicts_found     INTEGER,
                boxes_detected      INTEGER,
                inference_ms        REAL,
                -- 1 = pass, 0 = fail
                pass_de             INTEGER,
                pass_resolution     INTEGER,
                pass_naturalness    INTEGER,
                pass_wcag           INTEGER
            )
        """)
        conn.commit()


def _migrate_db() -> None:
    """Add columns introduced after initial schema creation (idempotent)."""
    new_cols = [
        ("jobs",      "use_segmentation",     "INTEGER NOT NULL DEFAULT 1"),
        ("jobs",      "seg_soft",             "REAL NOT NULL DEFAULT 3.0"),
        ("jobs",      "n_clusters",           "INTEGER"),
        ("jobs",      "seg_clusters_per_roi", "INTEGER NOT NULL DEFAULT 3"),
        ("test_runs", "use_segmentation",     "INTEGER NOT NULL DEFAULT 1"),
        ("test_runs", "seg_soft",             "REAL NOT NULL DEFAULT 3.0"),
        ("test_runs", "n_clusters",           "INTEGER"),
        ("test_runs", "seg_clusters_per_roi", "INTEGER NOT NULL DEFAULT 3"),
    ]
    with _get_db() as conn:
        for table, col, definition in new_cols:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {definition}")
            except Exception:
                pass  # column already exists
        conn.commit()


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    _migrate_db()
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(_executor, _load_yolo)
    yield


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="ACRA", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving for stored images
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ── Auth ───────────────────────────────────────────────────────────────────────
def _extract_user_id(request: Request) -> str:
    """
    Extract user ID from Bearer token.
    In local/skip-auth mode, accept any token and use a fixed dev user.
    In production, verify Supabase JWT.
    """
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()

    if SKIP_AUTH or not SUPABASE_JWT_SECRET:
        # Local dev: derive a stable user_id from the token so sessions persist
        if token.startswith("mock-token-"):
            return "local-dev-user"
        if token:
            return f"local-{token[:12]}"
        return "local-dev-user"

    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    try:
        import jwt as pyjwt
        payload = pyjwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        return payload.get("sub", "unknown")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ── Class name → frontend ROI class mapping ────────────────────────────────────
def _map_class(class_name: str) -> str:
    """
    Normalise raw YOLO class names to the five frontend display classes.
    acra_medium_v7_best.onnx is trained with these exact names, so the
    primary lookup is an identity pass-through with underscore/space cleanup.
    The keyword fallback handles any future model that uses different names.
    """
    KNOWN = {"roi-color", "roi-object", "roi-text", "roi-symbol", "exclude-person"}
    canonical = class_name.lower().strip().replace("_", "-").replace(" ", "-")
    if canonical in KNOWN:
        return canonical
    # Keyword fallback for non-standard model class names
    name = class_name.lower()
    if any(k in name for k in ("person", "human", "face", "people")):
        return "exclude-person"
    if any(k in name for k in ("symbol", "icon", "logo", "mark", "check", "sign")):
        return "roi-symbol"
    if any(k in name for k in ("color", "colour", "swatch", "palette")):
        return "roi-color"
    if any(k in name for k in ("text", "word", "letter", "label")):
        return "roi-text"
    return "roi-object"


# ── YOLO inference for bounding boxes ─────────────────────────────────────────
def _run_yolo_boxes(img_np: np.ndarray, conf_threshold: float) -> List[Dict]:
    """Run YOLO on the image and return frontend-format bounding box list."""
    try:
        from pipeline.segmentation import _load_model
        model = _load_model(ONNX_PATH)
    except Exception:
        if _yolo_model is None:
            return []
        model = _yolo_model
    try:
        results = model(img_np, conf=conf_threshold, iou=0.45, imgsz=640, verbose=False)
        boxes: List[Dict] = []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int).tolist()
                conf  = float(box.conf[0].cpu().numpy())
                cls   = int(box.cls[0].cpu().numpy())
                cname = r.names.get(cls, f"class_{cls}")
                boxes.append({
                    "x1":   x1,
                    "y1":   y1,
                    "x2":   x2,
                    "y2":   y2,
                    "class": _map_class(cname),
                    "conf": round(conf, 4),
                })
        return boxes
    except Exception as exc:
        print(f"[ACRA] YOLO box inference error: {exc}")
        return []


# ── Pipeline runner (blocking — called from thread pool) ───────────────────────
def _run_pipeline_sync(
    img_np:              np.ndarray,
    cvd_type:            str,
    severity:            float,
    conf_threshold:      float,
    use_segmentation:    bool  = True,
    seg_soft:            float = 3.0,
    n_clusters:          Optional[int] = None,
    seg_clusters_per_roi: int  = 3,
) -> tuple[np.ndarray, dict, list]:
    """
    Run full CVD re-encoding pipeline + YOLO box detection.
    Returns (corrected_uint8, metrics_dict, boxes_list).
    """
    from pipeline import run_full_pipeline

    # Only use YOLO segmentation if the model is loaded AND the caller wants it
    use_seg = use_segmentation and _model_loaded and Path(ONNX_PATH).exists()

    corrected_uint8, raw_metrics = run_full_pipeline(
        img_np,
        severity,
        cvd_type,
        n_clusters=n_clusters,
        use_segmentation=use_seg,
        seg_model=ONNX_PATH,
        seg_conf=conf_threshold,
        seg_soft=seg_soft,
        seg_clusters_per_roi=seg_clusters_per_roi,
        max_proc_pixels=650_000,
    )

    boxes = _run_yolo_boxes(img_np, conf_threshold) if use_seg else []

    # Map internal metric keys → frontend keys
    metrics = {
        "delta_e_improvement":      float(raw_metrics.get("de_improvement", 0.0)),
        "conflict_resolution_rate": float(raw_metrics.get("conflict_resolution_rate", 0.0)),
        "naturalness_preservation": float(raw_metrics.get("naturalness_preservation", 0.0)),
        "boxes_detected":           len(boxes),
        "conflicts_found":          int(raw_metrics.get("n_conflicts_total", 0)),
        "auto_clusters":            int(raw_metrics.get("auto_clusters", 0)),
        "inference_ms":             float(raw_metrics.get("inference_ms", 0.0)),
    }

    return corrected_uint8, metrics, boxes


# ── Image save helpers ─────────────────────────────────────────────────────────
def _save_image(img_np: np.ndarray, path: Path) -> None:
    Image.fromarray(img_np).save(str(path), format="JPEG", quality=92)


def _url(rel_path: str) -> str:
    return f"{BASE_URL}/static/{rel_path}"


def _job_to_response(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "job_id":              row["job_id"],
        "cvd_type":            row["cvd_type"],
        "severity":            row["severity"],
        "conf_threshold":      row["conf_threshold"],
        "use_segmentation":    bool(row["use_segmentation"]) if row["use_segmentation"] is not None else True,
        "seg_soft":            row["seg_soft"] if row["seg_soft"] is not None else 3.0,
        "n_clusters":          row["n_clusters"],
        "seg_clusters_per_roi": row["seg_clusters_per_roi"] if row["seg_clusters_per_roi"] is not None else 3,
        "created_at":          row["created_at"],
        "expires_at":          row["expires_at"],
        "original_url":        row["original_url"],
        "corrected_url":       row["corrected_url"],
        "metrics":             json.loads(row["metrics"]),
        "boxes":               json.loads(row["boxes"]),
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":         "ok",
        "model_loaded":   _model_loaded,
        "uptime_seconds": round(time.time() - _startup_time, 1),
    }


@app.post("/process")
async def process_image(
    request:             Request,
    image:               UploadFile    = File(...),
    cvd_type:            str           = Form(...),
    severity:            float         = Form(...),
    conf_threshold:      float         = Form(...),
    use_segmentation:    int           = Form(1),    # 1 = yes, 0 = FCM-only
    seg_soft:            float         = Form(2.5),  # mask edge softness 0–8
    n_clusters:          Optional[int] = Form(None), # None = auto-detect
    seg_clusters_per_roi: int          = Form(3),
):
    user_id = _extract_user_id(request)

    # ── Validate ────────────────────────────────────────────────────────────
    if image.content_type not in ALLOWED_MIMES:
        raise HTTPException(400, detail="Unsupported image format. Accepted: JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC.")

    raw_bytes = await image.read()
    if len(raw_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(400, detail="File size must be under 10 MB.")

    if cvd_type not in ("protan", "deutan"):
        raise HTTPException(400, detail="cvd_type must be 'protan' or 'deutan'.")

    severity             = max(0.0, min(1.0, float(severity)))
    conf_threshold       = max(0.1,  min(0.9, float(conf_threshold)))
    seg_soft             = max(0.0,  min(8.0, float(seg_soft)))
    seg_clusters_per_roi = max(2,    min(8,   int(seg_clusters_per_roi)))
    use_seg_bool         = bool(use_segmentation)
    if n_clusters is not None:
        n_clusters = max(2, min(100, int(n_clusters)))

    # ── Decode image ────────────────────────────────────────────────────────
    try:
        pil_img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        # Downsample large images — FCM/CIELAB cost scales with pixel count
        MAX_DIM = 1920
        if max(pil_img.size) > MAX_DIM:
            pil_img.thumbnail((MAX_DIM, MAX_DIM), Image.Resampling.LANCZOS)
        img_np  = np.array(pil_img, dtype=np.uint8)
    except Exception:
        raise HTTPException(400, detail="Could not decode image file.")

    # ── Run pipeline in thread pool ─────────────────────────────────────────
    import asyncio
    from functools import partial
    t0 = time.time()
    loop = asyncio.get_event_loop()
    try:
        corrected_uint8, metrics, boxes = await loop.run_in_executor(
            _executor,
            partial(
                _run_pipeline_sync,
                img_np, cvd_type, severity, conf_threshold,
                use_seg_bool, seg_soft, n_clusters, seg_clusters_per_roi,
            ),
        )
    except Exception as exc:
        raise HTTPException(500, detail=f"Pipeline error: {exc}")

    inference_ms = (time.time() - t0) * 1000
    metrics["inference_ms"] = round(inference_ms, 1)

    # ── Persist images ──────────────────────────────────────────────────────
    job_id   = str(uuid.uuid4())
    job_dir  = JOBS_DIR / job_id
    job_dir.mkdir(parents=True)

    orig_path      = job_dir / "original.jpg"
    corrected_path = job_dir / "corrected.jpg"

    await loop.run_in_executor(_executor, _save_image, img_np,          orig_path)
    await loop.run_in_executor(_executor, _save_image, corrected_uint8, corrected_path)

    orig_url      = _url(f"jobs/{job_id}/original.jpg")
    corrected_url = _url(f"jobs/{job_id}/corrected.jpg")

    # ── Persist job metadata ────────────────────────────────────────────────
    now        = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=JOB_EXPIRY_HOURS)

    with _get_db() as conn:
        conn.execute(
            """
            INSERT INTO jobs
              (job_id, user_id, cvd_type, severity, conf_threshold,
               use_segmentation, seg_soft, n_clusters, seg_clusters_per_roi,
               created_at, expires_at, original_url, corrected_url, metrics, boxes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id, user_id, cvd_type, severity, conf_threshold,
                int(use_seg_bool), seg_soft, n_clusters, seg_clusters_per_roi,
                now.isoformat(), expires_at.isoformat(),
                orig_url, corrected_url,
                json.dumps(metrics), json.dumps(boxes),
            ),
        )
        conn.commit()

    return {
        "job_id":              job_id,
        "cvd_type":            cvd_type,
        "severity":            severity,
        "conf_threshold":      conf_threshold,
        "use_segmentation":    use_seg_bool,
        "seg_soft":            seg_soft,
        "n_clusters":          n_clusters,
        "seg_clusters_per_roi": seg_clusters_per_roi,
        "created_at":          now.isoformat(),
        "expires_at":          expires_at.isoformat(),
        "original_url":        orig_url,
        "corrected_url":       corrected_url,
        "metrics":             metrics,
        "boxes":               boxes,
    }


@app.get("/jobs")
def list_jobs(request: Request):
    user_id = _extract_user_id(request)
    _purge_expired()
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [_job_to_response(r) for r in rows]


@app.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request):
    user_id = _extract_user_id(request)
    with _get_db() as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE job_id = ? AND user_id = ?",
            (job_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(404, detail="Job not found or has expired.")
    return _job_to_response(row)


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str, request: Request):
    user_id = _extract_user_id(request)
    with _get_db() as conn:
        row = conn.execute(
            "SELECT job_id FROM jobs WHERE job_id = ? AND user_id = ?",
            (job_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Job not found.")
        conn.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
        conn.commit()

    job_dir = JOBS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)

    return {"deleted": job_id}


# ── Test-runs helpers ──────────────────────────────────────────────────────────
def _run_to_response(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "run_id":              row["run_id"],
        "filename":            row["filename"],
        "cvd_type":            row["cvd_type"],
        "severity":            row["severity"],
        "conf_threshold":      row["conf_threshold"],
        "use_segmentation":    bool(row["use_segmentation"]) if row["use_segmentation"] is not None else True,
        "seg_soft":            row["seg_soft"] if row["seg_soft"] is not None else 3.0,
        "n_clusters":          row["n_clusters"],
        "seg_clusters_per_roi": row["seg_clusters_per_roi"] if row["seg_clusters_per_roi"] is not None else 3,
        "created_at":          row["created_at"],
        "original_url":        row["original_url"],
        "corrected_url":       row["corrected_url"],
        "metrics":             json.loads(row["metrics"]),
        "boxes":               json.loads(row["boxes"]),
    }


def _safe(val, default=0.0):
    return val if val is not None else default


# ── Test-runs routes ───────────────────────────────────────────────────────────

@app.post("/test-runs")
async def create_test_run(
    request:             Request,
    image:               UploadFile    = File(...),
    cvd_type:            str           = Form(...),
    severity:            float         = Form(...),
    conf_threshold:      float         = Form(...),
    use_segmentation:    int           = Form(1),
    seg_soft:            float         = Form(3.0),
    n_clusters:          Optional[int] = Form(None),
    seg_clusters_per_roi: int          = Form(3),
):
    """Process an image and store result permanently for diagnostic analysis."""
    user_id = _extract_user_id(request)

    if image.content_type not in ALLOWED_MIMES:
        raise HTTPException(400, detail="Unsupported image format. Accepted: JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC.")

    raw_bytes = await image.read()
    if len(raw_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(400, detail="File size must be under 10 MB.")

    if cvd_type not in ("protan", "deutan"):
        raise HTTPException(400, detail="cvd_type must be 'protan' or 'deutan'.")

    severity             = max(0.0, min(1.0, float(severity)))
    conf_threshold       = max(0.1,  min(0.9, float(conf_threshold)))
    seg_soft             = max(0.0,  min(8.0, float(seg_soft)))
    seg_clusters_per_roi = max(2,    min(8,   int(seg_clusters_per_roi)))
    use_seg_bool         = bool(use_segmentation)
    if n_clusters is not None:
        n_clusters = max(2, min(100, int(n_clusters)))

    filename = image.filename or "image.jpg"

    try:
        pil_img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        img_np  = np.array(pil_img, dtype=np.uint8)
    except Exception:
        raise HTTPException(400, detail="Could not decode image file.")

    import asyncio
    from functools import partial
    t0   = time.time()
    loop = asyncio.get_event_loop()
    try:
        corrected_uint8, metrics, boxes = await loop.run_in_executor(
            _executor,
            partial(
                _run_pipeline_sync,
                img_np, cvd_type, severity, conf_threshold,
                use_seg_bool, seg_soft, n_clusters, seg_clusters_per_roi,
            ),
        )
    except Exception as exc:
        raise HTTPException(500, detail=f"Pipeline error: {exc}")

    metrics["inference_ms"] = round((time.time() - t0) * 1000, 1)

    run_id  = str(uuid.uuid4())
    run_dir = TEST_RUNS_DIR / run_id
    run_dir.mkdir(parents=True)

    await loop.run_in_executor(_executor, _save_image, img_np,          run_dir / "original.jpg")
    await loop.run_in_executor(_executor, _save_image, corrected_uint8, run_dir / "corrected.jpg")

    orig_url      = _url(f"test-runs/{run_id}/original.jpg")
    corrected_url = _url(f"test-runs/{run_id}/corrected.jpg")
    now           = datetime.now(timezone.utc)

    de   = _safe(metrics.get("delta_e_improvement"))
    res  = _safe(metrics.get("conflict_resolution_rate"))
    nat  = _safe(metrics.get("naturalness_preservation"))

    with _get_db() as conn:
        conn.execute(
            """
            INSERT INTO test_runs (
                run_id, user_id, filename, cvd_type, severity, conf_threshold,
                use_segmentation, seg_soft, n_clusters, seg_clusters_per_roi,
                created_at, original_url, corrected_url, metrics, boxes,
                de_improvement, conflict_resolution, naturalness, wcag_contrast,
                conflicts_found, boxes_detected, inference_ms,
                pass_de, pass_resolution, pass_naturalness, pass_wcag
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                run_id, user_id, filename, cvd_type, severity, conf_threshold,
                int(use_seg_bool), seg_soft, n_clusters, seg_clusters_per_roi,
                now.isoformat(), orig_url, corrected_url,
                json.dumps(metrics), json.dumps(boxes),
                de, res, nat, None,
                int(metrics.get("conflicts_found", 0)),
                int(metrics.get("boxes_detected",  0)),
                float(metrics.get("inference_ms",  0)),
                1 if de  > 15   else 0,
                1 if res > 0.80 else 0,
                1 if nat < 12   else 0,
                0,
            ),
        )
        conn.commit()

    return {
        "run_id":              run_id,
        "filename":            filename,
        "cvd_type":            cvd_type,
        "severity":            severity,
        "conf_threshold":      conf_threshold,
        "use_segmentation":    use_seg_bool,
        "seg_soft":            seg_soft,
        "n_clusters":          n_clusters,
        "seg_clusters_per_roi": seg_clusters_per_roi,
        "created_at":          now.isoformat(),
        "original_url":        orig_url,
        "corrected_url":       corrected_url,
        "metrics":             metrics,
        "boxes":               boxes,
    }


@app.get("/test-runs/analytics")
def test_analytics(request: Request):
    """Aggregate statistics across all test runs for the authenticated user."""
    user_id = _extract_user_id(request)
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM test_runs WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()

    if not rows:
        return {"total": 0, "runs": []}

    total = len(rows)

    def col(name):
        return [row[name] for row in rows if row[name] is not None]

    def avg(vals):  return sum(vals) / len(vals) if vals else 0.0
    def mn(vals):   return min(vals) if vals else 0.0
    def mx(vals):   return max(vals) if vals else 0.0
    def prate(name): return sum(1 for r in rows if r[name] == 1) / total

    de_vals  = col("de_improvement")
    res_vals = col("conflict_resolution")
    nat_vals = col("naturalness")

    return {
        "total": total,
        "averages": {
            "de_improvement":      round(avg(de_vals),  2),
            "conflict_resolution": round(avg(res_vals), 4),
            "naturalness":         round(avg(nat_vals), 2),
        },
        "minimums": {
            "de_improvement":      round(mn(de_vals),  2),
            "conflict_resolution": round(mn(res_vals), 4),
            "naturalness":         round(mn(nat_vals), 2),
        },
        "maximums": {
            "de_improvement":      round(mx(de_vals),  2),
            "conflict_resolution": round(mx(res_vals), 4),
            "naturalness":         round(mx(nat_vals), 2),
        },
        "pass_rates": {
            "de_improvement":      round(prate("pass_de"),         4),
            "conflict_resolution": round(prate("pass_resolution"), 4),
            "naturalness":         round(prate("pass_naturalness"), 4),
        },
        "targets": {
            "de_improvement":      15.0,
            "conflict_resolution": 0.80,
            "naturalness":         12.0,
        },
        # Per-run rows for the frontend table (newest first)
        "runs": [_run_to_response(r) for r in rows],
    }


@app.get("/test-runs")
def list_test_runs(request: Request):
    user_id = _extract_user_id(request)
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM test_runs WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [_run_to_response(r) for r in rows]


@app.delete("/test-runs/{run_id}")
def delete_test_run(run_id: str, request: Request):
    user_id = _extract_user_id(request)
    with _get_db() as conn:
        row = conn.execute(
            "SELECT run_id FROM test_runs WHERE run_id = ? AND user_id = ?",
            (run_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Test run not found.")
        conn.execute("DELETE FROM test_runs WHERE run_id = ?", (run_id,))
        conn.commit()
    run_dir = TEST_RUNS_DIR / run_id
    if run_dir.exists():
        shutil.rmtree(run_dir, ignore_errors=True)
    return {"deleted": run_id}


@app.delete("/test-runs")
def clear_test_runs(request: Request):
    """Delete all test runs for the current user."""
    user_id = _extract_user_id(request)
    with _get_db() as conn:
        runs = conn.execute(
            "SELECT run_id FROM test_runs WHERE user_id = ?", (user_id,)
        ).fetchall()
        for r in runs:
            d = TEST_RUNS_DIR / r["run_id"]
            if d.exists():
                shutil.rmtree(d, ignore_errors=True)
        conn.execute("DELETE FROM test_runs WHERE user_id = ?", (user_id,))
        conn.commit()
    return {"cleared": len(runs)}


# ── Expiry cleanup ─────────────────────────────────────────────────────────────
def _purge_expired() -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _get_db() as conn:
        expired = conn.execute(
            "SELECT job_id FROM jobs WHERE expires_at < ?", (now,)
        ).fetchall()
        for row in expired:
            job_dir = JOBS_DIR / row["job_id"]
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
        conn.execute("DELETE FROM jobs WHERE expires_at < ?", (now,))
        conn.commit()
