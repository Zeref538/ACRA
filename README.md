# ACRA — Adaptive Color Re-Encoding System

Color accessibility tool that re-encodes images so color-blind (CVD) users can distinguish colors that would otherwise look identical to them.

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Python](https://www.python.org/) 3.11+
- A [Supabase](https://supabase.com/) project (optional — app works in mock mode without it)

---

## 1. Clone & install frontend dependencies

```powershell
cd acra_website
npm install
```

---

## 2. Configure environment variables

Create `.env.local` in the project root:

```env
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

> **No Supabase?** Leave `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` out entirely. The app runs in **mock mode** — auth and job history are stored in your browser with no backend required for auth.

---

## 3. Set up the Python backend

```powershell
cd backend\code
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Configure `backend\.env`:

```env
SKIP_AUTH=true
BASE_URL=http://localhost:8000
JOB_EXPIRY_HOURS=24
SUPABASE_JWT_SECRET=
```

> Set `SKIP_AUTH=false` and fill in `SUPABASE_JWT_SECRET` when deploying to production.

---

## 4. Place the ONNX model

Put the trained model file at:

```
backend/acra_medium_v7_best.onnx
```

> Without the model the backend still starts, but YOLO segmentation is disabled and the pipeline falls back to FCM-only mode.

---

## 5. Run the system

Open **two terminals**:

**Terminal 1 — Frontend (Vite dev server)**
```powershell
cd acra_website
npm run dev
```
Opens at `http://localhost:5173`

**Terminal 2 — Backend (FastAPI)**
```powershell
cd acra_website\backend\code
.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

---

## 6. First login

- **Mock mode** (no Supabase): go to `/register`, create any account, then log in.
- **Supabase mode**: go to `/register`, create an account. If login fails, disable **Confirm email** in your Supabase dashboard under Authentication → Configuration → Sign In / Providers → Email.

---

## Project structure

```
acra_website/
├── src/                        # React frontend (Vite + Tailwind)
│   ├── pages/                  # Route pages (Login, Dashboard, Single, Bulk, History, TestLab)
│   ├── components/             # Shared UI components
│   ├── hooks/                  # useAuth, useTheme
│   └── lib/                    # supabase.js, api.js (Axios client)
├── backend/
│   ├── code/
│   │   ├── main.py             # FastAPI app — all endpoints
│   │   ├── pipeline/           # CVD re-encoding pipeline (9 stages)
│   │   │   ├── normalization.py
│   │   │   ├── cvd_simulation.py
│   │   │   ├── cielab.py
│   │   │   ├── auto_clusters.py
│   │   │   ├── fcm.py
│   │   │   ├── segmentation.py     # YOLO + mask edge softness
│   │   │   ├── conflict.py
│   │   │   ├── reencoding.py
│   │   │   ├── reconstruction.py
│   │   │   └── metrics.py
│   │   └── jobs.db             # SQLite (auto-created on first run)
│   └── acra_medium_v7_best.onnx   # YOLO model (not in repo)
├── .env.local                  # Frontend env vars (not committed)
└── backend/.env                # Backend env vars (not committed)
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server + model status |
| `POST` | `/process` | Run CVD pipeline on an image |
| `GET` | `/jobs` | List your processed jobs |
| `GET` | `/jobs/{id}` | Get one job with metrics |
| `DELETE` | `/jobs/{id}` | Delete a job |
| `POST` | `/test-runs` | Run pipeline and store permanently |
| `GET` | `/test-runs` | List all test runs |
| `GET` | `/test-runs/analytics` | Aggregate metrics across all runs |
| `DELETE` | `/test-runs/{id}` | Delete one test run |
| `DELETE` | `/test-runs` | Clear all test runs |

### `/process` form fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `image` | file | required | JPEG or PNG, max 10 MB |
| `cvd_type` | string | required | `deutan` or `protan` |
| `severity` | float | required | 0.0–1.0 |
| `conf_threshold` | float | `0.25` | YOLO detection confidence |
| `use_segmentation` | int | `1` | `1` = YOLO+FCM, `0` = FCM only |
| `seg_soft` | float | `3.0` | Mask edge softness (0–8) |
| `n_clusters` | int | auto | Manual FCM cluster count (2–100) |
| `seg_clusters_per_roi` | int | `3` | FCM sub-clusters per YOLO region (2–8) |

---

## Pipeline overview

```
Upload → Normalize (sRGB→linear) → CVD Simulate (Machado 2009)
       → CIELAB convert → Cluster (FCM or YOLO+FCM)
       → Conflict detect (CIEDE2000) → LCH re-encode (lightness push)
       → Reconstruct (fuzzy membership blend) → sRGB output
       → Validate (ΔE, conflict resolution rate, naturalness, WCAG)
```

Authors: Martinez, John Andrei M. · Gallo, Dave Andre A. · Balcarse · Torres
