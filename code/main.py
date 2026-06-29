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
    cd code
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

# Load .env from this directory or parent
load_dotenv(Path(__file__).parent / ".env")
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
BASE_DIR  = Path(__file__).parent           # code/
STATIC_DIR    = BASE_DIR / "static"
JOBS_DIR      = STATIC_DIR / "jobs"
TEST_RUNS_DIR = STATIC_DIR / "test-runs"
DB_PATH       = BASE_DIR / "jobs.db"

JOBS_DIR.mkdir(parents=True, exist_ok=True)
TEST_RUNS_DIR.mkdir(parents=True, exist_ok=True)

# Add pipeline package to path
sys.path.insert(0, str(BASE_DIR))

from pipeline.segmentation import resolve_seg_model, _load_model as _load_seg_model

SEG_MODEL_PATH: Optional[str] = resolve_seg_model()

# ── Config from environment ────────────────────────────────────────────────────
SKIP_AUTH          = os.getenv("SKIP_AUTH", "true").lower() == "true"
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
BASE_URL           = os.getenv("BASE_URL", "http://localhost:8000")
JOB_EXPIRY_HOURS   = int(os.getenv("JOB_EXPIRY_HOURS", "24"))
PURGE_INTERVAL_S   = int(os.getenv("PURGE_INTERVAL_SECONDS", "3600"))
CORS_ORIGINS       = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://localhost:3000",
    ).split(",")
    if o.strip()
]
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
    _ensure_yolo_loaded()


def _ensure_yolo_loaded() -> bool:
    """Load ONNX YOLO weights on first use (startup or first /process request)."""
    global _yolo_model, _model_loaded, SEG_MODEL_PATH
    if _model_loaded and _yolo_model is not None and SEG_MODEL_PATH:
        return True
    SEG_MODEL_PATH = resolve_seg_model()
    if not SEG_MODEL_PATH:
        print("[ACRA] No YOLO model found — place acra_medium_v7_best.onnx in code/ or set SEG_MODEL_PATH")
        _model_loaded = False
        return False
    try:
        _yolo_model = _load_seg_model(SEG_MODEL_PATH)
        _model_loaded = True
        print(f"[ACRA] Model loaded: {SEG_MODEL_PATH}")
        return True
    except Exception as exc:
        print(f"[ACRA] Warning: could not load model: {exc}")
        _model_loaded = False
        return False


