"""
reconstruction.py
-----------------
Martinez, John Andrei M. — Track A, Martinez Stage 2

Reconstructs the full image after cluster centers are modified.
Uses cached FCM membership weights for smooth, seamless blending.

For every pixel p in the ROI:
    p'_lab = Σⱼ wₚⱼᵐ × c'ⱼ  /  Σⱼ wₚⱼᵐ

The denominator normalization is CRITICAL — wₚⱼᵐ (m=2) does NOT
sum to 1 across clusters, so omitting it causes systematically
dark output.
"""

import numpy as np
from PIL import Image
from .cielab import from_cielab, linear_to_srgb


def reconstruct(
    roi_lab: np.ndarray,
    modified_centers: np.ndarray,
    memberships: np.ndarray,
    m: float = 2.0
) -> np.ndarray:
    """
    Reconstruct a corrected ROI using modified cluster centers
    and cached FCM membership weights.

    Parameters
    ----------
    roi_lab : np.ndarray
        Original ROI in CIELAB, shape (H, W, 3).
        Used only for shape reference — pixel values come from cluster blending.
    modified_centers : np.ndarray, shape (K, 3)
        Modified cluster centers from reencode(), in CIELAB.
    memberships : np.ndarray, shape (N_pixels, K)
        Cached membership matrix from run_fcm().
        DO NOT re-run FCM — use the original memberships.
    m : float
        Fuzziness parameter (must match FCM run, default 2.0).

    Returns
    -------
    np.ndarray
        Corrected ROI in CIELAB, shape (H, W, 3).
        Convert to sRGB using lab_to_srgb() from cielab.py.
    """
    shape = roi_lab.shape  # (H, W, 3)
    h, w = shape[0], shape[1]
    n_pixels = h * w
    n_clusters = modified_centers.shape[0]

    # Validate shapes
    if memberships.shape[0] != n_pixels:
        raise ValueError(
            f"Membership matrix rows ({memberships.shape[0]}) must equal "
            f"pixel count ({n_pixels}). Did you pass the right ROI?"
        )

    # ── Weighted blending with membership^m ───────────────────────────────
    # Wm: shape (N_pixels, K)
    Wm = memberships.astype(np.float64) ** m

    # Numerator: Σⱼ wₚⱼᵐ × c'ⱼ
    # (N, K) @ (K, 3) = (N, 3)
    numerator = Wm @ modified_centers.astype(np.float64)

    # Denominator: Σⱼ wₚⱼᵐ — shape (N,)
    denominator = Wm.sum(axis=1)

    # Normalize — this is required, NOT optional
    corrected_flat = numerator / denominator[:, np.newaxis]

    # Reshape back to image
    corrected_lab = corrected_flat.reshape(h, w, 3)

    return corrected_lab


def reconstruct_to_srgb(
    roi_lab: np.ndarray,
    modified_centers: np.ndarray,
    memberships: np.ndarray,
    m: float = 2.0
) -> np.ndarray:
    """
    Reconstruct corrected ROI and convert all the way to sRGB uint8.

    Returns
    -------
    np.ndarray
        Corrected ROI as sRGB uint8, shape (H, W, 3), values [0, 255].
    """
    corrected_lab = reconstruct(roi_lab, modified_centers, memberships, m)

    # CIELAB → Linear RGB → sRGB
    linear_rgb = from_cielab(corrected_lab)
    srgb = linear_to_srgb(linear_rgb)

    return (np.clip(srgb, 0.0, 1.0) * 255.0).astype(np.uint8)


def paste_roi_into_image(
    full_image: np.ndarray,
    roi_corrected: np.ndarray,
    bbox: tuple
) -> np.ndarray:
    """
    Paste a corrected ROI back into the full image at the original bounding box.

    Parameters
    ----------
    full_image : np.ndarray
        Full original image in sRGB uint8, shape (H_full, W_full, 3).
    roi_corrected : np.ndarray
        Corrected ROI in sRGB uint8, shape (H_roi, W_roi, 3).
    bbox : tuple
        (x1, y1, x2, y2) — top-left and bottom-right pixel coordinates.

    Returns
    -------
    np.ndarray
        Full image with corrected ROI pasted in, sRGB uint8.
    """
    result = full_image.copy()
    x1, y1, x2, y2 = bbox

    # Ensure ROI fits exactly in bounding box
    h_roi = y2 - y1
    w_roi = x2 - x1

    if roi_corrected.shape[0] != h_roi or roi_corrected.shape[1] != w_roi:
        roi_corrected = np.array(
            Image.fromarray(roi_corrected).resize((w_roi, h_roi), resample=Image.Resampling.BICUBIC),
            dtype=np.uint8,
        )

    result[y1:y2, x1:x2] = roi_corrected
    return result
