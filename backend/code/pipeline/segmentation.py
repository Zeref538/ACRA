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
from typing import List, Tuple
from PIL import Image, ImageFilter

_MODEL_CACHE: dict = {}


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
    results = model(img_uint8, conf=conf_threshold, verbose=False)[0]

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
            mask_pil = Image.fromarray(
                (mask_arr * 255).astype(np.uint8)
            ).resize((w, h), Image.Resampling.NEAREST)
            if soft_edge_radius > 0:
                mask_pil = mask_pil.filter(
                    ImageFilter.GaussianBlur(radius=soft_edge_radius)
                )
            _apply_mask(
                np.array(mask_pil, dtype=np.float32) / 255.0,
                id_to_name.get(int(cls_id), f"class_{cls_id}"),
            )

    elif has_box:
        class_ids  = results.boxes.cls.cpu().numpy().astype(int)
        id_to_name = results.names
        for box, cls_id in zip(results.boxes, class_ids):
            mask_f = _bbox_to_mask(box, h, w)
            if soft_edge_radius > 0:
                mask_pil = Image.fromarray((mask_f * 255).astype(np.uint8))
                mask_pil = mask_pil.filter(
                    ImageFilter.GaussianBlur(radius=soft_edge_radius)
                )
                mask_f = np.array(mask_pil, dtype=np.float32) / 255.0
            _apply_mask(mask_f, id_to_name.get(int(cls_id), f"class_{cls_id}"))

    # Color ROI fallback when YOLO found nothing
    if color_fallback and len(masks_list) == 1:
        red_f, green_f = _detect_color_rois(img_uint8)
        if red_f.sum() > 0:
            _apply_mask(red_f,   "red-region (color ROI)")
        if green_f.sum() > 0:
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
    color_fallback: bool = True,
    clusters_per_roi: int = 3,
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
    color_fallback   : use HSV color ROIs when YOLO finds nothing
    clusters_per_roi : FCM sub-clusters per detected region (default 3)

    Returns
    -------
    centers     : (K_total, 3)   mean CIELAB per sub-cluster
    memberships : (N, K_total)   per-pixel weights, rows sum to 1
    class_names : list[str]      label per sub-cluster
    """
    from .fcm import run_fcm

    h, w = img_uint8.shape[:2]
    n_pixels = h * w
    lab_flat = img_lab.reshape(n_pixels, 3).astype(np.float64)

    masks_list, raw_names = _get_yolo_masks(
        img_uint8, model_path, conf_threshold, soft_edge_radius, color_fallback
    )

    all_centers: List[np.ndarray] = []
    all_weights: List[np.ndarray] = []
    final_names: List[str] = []

    for i, (mask_f, name) in enumerate(zip(masks_list, raw_names)):
        mask_flat = mask_f.reshape(n_pixels).astype(np.float64)
        total_w   = mask_flat.sum()

        # Weighted mean CIELAB center for this region
        region_center = (
            (lab_flat * mask_flat[:, None]).sum(axis=0) / max(total_w, 1e-6)
        )

        if i == 0:
            # Background — single cluster, no FCM
            all_centers.append(region_center[None])
            all_weights.append(mask_flat[:, None])
            final_names.append(name)
            continue

        # Pixels meaningfully inside this ROI
        pixel_idx = np.where(mask_flat > 0.05)[0]
        min_for_fcm = max(clusters_per_roi * 10, 30)

        if len(pixel_idx) < min_for_fcm:
            # Too small for FCM — single center
            all_centers.append(region_center[None])
            all_weights.append(mask_flat[:, None])
            final_names.append(name)
            continue

        # Run FCM on ROI pixels
        roi_pixels = lab_flat[pixel_idx]
        k = min(clusters_per_roi, len(pixel_idx) // 10)
        k = max(2, k)

        try:
            roi_centers, roi_W = run_fcm(roi_pixels, n_clusters=k)
        except Exception:
            # FCM failed — fall back to single center
            all_centers.append(region_center[None])
            all_weights.append(mask_flat[:, None])
            final_names.append(name)
            continue

        # Scale FCM memberships by the ROI mask weight at each pixel
        # so pixels near the mask edge contribute proportionally
        full_W = np.zeros((n_pixels, k), dtype=np.float64)
        full_W[pixel_idx] = roi_W * mask_flat[pixel_idx, np.newaxis]

        all_centers.append(roi_centers)           # (k, 3)
        all_weights.append(full_W)                # (N, k)
        for j in range(k):
            final_names.append(f"{name} #{j + 1}")

    # Combine all regions into flat arrays
    centers = np.vstack(all_centers)                      # (K_total, 3)
    W       = np.hstack(all_weights).astype(np.float32)  # (N, K_total)

    # Normalize rows so every pixel's weights sum to 1
    row_sum = W.sum(axis=1, keepdims=True).clip(min=1e-6)
    W /= row_sum

    return centers, W, final_names
