"""
segmentation.py
---------------
Gallo, Dave Andre A. — YOLOv8 Semantic Segmentation + Per-ROI FCM

Pipeline:
  1. YOLOv8 detects semantic regions (roi-symbol, roi-color, etc.)
  2. FCM runs *within* each detected region to find color sub-clusters
  3. Sub-clusters feed into the existing conflict-detection and LCH
     re-encoding stages — only targeted poster regions are corrected

Color ROI fallback (HSV red/green thresholding) activates automatically
when YOLO finds nothing, ensuring check/X marks are always captured.

Requires: pip install ultralytics
"""

import numpy as np
from concurrent.futures import ThreadPoolExecutor
from typing import List, Tuple, Optional
from PIL import Image, ImageFilter

try:
    _RESAMPLE_NEAREST = Image.Resampling.NEAREST
except AttributeError:
    _RESAMPLE_NEAREST = Image.NEAREST

_MODEL_CACHE: dict = {}

# Chroma below this marks a pixel/center as near-achromatic (text/ink/paper).
# Kept in sync with reencoding.NEUTRAL_CHROMA so protection is consistent.
_NEUTRAL_CHROMA = 12.0


# ── Model loading ─────────────────────────────────────────────────────────────

def _load_model(model_path: str):
    """Load and cache a YOLOv8 model by path."""
    if model_path not in _MODEL_CACHE:
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise ImportError(
                "YOLOv8 requires the 'ultralytics' package. "
                "Run: pip install ultralytics"
            ) from exc
        _MODEL_CACHE[model_path] = YOLO(model_path)
    return _MODEL_CACHE[model_path]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _bbox_to_mask(box, h: int, w: int) -> np.ndarray:
    """Convert a bounding box to a binary mask (detection-only model fallback)."""
    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    mask = np.zeros((h, w), dtype=np.float32)
    mask[y1:y2, x1:x2] = 1.0
    return mask


def _bbox_to_color_mask(box, img_uint8: np.ndarray) -> np.ndarray:
    """
    Convert a detection-only box into a color-constrained ROI mask.

    Plain rectangular boxes are too broad for re-encoding: background pixels
    inside the box get cluster memberships and can be visibly recolored. This
    keeps only red/green foreground pixels inside the detected box.
    """
    h, w = img_uint8.shape[:2]
    bbox_mask = _bbox_to_mask(box, h, w)
    red_f, green_f = _detect_color_rois(
        img_uint8,
        min_region_frac=0.0,
    )
    color_mask = np.clip(red_f + green_f, 0.0, 1.0)
    return bbox_mask * color_mask


def _soften_mask(mask_f: np.ndarray, radius: float) -> np.ndarray:
    """Feather mask edges using dilation, multi-pass blur, and smoothstep."""
    if radius <= 0:
        return mask_f
    mask_uint8 = (np.clip(mask_f, 0.0, 1.0) * 255).astype(np.uint8)
    mask_pil = Image.fromarray(mask_uint8)
    dilate_px = max(0, int(round(radius * 0.15)))
    if dilate_px > 0:
        kernel = dilate_px * 2 + 1
        mask_pil = mask_pil.filter(ImageFilter.MaxFilter(size=kernel))
    mask_pil = mask_pil.filter(ImageFilter.GaussianBlur(radius=radius))
    mask_pil = mask_pil.filter(ImageFilter.GaussianBlur(radius=radius * 0.6))
    mask_f = np.array(mask_pil, dtype=np.float32) / 255.0
    edge0, edge1 = 0.12, 0.88
    t = np.clip((mask_f - edge0) / (edge1 - edge0), 0.0, 1.0)
    mask_f = t * t * (3.0 - 2.0 * t)
    mask_f = np.power(mask_f, 1.15)
    mask_pil = Image.fromarray((mask_f * 255).astype(np.uint8))
    mask_pil = mask_pil.filter(ImageFilter.GaussianBlur(radius=radius * 0.2))
    return np.array(mask_pil, dtype=np.float32) / 255.0


