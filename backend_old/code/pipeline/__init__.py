"""
pipeline/__init__.py — float32-optimized full pipeline
Performance targets:
  420×420   : < 1s
  1920×1080 : < 4s
  3300×2550 : < 10s
"""
import numpy as np
from typing import Callable, Tuple, Dict, Optional
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

try:
    _RESAMPLE_NEAREST = Image.Resampling.NEAREST
except AttributeError:
    _RESAMPLE_NEAREST = Image.NEAREST

from .cvd_simulation import simulate_cvd, get_simulation_matrix
from .fcm import run_fcm
from .conflict import detect_conflicts
from .reencoding import reencode, enforce_rg_separation, _simulate_lab_center
from .metrics import compute_metrics
from .auto_clusters import estimate_n_clusters


def _srgb_to_linear_clahe_f32(img_uint8):
    img = img_uint8.astype(np.float32) / 255.0
    return np.where(img <= 0.04045, img / 12.92,
                    ((img + 0.055) / 1.055) ** 2.4).astype(np.float32)


def _srgb_to_linear_orig_f32(img_uint8):
    img = img_uint8.astype(np.float32) / 255.0
    return np.where(img <= 0.04045, img / 12.92,
                    ((img + 0.055) / 1.055) ** 2.4).astype(np.float32)


def _linear_to_lab_f32(linear):
    M = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]], dtype=np.float32)
    shape = linear.shape
    flat = linear.reshape(-1, 3).astype(np.float32)
    xyz = flat @ M.T
    xyz[:, 0] /= 0.95047; xyz[:, 1] /= 1.00000; xyz[:, 2] /= 1.08883
    d3 = float((6/29)**3); d23 = float(3*(6/29)**2)
    fxyz = np.where(xyz > d3, np.cbrt(xyz), xyz / d23 + 4/29).astype(np.float32)
    L = 116*fxyz[:,1]-16; a = 500*(fxyz[:,0]-fxyz[:,1]); b = 200*(fxyz[:,1]-fxyz[:,2])
    return np.stack([L, a, b], -1).reshape(shape)


def _lab_to_srgb_f32(lab):
    M = np.array([[3.2404542,-1.5371385,-0.4985314],
                  [-0.9692660, 1.8760108, 0.0415560],
                  [ 0.0556434,-0.2040259, 1.0572252]], dtype=np.float32)
    shape = lab.shape
    flat = lab.reshape(-1, 3).astype(np.float32)
    fy=(flat[:,0]+16)/116; fx=flat[:,1]/500+fy; fz=fy-flat[:,2]/200
    d23 = float(3*(6/29)**2); d = 6/29
    def fi(t): return np.where(t > d, t**3, d23*(t-4/29))
    X=fi(fx)*0.95047; Y=fi(fy)*1.00000; Z=fi(fz)*1.08883
    lin = np.clip(np.stack([X,Y,Z],-1).astype(np.float32) @ M.T, 0.0, 1.0)
    srgb = np.where(lin<=0.0031308, lin*12.92, 1.055*lin**(1/2.4)-0.055)
    return np.clip(srgb, 0.0, 1.0).astype(np.float32).reshape(shape)


def _resize_rgb_uint8(img: np.ndarray, size: Tuple[int, int], resample: int) -> np.ndarray:
    """Resize an RGB uint8 image with Pillow and return a NumPy array."""
    return np.array(Image.fromarray(img).resize(size, resample=resample), dtype=np.uint8)


def _resize_lab_f32(lab: np.ndarray, size: Tuple[int, int], resample: int) -> np.ndarray:
    """Resize a float32 LAB image with Pillow and return a NumPy array."""
    channels = []
    for idx in range(3):
        channel = Image.fromarray(lab[..., idx].astype(np.float32))
        channel = channel.resize(size, resample=resample)
        channels.append(np.array(channel, dtype=np.float32))
    return np.stack(channels, axis=-1)