# ── Database ───────────────────────────────────────────────────────────────────
def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
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
                de_improvement      REAL,
                conflict_resolution REAL,
                naturalness         REAL,
                conflicts_found     INTEGER,
                boxes_detected      INTEGER,
                inference_ms        REAL,
                pass_de             INTEGER,
                pass_resolution     INTEGER,
                pass_naturalness    INTEGER
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
async def _purge_loop() -> None:
    import asyncio
    while True:
        try:
            _purge_expired()
        except Exception as exc:
            print(f"[ACRA] Purge error: {exc}")
        await asyncio.sleep(PURGE_INTERVAL_S)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    _migrate_db()
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(_executor, _load_yolo)
    purge_task = asyncio.create_task(_purge_loop())
    yield
    purge_task.cancel()


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="ACRA", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ── Auth ───────────────────────────────────────────────────────────────────────
def _extract_user_id(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()

    if SKIP_AUTH or not SUPABASE_JWT_SECRET:
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
    KNOWN = {"roi-color", "roi-object", "roi-text", "roi-symbol", "exclude-person"}
    canonical = class_name.lower().strip().replace("_", "-").replace(" ", "-")
    if canonical in KNOWN:
        return canonical
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
    if not _ensure_yolo_loaded():
        return []
    try:
        model = _load_seg_model(SEG_MODEL_PATH)
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
    seg_soft:            float = 3.5,
    n_clusters:          Optional[int] = None,
    seg_clusters_per_roi: Optional[int] = None,
) -> tuple[np.ndarray, dict, list]:
    import math
    from pipeline import run_full_pipeline

    seg_ready = use_segmentation and _ensure_yolo_loaded()

    # YOLO and FCM must run on the same pixel grid; scale box coords back for the UI.
    orig_h, orig_w = img_np.shape[:2]
    max_proc = 1_500_000
    n_orig = orig_h * orig_w
    if n_orig > max_proc:
        scale = math.sqrt(max_proc / n_orig)
        proc_w = max(1, int(orig_w * scale))
        proc_h = max(1, int(orig_h * scale))
        seg_img = np.array(
            Image.fromarray(img_np).resize((proc_w, proc_h), Image.Resampling.BOX),
            dtype=np.uint8,
        )
        sx, sy = orig_w / proc_w, orig_h / proc_h
    else:
        seg_img = img_np
        sx = sy = 1.0

    corrected_uint8, raw_metrics = run_full_pipeline(
        img_np,
        severity,
        cvd_type,
        n_clusters=n_clusters,
        use_segmentation=seg_ready,
        seg_model=SEG_MODEL_PATH,
        seg_conf=conf_threshold,
        seg_soft=seg_soft,
        seg_clusters_per_roi=seg_clusters_per_roi,
        max_proc_pixels=max_proc,
    )

    boxes: List[Dict] = []
    if seg_ready:
        for box in _run_yolo_boxes(seg_img, conf_threshold):
            boxes.append({
                **box,
                "x1": int(round(box["x1"] * sx)),
                "y1": int(round(box["y1"] * sy)),
                "x2": int(round(box["x2"] * sx)),
                "y2": int(round(box["y2"] * sy)),
            })

    metrics = {
        "delta_e_improvement":      float(raw_metrics.get("de_improvement", 0.0)),
        "de_before_mean":           float(raw_metrics.get("de_before_mean", 0.0)),
        "de_after_mean":            float(raw_metrics.get("de_after_mean", 0.0)),
        "conflict_resolution_rate": float(raw_metrics.get("conflict_resolution_rate", 0.0)),
        "naturalness_preservation": float(raw_metrics.get("naturalness_preservation", 0.0)),
        "boxes_detected":           len(boxes),
        "conflicts_found":          int(raw_metrics.get("n_conflicts_total", 0)),
        "auto_clusters":            int(raw_metrics.get("auto_clusters", 0)),
        "inference_ms":             float(raw_metrics.get("inference_ms", 0.0)),
        "segmentation_active":      seg_ready,
        "seg_class_names":          raw_metrics.get("seg_class_names"),
        "already_accessible":       bool(raw_metrics.get("already_accessible", False)),
        "pass_de_improvement":      bool(raw_metrics.get("pass_de_improvement", False)),
        "pass_resolution_rate":     bool(raw_metrics.get("pass_resolution_rate", False)),
        "pass_naturalness":         bool(raw_metrics.get("pass_naturalness", False)),
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
        "seg_soft":            row["seg_soft"] if row["seg_soft"] is not None else 3.5,
        "n_clusters":          row["n_clusters"],
        "seg_clusters_per_roi": row["seg_clusters_per_roi"] if row["seg_clusters_per_roi"] is not None else 3,
        "created_at":          row["created_at"],
        "expires_at":          row["expires_at"],
        "original_url":        row["original_url"],
        "corrected_url":       row["corrected_url"],
        "metrics":             json.loads(row["metrics"]),
        "boxes":               json.loads(row["boxes"]),
    }


# ── Upload validation (shared by /process and /test-runs) ─────────────────────
async def _validate_upload(
    image:               UploadFile,
    cvd_type:            str,
    severity:            float,
    conf_threshold:      float,
    seg_soft:            float,
    use_segmentation:    int,
    n_clusters:          Optional[int],
    seg_clusters_per_roi: Optional[int],
    max_dim:             Optional[int] = None,
) -> tuple[np.ndarray, dict]:
    if image.content_type not in ALLOWED_MIMES:
        raise HTTPException(400, detail="Unsupported image format. Accepted: JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC.")

    raw_bytes = await image.read()
    if len(raw_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(400, detail="File size must be under 10 MB.")

    if cvd_type not in ("protan", "deutan"):
        raise HTTPException(400, detail="cvd_type must be 'protan' or 'deutan'.")

    params = {
        "severity":       max(0.0, min(1.0, float(severity))),
        "conf_threshold": max(0.1, min(0.9, float(conf_threshold))),
        "seg_soft":       max(0.0, min(8.0, float(seg_soft))),
        "use_seg_bool":   bool(use_segmentation),
        "n_clusters":     max(2, min(100, int(n_clusters))) if n_clusters is not None else None,
        "seg_clusters_per_roi":
            max(2, min(8, int(seg_clusters_per_roi))) if seg_clusters_per_roi is not None else None,
    }

    try:
        pil_img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        if max_dim is not None and max(pil_img.size) > max_dim:
            pil_img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        img_np = np.array(pil_img, dtype=np.uint8)
    except Exception:
        raise HTTPException(400, detail="Could not decode image file.")

    return img_np, params


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":              "ok",
        "model_loaded":        _model_loaded,
        "model_path":          SEG_MODEL_PATH,
        "segmentation_ready":  bool(SEG_MODEL_PATH and Path(SEG_MODEL_PATH).is_file()),
        "uptime_seconds":      round(time.time() - _startup_time, 1),
    }


