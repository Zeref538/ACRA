# ACRA — Full Deployment Guide
### Supabase · Render · Vercel

Do these three sections **in order**. You will collect values in Supabase first, then paste
them into Render and Vercel.

---

## Prerequisites

- GitHub account with this repo pushed (Render and Vercel both pull from GitHub)
- A Supabase account (free) → supabase.com
- A Render account (free) → render.com
- A Vercel account (free) → vercel.com

---

## PART 1 — Supabase (Authentication)

ACRA uses Supabase for user login and registration only. You need three values from here:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET`.

### Step 1 — Create a new project

1. Go to **supabase.com** and sign in.
2. On the dashboard you'll see **"New project"** — click it.
3. Fill in the form:
   - **Name**: `acra` (or anything you want)
   - **Database Password**: generate a strong one and save it somewhere — you won't need
     it for ACRA, but losing it locks you out of the database.
   - **Region**: pick the one closest to you (e.g. East US, Southeast Asia).
   - **Pricing plan**: Free.
4. Click **"Create new project"**. It takes about 60 seconds to provision.

### Step 2 — Collect your API keys

1. Once the project is ready, click the gear icon **"Project Settings"** in the
   left sidebar (bottom of the sidebar).
2. In the Settings sidebar, click **"API"**.
3. You will see two sections:
   - **Project URL** — copy the URL that looks like
     `https://abcdefghijkl.supabase.co`. This is your `VITE_SUPABASE_URL`.
   - **Project API Keys** — there are two keys listed.
     Copy the one labelled **`anon` `public`**. This is your `VITE_SUPABASE_ANON_KEY`.
4. Scroll down on the same API page to **"JWT Settings"**.
   Copy the value under **"JWT Secret"**. This is your `SUPABASE_JWT_SECRET` for
   the Render backend.

> Save all three values — you will paste them into Render and Vercel in the next parts.

### Step 3 — Disable email confirmation

ACRA's Register page calls `supabase.auth.signUp()` and expects users to be able to
log in immediately without clicking a confirmation email.

1. In the left sidebar, click **"Authentication"**.
2. In the Authentication sub-menu click **"Providers"** (under "Configuration").
3. Find **"Email"** at the top of the list. Click on it to expand.
4. Toggle off **"Confirm email"**.
5. Click **"Save"**.

> Users who register on your deployed ACRA site can now log in straight away.

### Step 4 (Optional) — Enable Google login

The login page has a "Continue with Google" button. If you want it to work:

1. In the Authentication sidebar, click **"Providers"**.
2. Find **"Google"** in the list and click to expand.
3. Toggle it **on**.
4. You will need a Google OAuth Client ID and Secret from
   **console.cloud.google.com → APIs & Services → Credentials**.
5. Paste those values into the Google provider fields and save.
6. Add your Vercel URL to the **"Redirect URLs"** field inside the Google provider:
   `https://your-project.vercel.app/**`

> Without this step the Google button still appears but does nothing. The email/password
> path is fully functional without it.

### YouTube tutorials — Supabase

Search on YouTube for:
- **"Supabase auth setup tutorial 2024"** — the official Supabase channel
  (@Supabase) has a "Auth in 7 minutes" video that walks through exactly what
  you did above, including disabling email confirmation.
- **"Supabase with React full tutorial"** — Laith Harb's tutorial covers
  signUp / signInWithPassword / onAuthStateChange and shows the Project Settings →
  API page where you find your keys.

---

## PART 2 — Render (Python / FastAPI Backend)

### Step 1 — Push your repo to GitHub

If you haven't already:

```powershell
cd ACRA
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR-USERNAME/acra.git
git push -u origin main
```

### Step 2 — Create a new Web Service

1. Go to **dashboard.render.com** and sign in.
2. Click the **"New +"** button in the top-right corner.
3. Select **"Web Service"** from the dropdown.
4. On the next screen, click **"Connect a repository"**.
5. If this is your first time, click **"Connect GitHub"** and authorize Render to
   access your account. Then search for and select your `acra` repo.
6. Click **"Connect"**.

### Step 3 — Configure the service settings

Render will auto-detect some settings. Verify and fill in:

| Setting | Value |
|---|---|
| **Name** | `acra-backend` (or anything) |
| **Region** | Match your Supabase region if possible |
| **Branch** | `main` |
| **Root Directory** | leave blank |
| **Runtime** | `Python 3` |
| **Build Command** | `pip install -r code/requirements.txt` |
| **Start Command** | `cd code && uvicorn main:app --host 0.0.0.0 --port $PORT` |
| **Instance Type** | Free |