def _build_cluster_overlay(
    memberships: np.ndarray,
    centers: np.ndarray,
    shape: Tuple[int, int],
    output_size: Tuple[int, int],
    alpha: int = 122,
) -> Tuple[np.ndarray, list]:
    """Build an RGBA cluster-label overlay and compact legend metadata using actual colors."""
    h, w = shape
    labels = np.argmax(memberships, axis=1).reshape(h, w).astype(np.uint8)
    n_clusters = memberships.shape[1]
    
    # Convert centers (CIELAB) to sRGB uint8
    centers_srgb_f32 = _lab_to_srgb_f32(centers.astype(np.float32))
    colors = np.clip(centers_srgb_f32 * 255.0, 0, 255).astype(np.uint8)

    if output_size != (w, h):
        labels = np.array(
            Image.fromarray(labels).resize(output_size, resample=_RESAMPLE_NEAREST),
            dtype=np.uint8,
        )

    overlay = np.zeros((labels.shape[0], labels.shape[1], 4), dtype=np.uint8)
    overlay[..., :3] = colors[labels]
    overlay[..., 3] = alpha

    counts = np.bincount(labels.reshape(-1), minlength=n_clusters)
    total = max(1, int(counts.sum()))
    legend = [
        {
            "index": int(i + 1),
            "color": f"#{int(colors[i, 0]):02x}{int(colors[i, 1]):02x}{int(colors[i, 2]):02x}",
            "percent": float(counts[i] / total * 100.0),
        }
        for i in range(n_clusters)
    ]
    return overlay, legend