@app.post("/process")
async def process_image(
    request:             Request,
    image:               UploadFile    = File(...),
    cvd_type:            str           = Form(...),
    severity:            float         = Form(...),
    conf_threshold:      float         = Form(...),
    use_segmentation:    int           = Form(1),
    seg_soft:            float         = Form(3.5),
    n_clusters:          Optional[int] = Form(None),
    seg_clusters_per_roi: Optional[int] = Form(None),
):
    user_id = _extract_user_id(request)

    img_np, params = await _validate_upload(
        image, cvd_type, severity, conf_threshold, seg_soft,
        use_segmentation, n_clusters, seg_clusters_per_roi,
        max_dim=1920,
    )
    severity             = params["severity"]
    conf_threshold       = params["conf_threshold"]
    seg_soft             = params["seg_soft"]
    use_seg_bool         = params["use_seg_bool"]
    n_clusters           = params["n_clusters"]
    seg_clusters_per_roi = params["seg_clusters_per_roi"]

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

    job_id   = str(uuid.uuid4())
    job_dir  = JOBS_DIR / job_id
    job_dir.mkdir(parents=True)

    orig_path      = job_dir / "original.jpg"
    corrected_path = job_dir / "corrected.jpg"

    await loop.run_in_executor(_executor, _save_image, img_np,          orig_path)
    await loop.run_in_executor(_executor, _save_image, corrected_uint8, corrected_path)

    orig_url      = _url(f"jobs/{job_id}/original.jpg")
    corrected_url = _url(f"jobs/{job_id}/corrected.jpg")

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
                int(use_seg_bool), seg_soft, n_clusters, seg_clusters_per_roi if seg_clusters_per_roi is not None else 0,
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
        "seg_soft":            row["seg_soft"] if row["seg_soft"] is not None else 3.5,
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
    seg_soft:            float         = Form(3.5),
    n_clusters:          Optional[int] = Form(None),
    seg_clusters_per_roi: Optional[int] = Form(None),
):
    user_id = _extract_user_id(request)
    filename = image.filename or "image.jpg"

    img_np, params = await _validate_upload(
        image, cvd_type, severity, conf_threshold, seg_soft,
        use_segmentation, n_clusters, seg_clusters_per_roi,
    )
    severity             = params["severity"]
    conf_threshold       = params["conf_threshold"]
    seg_soft             = params["seg_soft"]
    use_seg_bool         = params["use_seg_bool"]
    n_clusters           = params["n_clusters"]
    seg_clusters_per_roi = params["seg_clusters_per_roi"]

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
                de_improvement, conflict_resolution, naturalness,
                conflicts_found, boxes_detected, inference_ms,
                pass_de, pass_resolution, pass_naturalness
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                run_id, user_id, filename, cvd_type, severity, conf_threshold,
                int(use_seg_bool), seg_soft, n_clusters, seg_clusters_per_roi if seg_clusters_per_roi is not None else 0,
                now.isoformat(), orig_url, corrected_url,
                json.dumps(metrics), json.dumps(boxes),
                de, res, nat,
                int(metrics.get("conflicts_found", 0)),
                int(metrics.get("boxes_detected",  0)),
                float(metrics.get("inference_ms",  0)),
                1 if metrics.get("pass_de_improvement") else 0,
                1 if metrics.get("pass_resolution_rate") else 0,
                1 if metrics.get("pass_naturalness") else 0,
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