> Render detects `render.yaml` in the repo and may pre-fill the build and start
> commands automatically. If it does, verify they match the table above.

### Step 4 — Add environment variables

Scroll down to the **"Environment Variables"** section (still on the same creation
page, before you click Deploy).

Click **"Add Environment Variable"** for each of the following:

| Key | Value |
|---|---|
| `SKIP_AUTH` | `false` |
| `SUPABASE_JWT_SECRET` | the JWT Secret you copied from Supabase Part 1 Step 2 |
| `BASE_URL` | leave blank for now — you'll fill it in after the first deploy |
| `CORS_ORIGINS` | leave blank for now — you'll fill it in after Vercel is deployed |
| `JOB_EXPIRY_HOURS` | `24` |
| `PURGE_INTERVAL_SECONDS` | `3600` |
| `DATA_DIR` | `/data` |

> `BASE_URL` and `CORS_ORIGINS` require your Render and Vercel URLs which you don't
> have yet. That's fine — the service will still start. You'll update them in Step 6.

### Step 5 — Add a Persistent Disk

Without a disk, your SQLite database and all processed job images are wiped every
time Render restarts or redeploys the service. The disk keeps them alive.

1. Still on the creation page, scroll down to **"Disks"**.
2. Click **"Add Disk"**.
3. Fill in:
   - **Name**: `acra-data`
   - **Mount Path**: `/data`
   - **Size**: `1 GB` (this is the minimum and is sufficient)
4. Click **"Save"**.

> Note: Render's persistent disk is a paid add-on at $0.25/GB/month. The free plan
> does not include it. If cost is a concern, the app still works without it — jobs
> simply won't survive a restart (they expire in 24 hours anyway, so for a portfolio
> demo this is acceptable). To skip the disk: remove `DATA_DIR` from env vars and
> do not add the disk.

### Step 6 — Deploy and get your backend URL

