# ACRA — What It Does & How It Works

## The Problem It Solves

Approximately 1 in 12 men and 1 in 200 women have some form of color vision deficiency (CVD) —
commonly called color blindness. The most widespread types are **deuteranomaly** and **deuteranopia**
(difficulty or inability to distinguish red from green). For people with these conditions,
images that rely on color to communicate information — maps, charts, medical scans, infographics,
product interfaces, traffic signs — can be partially or completely unreadable.

Existing accessibility tools mostly *simulate* what a color-blind person sees. ACRA goes further:
it **re-encodes** the image so that colors which previously looked identical to a CVD viewer are
made perceptually distinct again, without making the image look unnatural to a normal-vision viewer.

---

## What ACRA Stands For

**Adaptive Color Re-Encoding System**

The word "adaptive" reflects that the correction is not a fixed color swap or a blanket filter.
The system analyzes each image individually — detecting its specific color composition and
which regions contain conflicting colors — and applies a targeted, per-image correction.

---

## Who It Is For

- **Designers and developers** who want to verify and fix the accessibility of images,
  UI screenshots, charts, or any visual asset before shipping it.
- **Researchers** who need to process batches of images and track how well the correction
  performs across a dataset.
- **Educators and content creators** who want to make visual materials usable by
  color-blind audiences.
- **Anyone** who uploads an image and wants to know whether a CVD viewer can distinguish
  its colors — and get a corrected version if not.

---

## The Full Processing Pipeline

When you upload an image, ACRA runs it through a nine-stage pipeline. Each stage is described
below in plain terms, followed by the technical detail.

### Stage 1 — Image Loading & Downsampling
The image is loaded and, if it exceeds 1.5 million pixels (roughly 1400×1050), it is
proportionally scaled down for faster processing. The final corrected image is upscaled
back to the original resolution at the end.

### Stage 2 — Linear Normalisation
Display images are stored in sRGB colour space, which applies a non-linear gamma curve.
Before any colour math can be done accurately, the image must be converted from sRGB to
**linear RGB** (removing the gamma). This is the same step that happens inside a professional
colour-managed graphics pipeline.

### Stage 3 — CVD Simulation (Machado 2009)
The linear image is passed through a **colour vision deficiency simulation** using the
Machado 2009 model — the most widely cited perceptual model for deuteranomaly and deuteranopia.
This produces a version of the image that represents what it looks like to someone with the
specified type and severity of CVD. This simulated view is used in Stage 5 to identify which
colours have collapsed into each other.

**CVD types supported:**
- **Deutan** — affects the green-sensitive (M) cone. Deuteranomaly (partial) or Deuteranopia (complete).
- **Protan** — affects the red-sensitive (L) cone. Protanomaly (partial) or Protanopia (complete).

**Severity** is a float from 0.0 (no deficiency) to 1.0 (complete — full anopia). Most real-world
cases fall between 0.5 and 0.9.

### Stage 4 — CIELAB Conversion
The image is converted to **CIELAB colour space**, a perceptually uniform space designed so that
equal numerical distances correspond to equal perceived colour differences. All clustering,
conflict detection, and re-encoding happen in CIELAB because it gives the maths a direct
connection to human perception.

### Stage 5 — Clustering (Fuzzy C-Means or YOLOv8 + FCM)
The image's colour regions must be identified before conflicts between them can be found.
ACRA supports two modes:

**FCM-only mode (no segmentation model)**
The image pixels are clustered in CIELAB space using **Fuzzy C-Means (FCM)**. Unlike hard
clustering (k-means), FCM assigns each pixel a fractional membership score for every cluster.
This allows smooth transitions between regions (important for photos with gradients).
The number of clusters is estimated automatically per image based on its colour complexity,
or can be set manually (2–100 clusters).

**YOLOv8 + FCM mode (with ONNX segmentation model)**
A custom-trained YOLOv8 segmentation model detects semantically meaningful regions in the image:
colour swatches, objects, text labels, symbols, and regions to exclude (such as people/skin).
Each detected region (ROI) is then clustered independently with FCM, giving much finer-grained
control over which colours get corrected. Regions outside any detected ROI fall back to
global FCM. This mode is more accurate but requires the ONNX model file to be present.

