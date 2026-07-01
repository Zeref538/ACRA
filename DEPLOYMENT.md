# ACRA — Full Deployment Guide
### Supabase · Hugging Face Spaces · Vercel

Do these three sections **in order**. You will collect values in Supabase first, then paste
them into Hugging Face Spaces and Vercel.

---

## Prerequisites

- GitHub account with this repo pushed (`Zeref538/ACRA` — public)
- A Supabase account (free) → supabase.com
- A Hugging Face account (free) → huggingface.co
- A Vercel account (free) → vercel.com

---

## PART 1 — Supabase (Authentication)

ACRA uses Supabase for user login and registration only. You need three values from here:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET`.

### Step 1 — Create a new project

1. Go to **supabase.com** and sign in.
2. Click **"New project"**.
3. Fill in:
   - **Name**: `acra`
   - **Database Password**: generate a strong one and save it.
   - **Region**: pick the one closest to you.
   - **Pricing plan**: Free.
4. Click **"Create new project"**. Takes about 60 seconds.

### Step 2 — Collect your API keys

1. Click the gear icon **"Project Settings"** in the left sidebar.
2. Click **"API"**.
3. Copy:
   - **Project URL** → `https://xxxx.supabase.co` — this is `VITE_SUPABASE_URL`
   - **anon public key** — this is `VITE_SUPABASE_ANON_KEY`
4. Scroll down to **"JWT Settings"** → copy **"JWT Secret"** — this is `SUPABASE_JWT_SECRET`.

> Save all three values — you will paste them into Hugging Face and Vercel below.

### Step 3 — Disable email confirmation

1. Left sidebar → **"Authentication"** → **"Providers"**.
2. Click **"Email"** → toggle off **"Confirm email"** → **"Save"**.

> Without this step users cannot log in immediately after registering.

### ⚠️ Free tier warning — project pause

Supabase free projects **auto-pause after 7 days of inactivity**. If nobody visits ACRA
for a week, logins will fail until you manually unpause in the dashboard.

Fix: set up a free Uptime Robot ping to your Supabase health URL every 3 days:
```
https://YOUR-PROJECT-REF.supabase.co/auth/v1/health
```

### YouTube tutorials — Supabase

Search: **"Supabase auth setup tutorial 2024"** — the official Supabase channel has an
"Auth in 7 minutes" walkthrough that covers exactly Steps 1–3 above.

---

## PART 2 — Hugging Face Spaces (Python / FastAPI Backend)

Hugging Face Spaces is used instead of Render because the free tier provides **16 GB RAM
and 2 vCPU** — enough to load the ONNX model and run the full YOLOv8 + FCM pipeline.

### Step 1 — Create a Hugging Face account

Go to **huggingface.co** and sign up if you don't have an account.

### Step 2 — Create a new Space

1. Click your profile picture (top-right) → **"New Space"**.
2. Fill in:
   - **Owner**: your HF username
   - **Space name**: `acra-backend`
   - **License**: MIT (or any)
   - **SDK**: **Docker**
   - **Visibility**: **Public** (required for free tier)
3. Click **"Create Space"**.

HF creates a git repository at:
```
https://huggingface.co/spaces/YOUR-HF-USERNAME/acra-backend
```

### Step 3 — Push your code to the Space

The Space is a git repo. You push your ACRA code directly to it.

Open a terminal in your ACRA folder and run:

```powershell
git remote add hf https://huggingface.co/spaces/YOUR-HF-USERNAME/acra-backend
git push hf main
```

When prompted for credentials:
- **Username**: your HF username
- **Password**: your HF **Access Token** (not your account password)
  - Get one at: huggingface.co → Settings → Access Tokens → New token → Write access

> The Dockerfile in the repo instructs HF to download the ONNX model from GitHub during
> the build, so you do not need git-lfs. The push will be fast (text files only).

### Step 4 — Watch the build

1. Go to your Space page: `huggingface.co/spaces/YOUR-HF-USERNAME/acra-backend`
2. Click the **"Logs"** tab to watch the build.
3. The first build takes **5–10 minutes** — it installs NumPy, Pillow, Ultralytics,
   ONNX Runtime, and downloads the 99 MB ONNX model.
4. When the build finishes the status changes from **"Building"** to **"Running"**.

### Step 5 — Add environment secrets

1. On your Space page, click the **"Settings"** tab.
2. Scroll to **"Repository secrets"**.
3. Click **"New secret"** for each of the following:

| Name | Value |
|---|---|
| `SKIP_AUTH` | `false` |
| `SUPABASE_JWT_SECRET` | the JWT Secret you copied from Supabase |
| `BASE_URL` | `https://YOUR-HF-USERNAME-acra-backend.hf.space` |
| `CORS_ORIGINS` | leave blank for now — fill in after Vercel is deployed |
| `JOB_EXPIRY_HOURS` | `24` |
| `PURGE_INTERVAL_SECONDS` | `3600` |

> Secrets are injected as environment variables at runtime. The Space restarts
> automatically each time you save a new secret.

### Step 6 — Find your Space URL

Your backend URL follows this pattern:
```
https://YOUR-HF-USERNAME-acra-backend.hf.space
```

