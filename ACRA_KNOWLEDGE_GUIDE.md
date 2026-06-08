# ACRA — Panel Knowledge Guide
### Adaptive Color Re-Encoding Algorithm
*Everything you need to know, explained simply*

---

## 1. THE BIG PICTURE — What is ACRA?

ACRA stands for **Adaptive Color Re-Encoding Algorithm**. It is a software system that automatically corrects the colors in an image so that people who are **color blind can see the information clearly** — without changing what the image looks like to people with normal color vision.

Think of it like auto-correcting a document for someone who cannot read certain fonts — except instead of fonts, we are fixing colors, and instead of a word processor, we are using computer vision and color science.

**The core promise:** Upload any image. ACRA analyzes which colors would be confused by a color-blind viewer, then subtly adjusts only those colors — making the image accessible without making it look artificial or altered to anyone else.

---

## 2. THE PROBLEM — Color Vision Deficiency (CVD)

**What is color blindness?**
Color Vision Deficiency (CVD) is a condition where the eye's cone cells — the cells that detect color — are missing, damaged, or responding incorrectly. It is not "seeing in black and white." Most color-blind people see color, just differently.

**How common is it?**
- About **8% of males** and **0.5% of females** worldwide have some form of CVD.
- In a room of 100 people, roughly 5–8 of them cannot distinguish certain colors correctly.

**The two types ACRA focuses on:**
1. **Protanopia** — The L-cone (red-sensitive cone) is missing. Red looks dark or absent. Red and green are easily confused.
2. **Deuteranopia** — The M-cone (green-sensitive cone) is missing. The most common form. Green and red are confused.

**Why does this matter?**
- Traffic lights, safety signs, medical charts, data visualizations, and educational materials all use red/green combinations to convey critical information.
- A color-blind person looking at a poster with a red ✗ and a green ✓ might see two identical-looking symbols.
- ACRA was built specifically with **posters and visual information materials** in mind — where clear communication can have real consequences.

---

## 3. WHY THIS APPROACH — What makes ACRA different?