def run_full_pipeline(
    image_input,
    severity: float,
    cvd_type: str,
    n_clusters: int = None,
    progress_callback: Optional[Callable[[int, str, str], None]] = None,
    use_segmentation: bool = True,
    seg_model: str = "best.pt",
    seg_conf: float = 0.25,
    seg_soft: float = 3.5,
    seg_imgsz: Optional[int] = None,
    seg_clusters_per_roi: Optional[int] = None,
    conflict_max_clusters: Optional[int] = 40,
    seg_require_red_green: bool = True,
    max_proc_pixels: int = 900_000,
    fast_conflicts: bool = True,
    compute_validation_metrics: bool = True,
    target_de: float = 28.0,
    target_rg_l_gap: float = 30.0,
    allow_chroma_shift: bool = True,
    max_delta_l: float = 46.0,
    max_delta_chroma: float = 10.0,
    refinement_passes: int = 2,
) -> Tuple[np.ndarray, Dict]:
    """
    Full CVD re-encoding pipeline (float32 optimized).

    Parameters
    ----------
    image_input : str path or uint8 RGB ndarray
    severity    : float [0,1]
    cvd_type    : 'deutan' or 'protan'

    Returns
    -------
    corrected_srgb : uint8 ndarray
    metrics        : dict
    """
    def report(percent: int, title: str, detail: str = "") -> None:
        if progress_callback is not None:
            progress_callback(percent, title, detail)

    # Per-stage timing — surfaced via metrics['_stage_timings'] for profiling.
    import time as _time
    _timings: Dict[str, float] = {}
    _t_mark = [_time.perf_counter()]

    def _lap(stage: str) -> None:
        now = _time.perf_counter()
        _timings[stage] = _timings.get(stage, 0.0) + (now - _t_mark[0])
        _t_mark[0] = now

    # Stage 1: load
    import math
    report(5, "Loading image", "Preparing the uploaded image for processing.")
    if isinstance(image_input, str):
        try:
            img_uint8 = np.array(Image.open(image_input).convert("RGB"), dtype=np.uint8)
        except Exception as exc:
            raise FileNotFoundError(image_input) from exc
    elif isinstance(image_input, np.ndarray) and image_input.dtype == np.uint8:
        img_uint8 = image_input
    else:
        raise TypeError(f"Expected str or uint8 ndarray")

    orig_h, orig_w = img_uint8.shape[:2]

    # Auto-downsample large images for speed. Cap at 1.5M pixels for processing.
    # Corrected output is bicubic-upscaled back to original dimensions.
    n_orig = orig_h * orig_w
    if n_orig > max_proc_pixels:
        scale  = math.sqrt(max_proc_pixels / n_orig)
        proc_w = max(1, int(orig_w * scale))
        proc_h = max(1, int(orig_h * scale))
        img_proc = _resize_rgb_uint8(img_uint8, (proc_w, proc_h), Image.Resampling.BOX)
    else:
        img_proc = img_uint8

    _lap("load")

    report(12, "Normalizing image", "Converting sRGB values to linear RGB.")
    
    def _compute_high_res_lab(img):
        return _linear_to_lab_f32(_srgb_to_linear_orig_f32(img))

    with ThreadPoolExecutor(max_workers=2) as _ex:
        # Submit high-res orig computation in background
        future_img_lab_orig_hr = _ex.submit(_compute_high_res_lab, img_uint8)
        
        # Concurrently compute downscaled CLAHE
        future_linear_clahe = _ex.submit(_srgb_to_linear_clahe_f32, img_proc)
        img_linear_clahe = future_linear_clahe.result()
        _lap("normalize")

        # Stage 2 + 3: CVD simulation and CIELAB conversion (run concurrently)
        report(22, "Simulating CVD perception", "Applying the Machado color vision deficiency model.")
        future_sim_srgb = _ex.submit(simulate_cvd, img_linear_clahe, severity, cvd_type)
        future_lab_clahe = _ex.submit(_linear_to_lab_f32, img_linear_clahe)
        
        img_sim_srgb = future_sim_srgb.result()
        img_lab_clahe = future_lab_clahe.result()

    # Upsample simulation back to original size if needed
    if n_orig > max_proc_pixels:
        sim_uint8 = (np.clip(img_sim_srgb, 0, 1) * 255).astype(np.uint8)
        sim_uint8 = _resize_rgb_uint8(sim_uint8, (orig_w, orig_h), Image.Resampling.BICUBIC)
        img_sim_srgb = sim_uint8.astype(np.float32) / 255.0
    _lap("cvd_sim + cielab")

    report(32, "Converting color space", "Mapping image colors into CIELAB for perceptual comparison.")

    # Stage 4: Clustering — FCM (color-based) or YOLOv8 (semantic)
    h, w = img_lab_clahe.shape[:2]
    n_pixels = h * w
    seg_class_names = None

    if use_segmentation:
        report(42, "Running semantic segmentation", "Detecting objects with YOLOv8.")
        from .segmentation import run_yolo_segmentation
        centers, W, seg_class_names = run_yolo_segmentation(
            img_uint8=img_proc,
            img_lab=img_lab_clahe,
            model_path=seg_model,
            conf_threshold=seg_conf,
            soft_edge_radius=seg_soft,
            imgsz=seg_imgsz,
            require_red_green=seg_require_red_green,
            clusters_per_roi=seg_clusters_per_roi,
        )
        actual_clusters = len(centers)
        report(60, "Segmentation complete", f"Found {actual_clusters} semantic regions.")
    else:
        if n_pixels < 32 * 32:
            actual_clusters = 3  # tiny images (icons)
        elif n_clusters is None:
            report(42, "Estimating cluster count", "Analyzing image color complexity.")
            actual_clusters = estimate_n_clusters(img_lab_clahe)
        else:
            actual_clusters = n_clusters
        report(50, "Clustering colors", f"Running Fuzzy C-Means with {actual_clusters} clusters.")
        centers, W = run_fcm(img_lab_clahe, n_clusters=actual_clusters)

    cluster_overlay, cluster_legend = _build_cluster_overlay(
        W,
        centers,
        (h, w),
        (orig_w, orig_h),
    )

    # Enrich legend with semantic class labels when YOLOv8 is used
    if seg_class_names is not None:
        for i, item in enumerate(cluster_legend):
            if i < len(seg_class_names):
                item["label"] = seg_class_names[i]

    cluster_weights = W.astype(np.float64).sum(axis=0)
    cluster_weights /= max(float(cluster_weights.sum()), 1e-6)
    _lap("segmentation/clustering")

    # Stage 5: conflict detection
    report(64, "Detecting color conflicts", "Checking which color clusters collapse under CVD simulation.")
    sim_matrix  = get_simulation_matrix(severity, cvd_type)
    sim_centers = _simulate_lab_center(centers, sim_matrix)
    conflicts   = detect_conflicts(
        centers,
        sim_centers,
        cvd_type,
        use_fast=fast_conflicts,
        max_clusters=conflict_max_clusters,
        cluster_weights=cluster_weights,
    )
    if len(conflicts) > 40:
        conflicts = conflicts[:40]
    _lap("conflict_detection")

    # Stage 6: re-encoding
    report(74, "Re-encoding conflicts", f"Optimizing {len(conflicts)} conflicting cluster pairs.")
    mod_centers = reencode(
        centers,
        conflicts,
        severity,
        cvd_type,
        use_fast=fast_conflicts,
        target_de=target_de,
        target_rg_l_gap=target_rg_l_gap,
        allow_chroma_shift=allow_chroma_shift,
        max_delta_l=max_delta_l,
        max_delta_chroma=max_delta_chroma,
        refinement_passes=refinement_passes,
    )
    # Deterministic safety net — guarantee green reads lighter than red even
    # when the conflict-detection guards skipped the pair.
    mod_centers = enforce_rg_separation(mod_centers, target_gap=target_rg_l_gap)
    _lap("reencoding")

    # Stage 7: IDW-weighted shift reconstruction
    report(82, "Reconstructing image", "Blending modified cluster colors back into every pixel.")
    shifts     = (mod_centers - centers).astype(np.float32)
    # Only apply the L* component of the shift to pixels.
    # The re-encoding is designed as lightness-only correction; a*/b* deltas
    # from chroma scaling or center drift create visible hue shifts on small
    # regions (green checkmarks).  Retain a small fraction of the chromatic
    # shift so intentional chroma boosts are not fully lost.
    _CHROMA_SHIFT_RETAIN = 0.15   # keep 15% of a*/b* shift
    shifts[:, 1] *= _CHROMA_SHIFT_RETAIN
    shifts[:, 2] *= _CHROMA_SHIFT_RETAIN
    W_sharp    = W.astype(np.float32) ** 3
    W_sharp   /= W_sharp.sum(axis=1, keepdims=True).clip(1e-6, None)
    
    # Calculate pixel shifts at the processing resolution
    pixel_shifts_flat = W_sharp @ shifts
    proc_h, proc_w = img_lab_clahe.shape[:2]
    pixel_shifts = pixel_shifts_flat.reshape(proc_h, proc_w, 3)
    
    # Upscale only the shift map to preserve high-frequency details from original image
    if n_orig > max_proc_pixels:
        pixel_shifts = _resize_lab_f32(pixel_shifts, (orig_w, orig_h), Image.Resampling.BICUBIC)
        
    img_lab_orig = future_img_lab_orig_hr.result()
    corrected_lab = img_lab_orig + pixel_shifts

    corrected_lab_full = corrected_lab
    _lap("reconstruction")

    # Stage 8: LAB → sRGB uint8
    report(88, "Converting output", "Returning corrected CIELAB colors to display-ready sRGB.")
    corrected_srgb = (_lab_to_srgb_f32(corrected_lab_full) * 255).astype(np.uint8)
    _lap("lab_to_srgb")

    # Stage 9: metrics
    report(94, "Computing validation metrics", "Measuring conflict resolution and naturalness.")
    if compute_validation_metrics:
        metrics = compute_metrics(
            img_lab_orig.astype(np.float64), corrected_lab.astype(np.float64),
            severity, cvd_type,
            centers_orig=centers, centers_sim=sim_centers, centers_corr=mod_centers,
            cluster_weights=cluster_weights,
            use_fast=fast_conflicts,
        )
    else:
        metrics = {}
    _lap("metrics")
    metrics['_sim_srgb'] = img_sim_srgb
    metrics['auto_clusters'] = actual_clusters
    metrics['cluster_overlay_uint8'] = cluster_overlay
    metrics['cluster_legend'] = cluster_legend
    metrics['_stage_timings'] = _timings
    if seg_class_names is not None:
        metrics['seg_class_names'] = seg_class_names
    return corrected_srgb, metrics