Example: if your HF username is `zeref538`, the URL is:
```
https://zeref538-acra-backend.hf.space
```

### Step 7 — Verify the backend

Open this URL in your browser:
```
https://YOUR-HF-USERNAME-acra-backend.hf.space/health
```

You should see:
```json
{
  "status": "ok",
  "model_loaded": true,
  "uptime_seconds": 42.3
}
```

If `model_loaded` is `false`, the ONNX model failed to download during build.
Check the Logs tab for a `wget` error.

> **Free tier sleep**: The Space pauses after **48 hours** of inactivity (much more
> forgiving than other free tiers). Wake-up takes about 30 seconds.

### YouTube tutorials — Hugging Face Spaces

Search: **"Deploy FastAPI Hugging Face Spaces Docker 2024"** — several short tutorials
show exactly the New Space → Docker SDK → push code → set secrets flow above.

---

## PART 3 — Vercel (React / Vite Frontend)

### Step 1 — Import your repo

1. Go to **vercel.com** and sign in.
2. Click **"Add New…"** → **"Project"**.
3. Find `Zeref538/ACRA` and click **"Import"**.

### Step 2 — Configure the project

Vercel auto-detects Vite. Verify:

| Setting | Value |
|---|---|
| **Framework Preset** | Vite (auto-detected) |
| **Root Directory** | `./` (do not change) |
| **Build Command** | `npm run build` (auto-filled) |
| **Output Directory** | `dist` (auto-filled) |

### Step 3 — Add environment variables

Click **"Import .env"** and paste:

```
VITE_API_URL=https://YOUR-HF-USERNAME-acra-backend.hf.space
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Replace all three values with your real ones from Parts 1 and 2.

### Step 4 — Deploy

Click **"Deploy"**. Vercel runs `npm install` then `npm run build`. Takes about 60 seconds.

You'll get a URL like `https://acra-abc123.vercel.app`. **Copy it.**

### Step 5 — Give HF Spaces your Vercel URL (CORS)

The FastAPI backend only accepts requests from origins listed in `CORS_ORIGINS`. Without
your Vercel URL, every API call from the frontend will be blocked.

1. Go to your HF Space → **Settings** → **Repository secrets**.
2. Find `CORS_ORIGINS` → set it to your Vercel URL:
   ```
   https://acra-abc123.vercel.app
   ```
3. Save. The Space restarts automatically (~30 seconds).

### Step 6 — Test the full stack

1. Open your Vercel URL.
2. You should see the ACRA login page with the spectral dots.
3. Register with an email and password.
4. Upload an image, select a CVD type, click Process.
5. The app calls your HF Space backend and returns a corrected image with metrics.

> **If uploads fail with "Backend not connected"**: check that `VITE_API_URL` in Vercel
> exactly matches your HF Space URL (no trailing slash, `https://` not `http://`).
> After fixing a Vercel env var, redeploy: Deployments → latest → ⋮ → Redeploy.

### YouTube tutorials — Vercel

Search: **"Deploy Vite React app to Vercel 2024"** — covers the Import → Configure
→ Environment Variables → Deploy flow shown above.

---

## Quick Reference — All environment variables

### Vercel (frontend)

| Variable | Where to get it |
|---|---|
| `VITE_API_URL` | Your HF Space URL |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |

### Hugging Face Space (backend secrets)

| Variable | Value / source |
|---|---|
| `SKIP_AUTH` | `false` |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret |
| `BASE_URL` | Your HF Space URL |
| `CORS_ORIGINS` | Your Vercel URL |
| `JOB_EXPIRY_HOURS` | `24` |
| `PURGE_INTERVAL_SECONDS` | `3600` |

---

## Troubleshooting

**Login fails after registration**
→ Confirm **"Confirm email"** is disabled in Supabase → Authentication → Providers → Email.

**Login suddenly stops working (was working before)**
→ Supabase free project auto-paused after 7 days of inactivity.
→ Go to supabase.com → your project → click "Restore project".

**"Backend not connected" banner on the Upload page**
→ `VITE_API_URL` in Vercel is wrong or missing. Must exactly match your HF Space URL.
→ After fixing: Vercel → Deployments → Redeploy.

**API calls blocked / CORS error in browser console**
→ `CORS_ORIGINS` in HF Space secrets does not include your Vercel URL.
→ Update the secret and wait ~30 seconds for the Space to restart.

**`model_loaded: false` on `/health`**
→ The ONNX model failed to download during the Docker build.
→ Check the Space's Logs tab for a `wget` error on the GitHub raw URL.
→ The app still works in FCM-only mode (less spatially precise but functional).

**HF Space URL returns 503 or times out**
→ Space is waking from the 48-hour inactivity pause. Wait ~30 seconds and retry.
→ If consistently failing, check the Logs tab in your Space for runtime errors.

**Job images disappear after a Space restart**
→ This is expected on the free tier — storage is ephemeral.
→ Jobs expire in 24 hours anyway, so this only matters if the Space restarts mid-session.
→ For persistent storage, add HF Persistent Storage ($5/month) and set `DATA_DIR=/data`.