Most existing tools for color blindness do one of three things:
1. **Simulate** how a color-blind person sees an image (shows the problem, doesn't fix it).
2. **Recolor everything** by applying a blanket filter (destroys the look of the image).
3. **Require the designer** to manually pick CVD-safe colors from scratch.

**ACRA does none of those.** Instead it:
- Automatically **detects which specific colors conflict** for a color-blind viewer.
- Makes **the smallest possible change** to fix the conflict — touching only what needs to be touched.
- Preserves the **original design intent** as much as possible.
- Works on **any existing image** without needing the source files or the original designer.

This makes ACRA useful for retroactively making existing materials accessible — something no other automatic tool does well.

---

## 4. THE PIPELINE — How it works, step by step

When you upload an image, ACRA runs it through a series of mathematical transformations. Here is each step in plain language:

---

### Step 1 — Normalization (Gamma Removal)

Before any color math can happen, the image must be converted from how screens display colors to how light actually behaves physically.

**Why?** Screens compress colors using something called a "gamma curve" — shadows are brightened, highlights are compressed. Color science math only works correctly on the raw, uncompressed values.

*Think of it like converting a compressed MP3 back to a lossless audio file before editing the sound.*

---

### Step 2 — CVD Simulation (Machado 2009 Model)

ACRA then **simulates** how the image currently looks to a Protanopic or Deuteranopic viewer. This uses a scientifically validated mathematical model (Machado et al., 2009) that predicts, pixel by pixel, what colors a color-blind person would perceive.

**Why?** You cannot fix a problem you cannot see. By first simulating the color-blind view, ACRA knows exactly which colors "collapse" into each other — becoming indistinguishable.

The simulation supports a **severity slider** from 0 (mild CVD) to 1.0 (complete dichromacy — full absence of one cone type). This allows ACRA to target the full spectrum of how severe a person's condition is.

---

### Step 3 — CIELAB Color Space Conversion

The image is converted to a color space called **CIELAB** (also written CIE L\*a\*b\*).

CIELAB is special because it is **perceptually uniform** — meaning that equal numerical distances in this space correspond to equal perceived differences in color to the human eye. Regular RGB color is not like this: a change of 10 units in red looks very different depending on where you are in the color spectrum.

**Three channels:**
- **L\*** — Lightness (0 = black, 100 = white)
- **a\*** — Red/Green axis
- **b\*** — Yellow/Blue axis

*Why does this matter?* All conflict detection and re-encoding math is done in CIELAB, which means decisions about "how different are these colors?" are grounded in human perception, not arbitrary numbers.

---

### Step 4A — Auto Cluster Count (Silhouette Analysis)

Before ACRA can group colors, it needs to know how many distinct color groups the image has. This step automatically determines that number.

It uses a technique called **silhouette scoring** — testing different numbers of groups and measuring how well separated they are. It also checks how much red and green is present in the image, since those are the most critical colors for CVD.

**Why automate this?** Every image is different. A simple logo might have 4 color groups; a complex poster might have 20. A fixed number would either over-simplify or over-complicate.

---

### Step 4B — Fuzzy C-Means Clustering (FCM)

ACRA groups the image's pixels into color clusters using a technique called **Fuzzy C-Means (FCM)**.

**What is clustering?** Imagine sorting paint chips into piles by color. FCM does this automatically for every pixel in the image.

**What makes it "fuzzy"?** Unlike hard clustering (where a pixel belongs to exactly one group), FCM allows a pixel to **partially belong to multiple groups**. A pixel at the edge between a red region and a white background might be 70% red-cluster, 30% white-cluster. This partial membership is what allows ACRA to blend corrections smoothly — preventing harsh edges.

The result is a **membership matrix** — every pixel has a weight for every cluster. This is used later when applying corrections.

---

### Step 4C — YOLOv8 Semantic Segmentation (CNN)

Alongside the FCM clustering, ACRA also uses a **neural network** (a custom-trained YOLOv8 model) to detect and identify meaningful regions in the image.

**What is YOLO?** YOLO stands for "You Only Look Once" — a family of fast, accurate object detection neural networks. ACRA uses a version trained specifically on poster/infographic content to detect:
- **Regions of Interest** (areas with color information, symbols, objects, text)
- **Exclusion zones** (people, faces — which should not have their skin tones altered)

**Why combine CNN with FCM?** The CNN provides *what* is in the image (semantic understanding). FCM provides *how many colors* are in each region. Together, they allow ACRA to correct colors **within specific regions only** — rather than globally across the whole image.

*Example: A poster has a red danger symbol and a green safe symbol next to a person's face. ACRA corrects the symbols but leaves the skin tone completely untouched.*

---

### Step 4D — Mask Edge Softness

When the CNN identifies a region (say, a red circle), it creates a **mask** — a map of which pixels belong to that region. By default this mask has a hard edge.

ACRA applies a **Gaussian blur** to the mask edges before using them. This creates a soft transition zone at object boundaries, so corrected colors blend naturally into the surrounding image.

*Without this: color-corrected regions have a visible sharp border, like a badly cut-out sticker.*
*With this: the correction fades in gradually — invisible to the casual viewer.*

---

### Step 5 — Conflict Detection (CIEDE2000)

Now ACRA knows the color clusters. It runs each cluster through the CVD simulation from Step 2, and compares the simulated colors using a formula called **CIEDE2000** — the gold standard for measuring perceived color difference.

**A conflict is detected when:**
- Two clusters look different in the original (normal vision can distinguish them)
- But they look the same after CVD simulation (a color-blind person cannot distinguish them)

The threshold used is **ΔE < 20** — a ΔE (Delta-E) value of 20 is roughly the boundary between "noticeably different" and "confusably similar" for a trained observer. Below this, ACRA flags the pair for re-encoding.

*Think of it like: two voices that sound distinct to most people, but sound identical to someone with a specific hearing loss — ACRA finds which pairs have that problem.*

---

### Step 6 — LCH Re-Encoding (Lightness Push)

For every flagged conflict pair, ACRA adjusts the **lightness** of the colors involved — making one darker and one lighter until the color-blind simulation can distinguish them.

**Why only lightness?** Changing hue (the actual color) would be visible and jarring. Changing only lightness:
- Preserves the original hue and saturation (the color "feels" the same)
- Creates contrast that works even in grayscale
- Is less noticeable to people with normal vision

**The rules:**
- Red-ish clusters → pushed **darker**
- Green-ish clusters → pushed **lighter**
- There is a safety budget: no cluster's lightness changes by more than ±25 units
- The process stops as soon as ΔE ≥ 20.5 AND WCAG contrast ≥ 3.0

---

### Step 7 — Reconstruction (Fuzzy Membership Blend)

The lightness shifts calculated in Step 6 are now applied **per-pixel** using the fuzzy membership weights from Step 4B.

A pixel that is 70% in the "red cluster" and 30% in the "background cluster" will receive 70% of the red cluster's lightness correction and 30% of the background's correction. This is what makes the final output seamless — no hard color boundaries, no posterization effect.

*Mathematically: the corrected image = original image + (membership weights × lightness shifts). One matrix multiplication. Very fast.*

---

### Step 8 — Back to sRGB

The corrected image — still in CIELAB color space — is converted back to sRGB (the standard color space for screens and printers) by:
1. CIELAB → XYZ color space
2. XYZ → Linear RGB
3. Re-applying the gamma curve (undoing Step 1)
4. Clipping values to valid range and converting to standard 8-bit (0–255) per channel

The result is a standard JPEG or PNG, identical in format to the original — just with imperceptibly corrected colors.

---

### Step 9 — Validation Metrics

ACRA automatically evaluates its own output against four objective metrics:

| Metric | What it measures | Target |
|---|---|---|
| **ΔE Improvement** | How much more distinguishable the conflict pairs became | > 15 |
| **Conflict Resolution Rate** | What % of detected conflicts were successfully resolved | > 80% |
| **Color Drift (Naturalness)** | How much the overall image changed from the original | < 12 |
| **WCAG Contrast Ratio** | Does the re-encoded image meet accessibility standards? | ≥ 3.0:1 |

These metrics give an objective answer to "did it work?" and "how much did it change things?"

---

## 5. THE TECHNOLOGY — What is the system built with?

**Frontend (the website/interface):**
- **React** — The user interface framework
- **Tailwind CSS** — For styling and layout
- **Vite** — The build tool

**Backend (the processing engine):**
- **FastAPI** (Python) — The web server that receives images and runs the pipeline
- **NumPy / PIL** — For image manipulation
- **Ultralytics YOLO** — The neural network framework
- **SQLite** — A lightweight database storing job results

**Authentication:**
- **Supabase** — Manages user login (or mock mode for local development)

**Deployment:**
- Designed to run locally or deploy to cloud services (Render for backend, Vercel/Netlify for frontend)

---

## 6. THE INTERFACE — What can users do?

**Dashboard**
- Quick analysis from the home screen
- Shows history statistics: total analyses, pass rates, average ΔE improvement
- CVD type breakdown chart (how many protan vs. deutan jobs)

**Single Image Analysis**
- Upload one image, get full results
- Four-panel view: Original / CVD simulation / Re-encoded / Re-encoded CVD simulation
- Switch between Protanopia and Deuteranopia tabs
- Show/hide bounding box detections
- Toggle region labels on/off
- Click any image to view fullscreen with zoom
- Hover over any image panel to see dominant color clusters (FCM approximation)
- Download both corrected versions
- Full quality metrics

**Bulk Processing**
- Upload up to 50 images at once
- Process sequentially with shared settings
- Download all results at once
- Progress bar + ETA estimate

**Pipeline Demo**
- Walk through all pipeline stages interactively
- Each stage has a visual + explanation
- Navigate with arrow keys or click
- Auto-play mode (8 seconds per stage)
- Protan/Deutan tab to compare both corrections at each stage

**Storage**
- View all past analyses (24-hour expiry)
- Filter by CVD type, active/expired status
- Sort by newest/oldest
- Select individual items or all — delete in batch

---

## 7. DESIGN DECISIONS — Why did we make these choices?

**Why both Protanopia AND Deuteranopia always?**
They are the two most common forms of CVD and affect the same red-green spectrum. Processing both simultaneously ensures the output is accessible to the widest possible audience. Generating both in parallel adds no extra time from the user's perspective.

**Why is confidence percentage hidden?**
End-users of the tool are typically designers, educators, or administrators — not machine learning engineers. Showing a raw confidence score (e.g., "78.4%") can be confusing or misleading. What matters is whether a region was detected and whether the correction worked — not the model's internal certainty score.

**Why lightness-only correction instead of hue?**
Changing hue (the actual perceived color) produces results that look "wrong" to normal-sighted viewers. Lightness differences work because:
1. They are less perceptible to normal vision
2. They translate to contrast in grayscale (useful for printing)
3. WCAG accessibility guidelines are contrast-based, not hue-based

**Why 24-hour job expiry?**
Storage has a cost. Most users retrieve their results immediately after processing. A 24-hour window is sufficient for practical use without accumulating indefinite storage.

**Why mask edge softness (Gaussian blur on masks)?**
Early testing showed that hard-edged region masks produced visible correction artifacts — a sharp boundary where corrected colors met uncorrected background. The Gaussian blur on mask boundaries creates a soft feathering effect that makes corrections invisible at edges.

**Why fuzzy clustering instead of hard segmentation?**
Hard segmentation assigns each pixel to exactly one color group. At boundaries between regions, this creates abrupt color transitions. Fuzzy membership allows pixels at boundaries to receive blended corrections, producing photorealistic output.

**Why CIEDE2000 instead of simpler color distance formulas?**
Earlier delta-E formulas (ΔE76, ΔE94) are not perceptually uniform — the same numerical distance looks different in different parts of the color space. CIEDE2000 is the current industry standard, incorporating corrections for lightness, chroma, hue, and a special blue-region adjustment. It gives the most accurate answer to "do humans perceive these two colors as different?"

---

## 8. LIKELY PANEL QUESTIONS — Prepared answers

**Q: What problem does ACRA solve?**
A: ACRA automatically corrects images so that people with red-green color blindness can distinguish content that would otherwise look identical to them. It targets a problem that affects roughly 8% of the global male population and is especially important for visual communication materials like posters, charts, and infographics.

**Q: How is this different from just running a filter?**
A: A filter changes everything. ACRA changes only what needs to change. It first identifies the specific color pairs that would be confused by a color-blind viewer, then adjusts only those — leaving the rest of the image untouched. The result passes quantitative accessibility metrics while minimizing visible change to the original.

**Q: How do you know it actually worked?**
A: ACRA computes four objective metrics after every correction: how much color separation improved (ΔE), what percentage of conflicts were resolved, how much the overall image changed from the original, and whether WCAG accessibility contrast standards are met. A job can pass or fail each metric independently.

**Q: Why did you choose YOLO for object detection?**
A: YOLO (You Only Look Once) is one of the fastest and most accurate object detection architectures available. It processes the entire image in a single pass — unlike older region-based approaches that process each candidate area separately. This speed is critical because YOLO is one step in a longer pipeline, and its latency affects total processing time directly.

**Q: What is the role of fuzzy clustering?**
A: Fuzzy C-Means allows every pixel to partially belong to multiple color groups simultaneously. This is essential because real images have smooth color transitions, not hard boundaries. Fuzzy membership means that when we shift a color cluster's lightness, pixels near boundaries receive a blended correction — producing smooth, photorealistic output rather than blocky artifacts.

**Q: Could this be done in real-time?**
A: The current pipeline runs in approximately 1–4 seconds for typical images (up to 1920px). With further optimization — such as smaller YOLO models, GPU acceleration, or pre-computed segmentation — real-time processing (under 100ms) is theoretically achievable. The current implementation prioritizes correctness over speed.

**Q: Does it work for all types of color blindness?**
A: Currently ACRA targets Protanopia and Deuteranopia — the two most common forms of red-green color blindness. Tritanopia (blue-yellow) is architecturally supported in the simulation stage but not yet included in the correction pipeline. Monochromacy (complete color blindness, very rare) would require a completely different approach since it is not cone-cell-based.

**Q: What are the limitations?**
A: ACRA works best on images with clear, intentional color use — posters, charts, infographics, signage. It is less effective on natural photographs where colors are ambient and not used semantically to convey meaning. It also cannot correct video in the current implementation, and the YOLO model's detection quality depends on how similar the input is to its training data (poster/infographic content).

**Q: Who worked on this?**
A: The pipeline was developed collaboratively. Gallo, Dave Andre A. focused on the normalization, CVD simulation, CIELAB conversion, auto-clustering, FCM, YOLO segmentation, and the color ROI fallback system. Martinez, John Andrei M. focused on the LCH re-encoding logic, reconstruction, and the validation metrics framework.

**Q: Why not just tell designers to use CVD-safe colors from the start?**
A: That is the ideal solution — but it requires designers to have prior knowledge of CVD, access to CVD-checking tools during design, and willingness to change their workflow. ACRA addresses the massive existing inventory of already-designed materials that cannot be easily redesigned. It is a practical, retroactive solution.

**Q: What makes the lightness-only approach scientifically justified?**
A: The scientific basis comes from how color blindness actually works. CVD viewers retain full luminance (brightness) perception — their cones that detect light intensity are intact. Only the wavelength-sensitive response curves are altered. This means lightness contrast is reliably perceived across all CVD types. WCAG accessibility guidelines are also contrast-based (luminance ratio), not hue-based — so lightness correction directly addresses the accessibility standard.

**Q: How does the system handle skin tones?**
A: The YOLO model includes an "exclude-person" class. Regions identified as people (faces, hands) are assigned to an exclusion mask and their colors are not re-encoded. This prevents the system from altering skin tones, which would be immediately noticeable and undesirable.

**Q: What is WCAG and why does it matter?**
A: WCAG stands for Web Content Accessibility Guidelines — the internationally recognized standard for digital accessibility. The contrast ratio metric (target ≥ 3.0:1) is the specific WCAG criterion for distinguishing UI elements and large text. Meeting this standard means the corrected image's color pairs are not just distinguishable to CVD viewers — they are certified accessible by the same benchmark used by governments and organizations worldwide.

---

## 9. QUICK REFERENCE — Key numbers to remember

| Item | Value |
|---|---|
| CVD prevalence in males | ~8% |
| CVD prevalence in females | ~0.5% |
| Conflict ΔE threshold | < 20 (CIEDE2000) |
| Resolution target | > 80% of conflicts |
| ΔE improvement target | > 15 |
| Naturalness target | < 12 (color drift) |
| WCAG contrast target | ≥ 3.0:1 |
| Severity slider range | 0.0 (mild) to 1.0 (complete) |
| Optimal detection confidence | 0.30 |
| Max lightness change per cluster | ±25 L* units |
| Job expiry | 24 hours |
| Max file size | 10 MB |
| Max image dimension | 1920px (auto-downsampled) |
| Max bulk files | 50 per batch |

---

## 10. ONE-PARAGRAPH SUMMARY (memorize this)

*"ACRA is an image accessibility tool that automatically corrects colors in existing images for people with red-green color blindness — specifically Protanopia and Deuteranopia. It works by first simulating how a color-blind viewer perceives the image, then using a neural network to identify meaningful regions, fuzzy clustering to group colors, and perceptual color science to detect which color pairs would be confused. It then applies the smallest possible lightness adjustment to separate those pairs — preserving the original design while making the image objectively more accessible. Every correction is validated against four quantitative metrics including the international WCAG accessibility standard."*

---

*Document prepared for ACRA capstone/panel presentation. Authors: Gallo, Dave Andre A. · Martinez, John Andrei M.*
