# CVD Re-Encoding Pipeline â€” Full Summary

> **Goal:** Make images more accessible for people with Color Vision Deficiency (CVD) â€”
> specifically **protanopia** (red-blind) and **deuteranopia** (green-blind) â€” by detecting
> color pairs that become indistinguishable under CVD and fixing them via lightness adjustment,
> while preserving the image's natural appearance.

---

## Full Data Flow

```
sRGB image (uint8)
    â”‚
    â–¼  Stage 1 â€” Load + auto-downsample (cap at 1.5M pixels)
Linear RGB (float32)
    â”‚
    â”œâ”€â”€â–¶  Stage 2 â€” CVD Simulate â†’ simulated sRGB  (for display only)
    â”‚
    â–¼  Stage 3 â€” CIELAB conversion
CIELAB image  [L*, a*, b*]
    â”‚
    â–¼  Stage 4 â€” Auto-estimate cluster count k
    â”‚
    â–¼  Stage 5 â€” Fuzzy C-Means â†’ centers (K,3)  +  memberships W (N,K)
    â”‚
    â–¼  Stage 6 â€” Conflict detection â†’ list of (i,j) conflict pairs
    â”‚
    â–¼  Stage 7 â€” Re-encoding (Guarded Lightness Reprojection) â†’ modified_centers (K,3)
    â”‚
    â–¼  Stage 8 â€” IDW blend â†’ corrected CIELAB â†’ sRGB uint8
    â”‚
    â–¼  Stage 9 â€” Metrics validation
Corrected image  +  metrics dict
```

---