**YOLO class labels:**
| Label | Meaning |
|---|---|
| `roi-color` | A deliberate colour swatch or palette area |
| `roi-object` | A coloured object where hue carries meaning |
| `roi-text` | Coloured text or labels |
| `roi-symbol` | Icons, checkmarks, status indicators |
| `exclude-person` | Skin — excluded from re-encoding to avoid unnatural results |

### Stage 6 — Conflict Detection (CIEDE2000)
For each pair of colour clusters, ACRA asks: *after CVD simulation, do these two clusters
look the same?* The perceptual distance is measured using **CIEDE2000** (ΔE₀₀), the most
accurate colour difference formula. A pair is flagged as a "conflict" when their simulated
ΔE falls below a threshold — meaning a CVD viewer would struggle to tell them apart.

### Stage 7 — LCH Re-Encoding
For each conflicting pair, ACRA adjusts the colours to make them distinguishable.
The correction works in **LCH space** (Lightness, Chroma, Hue — a cylindrical
representation of CIELAB). The key insight is that people with red-green CVD can still
perceive **lightness** differences very well. So the primary correction pushes conflicting
colours apart in the L* (lightness) dimension.

A safety net called `enforce_rg_separation` runs after the main re-encoding to guarantee
that green regions always read as lighter than red regions — the most common failure mode
for deuteranopes looking at signal-style imagery.

To avoid unnatural colour shifts, only 15% of any chroma (a*/b*) adjustment is applied;
the bulk of the correction is lightness-only. This keeps the image looking natural to
normal-vision viewers while resolving the conflict for CVD viewers.

### Stage 8 — Fuzzy Reconstruction
The cluster-level colour shifts are blended back into every pixel using the **FCM membership
weights** from Stage 5. Because FCM gives each pixel a fractional membership across all
clusters, the pixel's colour shift is a weighted average of the shifts of all clusters it
belongs to. This produces smooth, artifact-free transitions — no hard boundaries or
visible halo effects.

### Stage 9 — Validation Metrics
Three metrics are computed to quantify how well the correction worked:

| Metric | What it means | Pass threshold |
|---|---|---|
| **ΔE Improvement** | How much the perceptual distance between conflicting colours increased after re-encoding, measured in CIEDE2000 units. Higher is better. | > 15 ΔE units |
| **Conflict Resolution Rate** | Fraction of the detected conflicts that are now distinguishable (ΔE > threshold) after correction. | > 80% |
| **Naturalness Preservation** | How much the average colour of the image changed from the original. Lower is better — a high value means the image looks noticeably different to a normal-vision viewer. | < 12 ΔE units |

Each metric has a **pass/fail** verdict shown in the UI.

---

## The Application — Pages & Features

ACRA is a full-stack web application. Here is what each screen does:

### Login / Register
Standard email + password authentication via Supabase. There is also a "Continue with Google"
button for OAuth login. When Supabase is not configured, the app automatically switches to a
**mock auth mode** — accounts and sessions are stored in browser localStorage so the UI is
fully usable for local development without any backend account.

### Dashboard (ACRA Lab)
The main hub. Contains:
- A quick-upload form for immediate analysis — upload an image, choose CVD type and severity,
  click Analyse. Results appear inline on the same page.
- An **Overview panel** showing total analyses, pass rate, average ΔE gain, and active job count.
- A **Quick Start** card with links to Single Analysis and Bulk Processing.
- A **CVD Type Breakdown** bar showing the split between deuteranomaly and deuteranopia jobs.
- A **Recent Analyses** grid showing the last four processed jobs with thumbnails and metrics.

### Single Image Analysis (`/single`)
A focused page for processing one image at a time with full control over all parameters:
- CVD subtype (deuteranomaly vs deuteranopia)
- Severity slider (0.0 – 1.0)
- After processing: a **four-panel view** showing Original, CVD Simulated, Corrected, and a
  bounding-box overlay of detected regions
- Expiry countdown (results are stored for 24 hours)
- Download button for the corrected image
- Delete button to remove results immediately

### Bulk Processing (`/bulk`)
Process up to **20 images simultaneously** in one batch. Each image runs through the same
pipeline independently. Results for all images appear as cards, each with its own metrics
and download link.