1. Click **"Create Web Service"** at the bottom of the page.
2. Render will start building. You can watch the build logs in real time. It takes
   2–5 minutes on first deploy (it's installing numpy, Pillow, ultralytics, etc.).
3. Once the build succeeds, Render shows a URL at the top of the service page — it
   looks like `https://acra-backend.onrender.com`. **Copy this URL.**

Now update the two env vars you left blank:

4. Click the **"Environment"** tab on your Render service.
5. Find `BASE_URL` and set it to: `https://acra-backend.onrender.com`
   (your actual URL, not this example).
6. Leave `CORS_ORIGINS` for now — you'll have the Vercel URL after Part 3.
7. Click **"Save Changes"**. Render will redeploy automatically.

### Step 7 — Verify the backend is running

Open your backend URL in a browser with `/health` appended:

```
https://acra-backend.onrender.com/health
```

You should see a JSON response like:
```json
{
  "status": "ok",
  "model_loaded": true,
  "uptime_seconds": 42.3
}
```

If `model_loaded` is `false`, the ONNX model is missing. See the note below.

> **Free tier sleep**: Render's free tier spins the service down after 15 minutes of
> inactivity. The first request after it sleeps takes ~30 seconds to wake up. This is
> normal for free tier and fine for a portfolio project.

### YouTube tutorials — Render

Search on YouTube for:
- **"Deploy FastAPI on Render 2024"** — several short (8–12 min) tutorials show
  exactly the New Web Service → Connect GitHub → Build Command → Start Command flow
  you followed above. Look for ones that also show adding environment variables.
- **"Render.com tutorial Python web service"** — the official Render YouTube channel
  (@render-com) has a "Deploy a Python Web Service" video that covers free tier,
  env vars, and the persistent disk add-on.

---

## PART 3 — Vercel (React / Vite Frontend)

### Step 1 — Import your repo

1. Go to **vercel.com** and sign in.
2. On your Vercel dashboard, click **"Add New…"** → **"Project"**.
3. Under **"Import Git Repository"**, find your `acra` repo and click **"Import"**.

### Step 2 — Configure the project

Vercel will auto-detect Vite. On the configuration screen:

| Setting | Value |
|---|---|
| **Framework Preset** | Vite (auto-detected) |
| **Root Directory** | `.` (the repo root — do not change) |
| **Build Command** | `npm run build` (auto-filled) |
| **Output Directory** | `dist` (auto-filled) |
| **Install Command** | `npm install` (auto-filled) |

> Do not set the Root Directory to `src` or `code`. It must be `.` (the project root
> where `package.json` and `vite.config.js` live).

### Step 3 — Add environment variables

Still on the same configuration screen, scroll down to **"Environment Variables"**.

Click **"Add"** and enter each variable:

| Name | Value |
|---|---|
| `VITE_API_URL` | `https://acra-backend.onrender.com` — your Render URL from Part 2 |
| `VITE_SUPABASE_URL` | the Project URL from Supabase Part 1 Step 2 |
| `VITE_SUPABASE_ANON_KEY` | the anon/public key from Supabase Part 1 Step 2 |

Make sure the **"Environment"** checkboxes for each variable include at minimum
**"Production"**. You can also tick "Preview" and "Development" if you want them
available in those contexts too.

### Step 4 — Deploy

1. Click **"Deploy"**.
2. Vercel runs `npm install` then `npm run build` (Vite). This takes about 60 seconds.
3. When it finishes you'll see a **"Congratulations!"** screen with your deployed URL,
   something like `https://acra-abc123.vercel.app`.
4. **Copy this URL** — you need it for the final step.

### Step 5 — Give Render your Vercel URL (CORS)

The FastAPI backend only accepts requests from origins listed in `CORS_ORIGINS`. Your
Vercel URL isn't in that list yet, so API calls from the deployed frontend would be
blocked.

1. Go back to your Render service dashboard.
2. Click the **"Environment"** tab.
3. Find the `CORS_ORIGINS` variable and set it to your Vercel URL:
   ```
   https://acra-abc123.vercel.app
   ```
   If you have a custom domain, add both separated by a comma:
   ```
   https://acra-abc123.vercel.app,https://yourdomain.com
   ```
4. Click **"Save Changes"**. Render redeploys (takes ~1 minute).

### Step 6 — Test the full stack

1. Open your Vercel URL in a browser.
2. You should see the ACRA login page with the three spectral dots and the brand name.
3. Click **"Register"** and create an account with an email and password.
4. You should be logged in and redirected to the Dashboard.
5. Upload an image, select a CVD type (Deutan or Protan), and click Process.
6. The app should call your Render backend and return a corrected image with metrics.

> If the page loads but the Upload page shows "Backend not connected" — double-check
> that `VITE_API_URL` in Vercel exactly matches your Render URL (no trailing slash,
> `https://` not `http://`). After changing a Vercel env var you must trigger a
> redeployment: go to **Deployments → your latest deployment → ⋮ → Redeploy**.

### YouTube tutorials — Vercel

Search on YouTube for:
- **"Deploy Vite React app to Vercel 2024"** — many short (5–8 min) tutorials cover
  exactly the Import → Configure → Environment Variables → Deploy flow above.
  Look for ones that show adding env vars on the initial setup screen.
- **"Vercel environment variables tutorial"** — the official Vercel YouTube channel
  (@Vercel) has videos specifically on environment variables, including how to
  redeploy after changing them and the difference between Production / Preview /
  Development environments.

---

## Quick Reference — All environment variables

### Vercel (frontend)

| Variable | Where to get it |
|---|---|
| `VITE_API_URL` | Your Render service URL |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |

### Render (backend)

| Variable | Value / source |
|---|---|
| `SKIP_AUTH` | `false` |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret |
| `BASE_URL` | Your Render service URL |
| `CORS_ORIGINS` | Your Vercel URL |
| `DATA_DIR` | `/data` |
| `JOB_EXPIRY_HOURS` | `24` |
| `PURGE_INTERVAL_SECONDS` | `3600` |

---

## Troubleshooting

**Login fails after registration**
→ Confirm that **"Confirm email"** is disabled in Supabase Authentication → Providers → Email.

**"Backend not connected" banner on the Upload page**
→ `VITE_API_URL` in Vercel is wrong or missing. Must be exactly your Render URL.
→ Redeploy on Vercel after fixing (Deployments → Redeploy).

**API calls blocked / CORS error in browser console**
→ `CORS_ORIGINS` in Render does not include your Vercel URL. Update it and let Render redeploy.

**`model_loaded: false` on `/health`**
→ The ONNX file is missing from the deploy. The app still works in FCM-only mode.
→ If the file is in git, check the Render build logs for download errors.

**Render service URL returns 502 or times out**
→ Free tier is waking up from sleep. Wait 30 seconds and try again.
→ If it consistently fails, check Render logs under the "Logs" tab on your service.

**Images in job history disappear after a Render restart**
→ You don't have a Disk attached. Add one in Render → your service → Disks
   with mount path `/data` and make sure `DATA_DIR=/data` is set.