def _merge_close_centers(centers: np.ndarray, threshold: float = 16.5) -> np.ndarray:
    """
    Merge cluster centers a normal viewer perceives as the same colour.

    A flat colour region (a solid green/red poster cell) gets split by FCM into
    several near-identical sub-clusters. If re-encoding shifts those by even
    slightly different amounts, the per-pixel blend turns the cell into a rough
    patchwork. Collapsing them to one center → one shift → one uniform recolor.

    Centers within `threshold` CIELAB ΔE (CIE76) are unioned and replaced by
    their mean; genuinely different colours (ΔE ≥ threshold) are kept apart.
    """
    n = len(centers)
    if n <= 1:
        return np.asarray(centers, dtype=np.float64)

    parent = list(range(n))

    def _find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(n):
        for j in range(i + 1, n):
            if np.sqrt(((centers[i] - centers[j]) ** 2).sum()) < threshold:
                parent[_find(i)] = _find(j)

    groups: dict = {}
    for i in range(n):
        groups.setdefault(_find(i), []).append(i)
    merged = [np.asarray(centers)[idx].mean(axis=0) for idx in groups.values()]
    return np.array(merged, dtype=np.float64)


def _detect_color_rois(
    img_uint8: np.ndarray,
    red_sat_min: float = 0.35,
    green_sat_min: float = 0.28,
    val_min: float = 0.15,
    min_region_frac: float = 0.003,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    HSV color thresholding fallback — isolates red and green regions.

    Activates when YOLO finds no objects. Directly targets the
    check-mark / X-mark symbols that matter most for CVD on posters.

    Returns
    -------
    red_mask   : float32 (H, W)  1.0 inside red regions
    green_mask : float32 (H, W)  1.0 inside green regions
    """
    h, w = img_uint8.shape[:2]
    img_f = img_uint8.astype(np.float32) / 255.0
    r, g, b = img_f[..., 0], img_f[..., 1], img_f[..., 2]

    cmax  = np.maximum(np.maximum(r, g), b)
    cmin  = np.minimum(np.minimum(r, g), b)
    delta = cmax - cmin

    hue = np.zeros((h, w), dtype=np.float32)
    safe_d = np.where(delta > 0, delta, 1.0)
    is_r = (cmax == r) & (delta > 0)
    is_g = (cmax == g) & (delta > 0) & ~is_r
    is_b = (cmax == b) & (delta > 0) & ~is_r & ~is_g
    hue[is_r] = (60.0 * ((g[is_r] - b[is_r]) / safe_d[is_r])) % 360.0
    hue[is_g] =  60.0 * ((b[is_g] - r[is_g]) / safe_d[is_g] + 2.0)
    hue[is_b] =  60.0 * ((r[is_b] - g[is_b]) / safe_d[is_b] + 4.0)

    sat = np.where(cmax > 1e-6, delta / cmax, 0.0)
    val = cmax

    vivid      = val > val_min
    red_mask   = vivid & (sat > red_sat_min)   & ((hue < 20.0) | (hue > 340.0))
    green_mask = vivid & (sat > green_sat_min) & (hue >= 85.0) & (hue <= 155.0)

    min_px = max(1, int(h * w * min_region_frac))
    if int(red_mask.sum())   < min_px: red_mask   = np.zeros((h, w), dtype=bool)
    if int(green_mask.sum()) < min_px: green_mask = np.zeros((h, w), dtype=bool)

    return red_mask.astype(np.float32), green_mask.astype(np.float32)


# ── YOLO mask extraction ───────────────────────────────────────────────────────

def _get_yolo_masks(
    img_uint8: np.ndarray,
    model_path: str,
    conf_threshold: float,
    soft_edge_radius: float,
    color_fallback: bool,
    imgsz: Optional[int] = None,
) -> Tuple[List[np.ndarray], List[str]]:
    """
    Run YOLO inference and return per-region float32 masks.

    Index 0 is always background. Color ROI fallback appends red/green
    masks when YOLO finds nothing.
    """
    h, w = img_uint8.shape[:2]

    background = np.ones((h, w), dtype=np.float32)
    masks_list: List[np.ndarray] = [background]
    class_names: List[str] = ["background"]

    model   = _load_model(model_path)
    infer_kwargs = {"conf": conf_threshold, "verbose": False}
    if imgsz is not None:
        infer_kwargs["imgsz"] = imgsz
    results = model(img_uint8, **infer_kwargs)[0]

    has_seg = results.masks is not None and len(results.masks) > 0
    has_box = results.boxes is not None and len(results.boxes) > 0

    def _apply_mask(mask_f: np.ndarray, name: str) -> None:
        nonlocal background
        background -= mask_f
        masks_list.append(mask_f)
        class_names.append(name)

    if has_seg:
        raw_masks  = results.masks.data.cpu().numpy()
        class_ids  = results.boxes.cls.cpu().numpy().astype(int)
        id_to_name = results.names
        for mask_arr, cls_id in zip(raw_masks, class_ids):
            class_name = id_to_name.get(int(cls_id), f"class_{cls_id}")
            mask_pil = Image.fromarray(
                (mask_arr * 255).astype(np.uint8)
            ).resize((w, h), _RESAMPLE_NEAREST)
            mask_f = np.array(mask_pil, dtype=np.float32) / 255.0
            mask_f = _soften_mask(mask_f, soft_edge_radius)
            _apply_mask(mask_f, class_name)

    elif has_box:
        class_ids  = results.boxes.cls.cpu().numpy().astype(int)
        id_to_name = results.names
        for box, cls_id in zip(results.boxes, class_ids):
            class_name = id_to_name.get(int(cls_id), f"class_{cls_id}")
            mask_f = _bbox_to_color_mask(box, img_uint8)
            if mask_f.sum() <= 0:
                continue
            mask_f = _soften_mask(mask_f, soft_edge_radius)
            _apply_mask(mask_f, class_name)

    # Color ROI detection — always add red/green areas YOLO did not already
    # cover, so colored cells become their own clusters even when YOLO fires.
    if color_fallback:
        red_f, green_f = _detect_color_rois(img_uint8)
        if len(masks_list) > 1:
            covered = np.clip(
                np.sum(masks_list[1:], axis=0), 0.0, 1.0
            ).astype(np.float32)
            red_f   = np.clip(red_f - covered, 0.0, 1.0)
            green_f = np.clip(green_f - covered, 0.0, 1.0)
        min_px = max(1, int(h * w * 0.003))
        if int(red_f.sum()) >= min_px:
            _apply_mask(red_f,   "red-region (color ROI)")
        if int(green_f.sum()) >= min_px:
            _apply_mask(green_f, "green-region (color ROI)")

    masks_list[0] = np.clip(background, 0.0, 1.0)
    return masks_list, class_names


# ── Main entry point ──────────────────────────────────────────────────────────

def run_yolo_segmentation(
    img_uint8: np.ndarray,
    img_lab: np.ndarray,
    model_path: str = "best.pt",
    conf_threshold: float = 0.25,
    soft_edge_radius: float = 3.0,
    imgsz: Optional[int] = None,
    color_fallback: bool = True,
    require_red_green: bool = True,
    clusters_per_roi: Optional[int] = None,
) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """
    Detect ROIs with YOLOv8, run FCM within each region, then return
    the combined (centers, memberships) for conflict detection and
    LCH re-encoding.

    Flow per detected region
    ------------------------
    mask  →  extract ROI pixels  →  FCM (k sub-clusters)
          →  scale memberships by mask weight
          →  merge into global (N, K_total) membership matrix

    Background pixels (outside all ROIs) get a single center = their
    mean CIELAB color and are not re-encoded unless they conflict.

    Parameters
    ----------
    img_uint8        : (H, W, 3) uint8 RGB
    img_lab          : (H, W, 3) float CIELAB
    model_path       : path to trained .pt weights
    conf_threshold   : YOLO detection confidence cutoff
    soft_edge_radius : Gaussian blur on mask edges for smooth blending
    imgsz            : YOLO inference input size (None = model default, 640)
    color_fallback   : use HSV color ROIs when YOLO finds nothing
    clusters_per_roi : FCM sub-clusters per detected region (None = adaptive)
    require_red_green : bool
        If True, only keep detected ROIs that overlap red or green pixels.

    Returns
    -------
    centers     : (K_total, 3)   mean CIELAB per sub-cluster
    memberships : (N, K_total)   per-pixel weights, rows sum to 1
    class_names : list[str]      label per sub-cluster
    """
    from .fcm import run_fcm, _compute_memberships
    from .auto_clusters import estimate_n_clusters

    h, w = img_uint8.shape[:2]
    n_pixels = h * w
    lab_flat = img_lab.reshape(n_pixels, 3).astype(np.float64)

    masks_list, raw_names = _get_yolo_masks(
        img_uint8, model_path, conf_threshold, soft_edge_radius, color_fallback, imgsz
    )

    # Optional filter: only keep ROIs that overlap red/green pixels.
    if require_red_green and len(masks_list) > 1:
        red_f, green_f = _detect_color_rois(img_uint8)
        keep_masks: List[np.ndarray] = [np.ones((h, w), dtype=np.float32)]
        keep_names: List[str] = ["background"]

        kept_any = False
        for mask_f, name in zip(masks_list[1:], raw_names[1:]):
            overlap = (mask_f * (red_f + green_f)).sum()
            overlap_frac = overlap / max(mask_f.sum(), 1e-6)
            if overlap_frac >= 0.002:
                keep_masks.append(mask_f)
                keep_names.append(name)
                kept_any = True

        if not kept_any:
            keep_masks = [m.copy() for m in masks_list]
            keep_names = list(raw_names)

        # Rebuild background so skipped ROIs are treated as background
        if len(keep_masks) > 1:
            background = np.ones((h, w), dtype=np.float32)
            for mask_f in keep_masks[1:]:
                background -= mask_f
            keep_masks[0] = np.clip(background, 0.0, 1.0)
        masks_list, raw_names = keep_masks, keep_names

    def _process_roi(mask_f, name):
        mask_flat = mask_f.reshape(n_pixels).astype(np.float64)
        total_w   = mask_flat.sum()
        region_center = (
            (lab_flat * mask_flat[:, None]).sum(axis=0) / max(total_w, 1e-6)
        )

        pixel_idx = np.where(mask_flat > 0.15)[0]
        if len(pixel_idx) == 0:
            return region_center[None], mask_flat[:, None], [name]

        # Split ROI pixels into chromatic (the colored cell) and neutral
        # (black/white text, ink, paper). The split only decides which pixels
        # define each cluster *center* — text pixels must not contaminate the
        # colored center, and neutral centers stay near-zero-chroma so
        # reencoding._is_neutral() pins them. Per-pixel memberships are still
        # computed softly against ALL centers further below, so the text/
        # background transition blends smoothly (no hard chroma-threshold step).
        roi_lab    = lab_flat[pixel_idx]
        roi_chroma = np.hypot(roi_lab[:, 1], roi_lab[:, 2])
        chrom_sel  = roi_chroma >= _NEUTRAL_CHROMA
        chrom_idx  = pixel_idx[chrom_sel]
        neut_idx   = pixel_idx[~chrom_sel]

        centers_out: List[np.ndarray] = []
        names_out: List[str] = []

        # ── Chromatic sub-clusters — centers from chromatic pixels only ──────
        if clusters_per_roi is None:
            chrom_pixels = lab_flat[chrom_idx] if len(chrom_idx) else lab_flat[:0]
            target_k = estimate_n_clusters(chrom_pixels, k_min=2, k_max=8)
        else:
            target_k = clusters_per_roi
        min_for_fcm = max(target_k * 10, 30)

        if len(chrom_idx) >= min_for_fcm:
            k = max(2, min(target_k, len(chrom_idx) // 10))
            try:
                roi_centers, _ = run_fcm(lab_flat[chrom_idx], n_clusters=k)
                # Collapse near-identical sub-clusters so a flat colour cell
                # re-encodes as one uniform shift, not a rough patchwork.
                roi_centers = _merge_close_centers(roi_centers)
                centers_out.append(roi_centers)
                names_out.extend(
                    f"{name} #{j + 1}" for j in range(len(roi_centers))
                )
            except Exception:
                # FCM failed — fall back to one mean center over all pixels.
                chrom_idx = pixel_idx
                neut_idx = pixel_idx[:0]

        if not centers_out and len(chrom_idx):
            centers_out.append(lab_flat[chrom_idx].mean(axis=0)[None])
            names_out.append(name)

        # ── Neutral clusters — text/ink (dark) and paper (light), kept apart ─
        if len(neut_idx):
            neut_L = lab_flat[neut_idx, 0]
            for sel, suffix in ((neut_L < 55.0, "text"), (neut_L >= 55.0, "paper")):
                grp = neut_idx[sel]
                if not len(grp):
                    continue
                centers_out.append(lab_flat[grp].mean(axis=0)[None])
                names_out.append(f"{name} ({suffix})")

        if not centers_out:
            return region_center[None], mask_flat[:, None], [name]

        roi_centers_all = np.vstack(centers_out)

        # Soft memberships for EVERY ROI pixel against ALL centers. This is what
        # keeps re-encoding smooth: edge/anti-aliased pixels blend gradually
        # instead of snapping at the chromatic/neutral boundary.
        k_total = roi_centers_all.shape[0]
        full_W = np.zeros((n_pixels, k_total), dtype=np.float64)
        CHUNK = 50000
        for s in range(0, len(pixel_idx), CHUNK):
            idx = pixel_idx[s:s + CHUNK]
            full_W[idx] = (
                _compute_memberships(lab_flat[idx], roi_centers_all, m=2.0)
                * mask_flat[idx, np.newaxis]
            )
        return roi_centers_all, full_W, names_out

    all_centers: List[np.ndarray] = []
    all_weights: List[np.ndarray] = []
    final_names: List[str] = []

    # Background is always index 0 — single cluster, no FCM
    bg_mask_flat = masks_list[0].reshape(n_pixels).astype(np.float64)
    bg_center = (lab_flat * bg_mask_flat[:, None]).sum(axis=0) / max(bg_mask_flat.sum(), 1e-6)
    all_centers.append(bg_center[None])
    all_weights.append(bg_mask_flat[:, None])
    final_names.append(raw_names[0])

    # ROIs: each FCM run is independent — process in parallel
    roi_pairs = list(zip(masks_list[1:], raw_names[1:]))
    if roi_pairs:
        with ThreadPoolExecutor(max_workers=2) as _ex:
            futures = [_ex.submit(_process_roi, mf, nm) for mf, nm in roi_pairs]
        for fut in futures:
            roi_centers, roi_W, roi_names = fut.result()
            all_centers.append(roi_centers)
            all_weights.append(roi_W)
            final_names.extend(roi_names)

    # Combine all regions into flat arrays
    centers = np.vstack(all_centers)                      # (K_total, 3)
    W       = np.hstack(all_weights).astype(np.float32)  # (N, K_total)

    # Normalize rows so every pixel's weights sum to 1
    row_sum = W.sum(axis=1, keepdims=True).clip(min=1e-6)
    W /= row_sum

    return centers, W, final_names