### History (`/history`)
A searchable, scrollable grid of all past jobs (within the 24-hour expiry window).
Each job card shows the original and corrected image thumbnails, the CVD type, severity,
and the three quality metrics with pass/fail badges.

### Test Lab (`/test-lab`)
A diagnostic tool for power users and researchers. Test runs are stored **permanently** (no
24-hour expiry) so you can build up a dataset of results over time. Features:
- Upload images and run the full pipeline exactly as in production
- View individual run results with full metrics
- **Analytics dashboard** with aggregate statistics across all test runs:
  average, minimum, and maximum for each metric
  pass rates per metric
  per-metric distribution targets
- Delete individual runs or clear all runs

### Results Page (`/results/:jobId`)
A shareable deep-link to any individual job result, accessible by job ID.
Loads the stored job from the backend and shows the same four-panel view and metrics
as the Single page.

### Demo Page (`/demo`)
A lightweight version of the analysis page for showcasing the tool without requiring
an account.

---

## The Four-Panel View

The signature UI element of ACRA. After processing, results are displayed in four panels
side by side:

| Panel | Content |
|---|---|
| **Original** | The uploaded image as-is |
| **CVD Simulated** | What the image looks like to a person with the selected CVD type and severity |
| **Corrected** | The re-encoded image that a CVD viewer can now distinguish |
| **Detection Overlay** | The original image with coloured bounding boxes showing where YOLOv8 detected regions, each labelled by class and confidence score |

---

## Tech Stack

### Frontend
| Technology | Role |
|---|---|
| React 18 | UI framework |
| Vite | Build tool and dev server |
| Tailwind CSS | Styling |
| React Router v6 | Client-side routing (SPA) |
| Axios | HTTP client for API calls |
| Lucide React | Icon library |
| Supabase JS SDK | Authentication |

### Backend
| Technology | Role |
|---|---|
| Python 3.12 | Language |
| FastAPI | REST API framework |
| Uvicorn | ASGI server |
| NumPy | Pixel-level array maths |
| Pillow | Image I/O and resizing |
| Ultralytics (YOLOv8) | Object/region detection |
| ONNX Runtime | Runs the custom-trained ONNX segmentation model |
| scikit-learn | Fuzzy C-Means clustering |
| SciPy | CIEDE2000 colour difference computation |
| SQLite | Job and test-run storage |
| PyJWT | JWT verification for Supabase tokens |
| python-dotenv | Environment variable loading |

### Infrastructure
| Service | Role |
|---|---|
| Supabase | User authentication |
| Render | Python/FastAPI backend hosting |
| Vercel | React/Vite frontend hosting |
| Git / GitHub | Source control |

---

## Data Flow Summary

```
User uploads image
        │
        ▼
  React frontend (Vercel)
  ├── Attaches Supabase JWT to request
  └── POST /process → Render backend
                │
                ▼
          FastAPI (Render)
          ├── Verifies JWT via Supabase secret
          ├── Runs 9-stage CVD pipeline
          ├── Saves original + corrected images to /data/static/ (Render Disk)
          ├── Stores job record in SQLite (jobs.db on Render Disk)
          └── Returns job JSON with image URLs + metrics
                │
                ▼
  React frontend
  ├── Renders four-panel view
  ├── Displays metrics with pass/fail badges
  └── Offers Download + Delete actions
```

---

## Limitations & Known Constraints

- **Supported CVD types**: Deutan (green cone) and Protan (red cone) only. Tritan (blue cone)
  deficiency is not supported.
- **Image formats**: JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC — max 10 MB.
- **Job expiry**: Processed images are deleted after 24 hours. Test-lab runs are permanent.
- **YOLOv8 dependency**: The ONNX segmentation model must be present for semantic segmentation.
  Without it, the pipeline falls back to FCM-only mode which is less spatially precise.
- **Processing time**: Depends on image size and mode. Typical ranges on a CPU:
  - 420×420, FCM-only: < 1 second
  - 1920×1080, YOLOv8 + FCM: 2–4 seconds
  - 3300×2550, YOLOv8 + FCM: 5–10 seconds
- **Render free tier sleep**: The backend sleeps after 15 minutes of inactivity and takes
  ~30 seconds to wake on the first request.

---

## Authors

Martinez, John Andrei M. · Gallo, Dave Andre A. · Balcarse · Torres