## Stage 1 â€” [Image Load & Pre-processing](code/pipeline/__init__.py#L128)
**File:** [pipeline/__init__.py â€” `run_full_pipeline()` L128](code/pipeline/__init__.py#L128)

- Accepts a file path or a raw `uint8` RGB NumPy array.
- **Auto-downsamples** images larger than 1.5 M pixels (e.g. 4 K photos) for speed,
  then bicubic-upscales the corrected result back to original dimensions at the end.
- Converts sRGB uint8 â†’ **linear float32 RGB** by inverting the sRGB gamma curve:

  ```
  linear = ((sRGB + 0.055) / 1.055) ^ 2.4   for sRGB > 0.04045
  linear = sRGB / 12.92                       otherwise
  ```

---

## Stage 2 â€” [CVD Simulation](code/pipeline/cvd_simulation.py#L61)
**File:** [pipeline/cvd_simulation.py â€” `simulate_cvd()` L61 Â· `get_simulation_matrix()` L114](code/pipeline/cvd_simulation.py#L61)

Implements the **Machado et al. (2009)** severity-interpolated model.

**Steps:**
1. Linear RGB â†’ **LMS cone space** via the Hunt-Pointer-EstÃ©vez D65 matrix.
2. Apply a severity-blended deficiency matrix:
   ```
   M_sim(s) = (1 - s) * I  +  s * M_deficiency
   ```
   - `s = 0` â†’ normal vision (identity)
   - `s = 1` â†’ full dichromacy
   - **Protanopia matrix:** L-cone row replaced by M-cone (`L' = M`)
   - **Deuteranopia matrix:** M-cone row derived from residual L and S channels
3. LMS_sim â†’ back to Linear RGB â†’ reapply sRGB gamma for display.

> This stage produces the "how a CVD user sees the image" preview. It is also used
> internally whenever cluster centers need to be evaluated through CVD.

---

## Stage 3 â€” [CIELAB Conversion](code/pipeline/cielab.py#L46)
**File:** [pipeline/cielab.py â€” `to_cielab()` L46 Â· `from_cielab()` L87](code/pipeline/cielab.py#L46)

Converts linear RGB â†’ **CIELAB**, a perceptually uniform color space where equal
numerical distances correspond to equal perceived color differences.

**Steps:**
1. Linear RGB â†’ **XYZ** using the standard sRGB primary matrix (D65).
2. Normalize XYZ by the D65 white point `(Xn=0.95047, Yn=1.0, Zn=1.08883)`.
3. Apply the CIELAB nonlinear function `f(t) = cbrt(t)` (with a linear tail for near-zero).
4. Compute:
   - `L* = 116Â·f(Y/Yn) âˆ’ 16`          â€” lightness (0â€“100)
   - `a* = 500Â·(f(X/Xn) âˆ’ f(Y/Yn))`  â€” red (+) / green (âˆ’) axis
   - `b* = 200Â·(f(Y/Yn) âˆ’ f(Z/Zn))`  â€” yellow (+) / blue (âˆ’) axis

---

## Stage 4 â€” [Auto Cluster Count Estimation](code/pipeline/auto_clusters.py#L197)
**File:** [pipeline/auto_clusters.py â€” `estimate_n_clusters()` L197](code/pipeline/auto_clusters.py#L197)

When the user does not specify `n_clusters`, this stage automatically determines the
best `k` in three phases:

### [Phase 1 â€” Histogram Lower Bound](code/pipeline/auto_clusters.py#L153)
- Bins the CIELAB pixel data into a coarse **3D histogram** (12 bins per axis).
- Counts occupied cells â†’ rough lower bound for meaningful clusters.

### [Phase 2 â€” Silhouette Scan](code/pipeline/auto_clusters.py#L256)
- Runs lightweight **[mini-batch k-means](code/pipeline/auto_clusters.py#L31)** for candidate `k` values around the histogram estimate.
- Scores each `k` with an **[approximate silhouette metric](code/pipeline/auto_clusters.py#L92)** (sample-based, O(NÂ·K)).
- Applies a mild complexity penalty above `k = 8` to favor simpler models.
- Picks the `k` with the best adjusted score.

### [Phase 3 â€” Red/Green Chroma Bonus](code/pipeline/auto_clusters.py#L292)
- Computes the fraction of pixels with significant `a*` activity via **[`_red_green_energy_ratio()`](code/pipeline/auto_clusters.py#L177)** (`|a*| > 20` and chroma > 25).
- If â‰¥ 5% of pixels are red/green active â†’ enforces a floor of at least 4 clusters.
- If â‰¥ 15% â†’ adds a proportional bonus to capture fine CVD-critical distinctions.

Result is clamped to `[k_min, effective_k_max]`, where `effective_k_max = sqrt(pixels) / 8`.

---

## Stage 5 â€” [Fuzzy C-Means Clustering](code/pipeline/fcm.py#L135)
**File:** [pipeline/fcm.py â€” `run_fcm()` L135](code/pipeline/fcm.py#L135)

Clusters all image pixels in CIELAB space using **Fuzzy C-Means (FCM)**.

**Why fuzzy (soft) clustering?**
Edge pixels belong partially to multiple clusters, so the blended correction
in Stage 8 produces seamless, artifact-free output.

**Parameters:** `m = 2` (fuzziness), `Îµ = 0.001` (convergence), `max_iter = 100`

**Steps:**
1. **[k-means++ initialization](code/pipeline/fcm.py#L56)** (vectorized) â€” picks initial centers with probability
   proportional to squared distance, reducing sensitivity to random starts.
2. For large images (> 50k pixels): FCM runs on a **random 50k-pixel subsample** to
   find centers, then full-image memberships are computed in 50k-pixel chunks.
3. **[Membership update rule](code/pipeline/fcm.py#L84)** (fully vectorized):
   ```
   w_ij = 1 / Î£_k (||x_i - c_j|| / ||x_i - c_k||)^(2/(m-1))
   ```
4. **[Center update rule](code/pipeline/fcm.py#L118):**
   ```
   c_j = Î£_i w_ij^m * x_i  /  Î£_i w_ij^m
   ```
5. Iterate until `max |Î”W| < 0.001` or 100 iterations.

**Returns:** `centers (K, 3)` and `memberships W (N, K)` where each row sums to 1.

---

## Stage 6 â€” [Conflict Detection](code/pipeline/conflict.py#L130)
**File:** [pipeline/conflict.py â€” `detect_conflicts()` L130](code/pipeline/conflict.py#L130)

Identifies which cluster pairs perceptually **collapse** (become indistinguishable)
under CVD simulation.

**For every pair `(i, j)` of cluster centers:**
1. Simulate both centers through the CVD matrix.
2. Compute **CIEDE2000** `Î”E` between the simulated pair.
3. Flag as a **conflict** if:
   - `Î”E_simulated < 20`  (indistinguishable under CVD), **AND**
   - `Î”E_original â‰¥ 12`   (were distinguishable to normal vision â€” rules out two near-identical colors)

**Two Î”E formulas available:**
- **[CIEDE2000](code/pipeline/conflict.py#L39)** â€” perceptually accurate, used for final conflict detection.
  Accounts for hue rotation near blues, chroma-dependent weighting, and a
  rotation term to handle the blue-to-purple region.
- **[CIE76](code/pipeline/conflict.py#L29)** â€” simple Euclidean CIELAB distance, used in fast/real-time mode.

Only the returned conflict pairs are passed to Stage 7.

---

## Stage 7 â€” [Re-encoding (Guarded Lightness Reprojection)](code/pipeline/reencoding.py#L26)
**File:** [pipeline/reencoding.py â€” `reencode()` L26](code/pipeline/reencoding.py#L26)

The core correction algorithm. For each conflict pair, pushes the two cluster centers
apart in **lightness (L\*)** with four guardrails to prevent unnatural results.

### [Assignment Rule (Red/Green-Aware)](code/pipeline/reencoding.py#L88)
For each pair, decide which center goes **dark** and which goes **light**:
- **Red center** (`a* > 10`, chroma > 15) â†’ push dark
- **Green center** (`a* < âˆ’10`, chroma > 15) â†’ push light
- Neither has clear red/green character â†’ push apart by existing lightness order

### [Guardrail 1 â€” Lightness Floor & Ceiling Per Center](code/pipeline/reencoding.py#L49)
- **Neutrals** (chroma < 15): floor = `max(orig_L âˆ’ 15, 15)` â€” protect greys from crushing to black.
- **Chromatic**: floor = `max(orig_L âˆ’ 25, 5)` â€” more room to shift.
- **Ceiling** for all: `min(85, orig_L + 25)` â€” don't bleach chromatic colors.

### [Guardrail 2 â€” Naturalness Budget](code/pipeline/reencoding.py#L70)
Each center accumulates a drift counter. Once it reaches `MAX_DRIFT = 25.0` total `|Î”L|`
across all conflict pairs, no further shifts are applied to that center.

### [Guardrail 3 â€” Adaptive Step Size](code/pipeline/reencoding.py#L74)
Centers involved in many conflicts get smaller steps:
- Dark step: `4.0 / min(conflict_count, 5)`
- Light step: `2.0 / min(conflict_count, 5)`

### [Stopping Condition (per pair, up to 30 iterations)](code/pipeline/reencoding.py#L126)
Stop early when **both** are satisfied:
- `Î”E_CIEDE2000 â‰¥ 20.5` in simulated space

---

## Stage 8 â€” [IDW Blend Reconstruction](code/pipeline/__init__.py#L251)
**File:** [pipeline/__init__.py â€” reconstruction block L251](code/pipeline/__init__.py#L251)

Applies the cluster lightness shifts back to **every pixel** using soft membership blending:

```
corrected_pixel = original_pixel  +  W @ shifts
```

Where:
- `W` = fuzzy membership matrix `(N, K)`
- `shifts = modified_centers âˆ’ original_centers`  `(K, 3)`

This is equivalent to **inverse-distance-weighted interpolation** in CIELAB space.
Edge pixels that belong partially to multiple clusters receive a smoothly blended
correction â€” no hard boundaries or visible artifacts.

The corrected CIELAB array is then converted back to sRGB uint8 for output.

---

## Stage 9 â€” [Metrics Validation](code/pipeline/metrics.py#L63)
**File:** [pipeline/metrics.py â€” `compute_metrics()` L63 Â· `run_validation_suite()` L212](code/pipeline/metrics.py#L63)

Validates the correction against three targets:

| Metric | Target | What it measures |
|---|---|---|
| **Î”E Improvement** | > 15 mean | Average perceptual separation gained on conflicting pairs in simulated space |
| **Conflict Resolution Rate** | > 80% | Fraction of pre-existing conflicts that are now resolved |
| **Naturalness Preservation** | < 12 mean Î”E | How much original cluster colors drifted (lower = more natural) |

A result **passes** the Î”E improvement check if:
- No conflicts existed (image was already accessible), OR
- Raw Î”E improvement > 15, OR
- All conflict pairs are now perceptually distinct (Î”E_after â‰¥ 20)

---

## Key Design Decisions

| Decision | Reason |
|---|---|
| CIELAB color space throughout | Perceptually uniform â€” Î”E numbers are meaningful |
| Fuzzy (soft) clustering | Seamless pixel reconstruction at color boundaries |
| k-means++ initialization | Stable, repeatable cluster centers regardless of random seed |
| Lightness-only correction | Preserves hue and chroma â€” keeps colors looking "natural" |
| CIEDE2000 for validation | Most perceptually accurate Î”E formula available |
| Subsample FCM on large images | Keeps runtime under target regardless of image resolution |
| Severity interpolation `(1-s)Â·I + sÂ·M` | Handles partial CVD, not just full dichromacy |
