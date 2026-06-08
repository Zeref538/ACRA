"""
cielab.py
---------
Gallo, Dave Andre A. — Track A, Stage 3

Converts linear RGB images to CIELAB color space for perceptual
distance calculations. CIELAB ensures equal numerical distances
correspond to roughly equal perceptual differences.

Pipeline:
    Linear RGB → XYZ (sRGB primaries, D65) → CIELAB (D65 white point)
"""

import numpy as np


# ── sRGB primaries matrix: Linear RGB → XYZ (D65) ────────────────────────────
RGB_TO_XYZ = np.array([
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
], dtype=np.float64)

XYZ_TO_RGB = np.linalg.inv(RGB_TO_XYZ)

# ── D65 white point ───────────────────────────────────────────────────────────
D65_Xn = 0.95047
D65_Yn = 1.00000
D65_Zn = 1.08883

# ── CIELAB f(t) thresholds ────────────────────────────────────────────────────
_DELTA = 6.0 / 29.0
_DELTA3 = _DELTA ** 3       # (6/29)^3 ≈ 0.008856
_DELTA2_3 = 3.0 * (_DELTA ** 2)   # 3*(6/29)^2 ≈ 0.12841


def _f(t: np.ndarray) -> np.ndarray:
    """CIELAB nonlinear function f(t)."""
    return np.where(
        t > _DELTA3,
        np.cbrt(t),
        t / _DELTA2_3 + (4.0 / 29.0)
    )


def to_cielab(image_linear: np.ndarray) -> np.ndarray:
    """
    Convert a linear RGB image to CIELAB.

    Parameters
    ----------
    image_linear : np.ndarray
        Linear RGB image, shape (H, W, 3) or (N, 3), float32/float64,
        values in [0, 1].

    Returns
    -------
    np.ndarray
        CIELAB array, same shape as input.
        L* ∈ [0, 100],  a* and b* approximately ∈ [-128, 127].
        dtype float64.
    """
    shape = image_linear.shape
    flat = image_linear.reshape(-1, 3).astype(np.float64)
    flat = np.clip(flat, 0.0, 1.0)

    # Linear RGB → XYZ
    xyz = flat @ RGB_TO_XYZ.T    # (N, 3)

    # Normalize by D65 white point
    xyz[:, 0] /= D65_Xn
    xyz[:, 1] /= D65_Yn
    xyz[:, 2] /= D65_Zn

    # Apply f()
    fxyz = _f(xyz)

    # Compute L*, a*, b*
    lab = np.empty_like(fxyz)
    lab[:, 0] = 116.0 * fxyz[:, 1] - 16.0          # L*
    lab[:, 1] = 500.0 * (fxyz[:, 0] - fxyz[:, 1])  # a*
    lab[:, 2] = 200.0 * (fxyz[:, 1] - fxyz[:, 2])  # b*

    return lab.reshape(shape)


def from_cielab(lab: np.ndarray) -> np.ndarray:
    """
    Convert CIELAB back to linear RGB.

    Parameters
    ----------
    lab : np.ndarray
        CIELAB array, shape (H, W, 3) or (N, 3), float64.

    Returns
    -------
    np.ndarray
        Linear RGB float32, values clipped to [0, 1].
    """
    shape = lab.shape
    lab_flat = lab.reshape(-1, 3).astype(np.float64)

    fy = (lab_flat[:, 0] + 16.0) / 116.0
    fx = lab_flat[:, 1] / 500.0 + fy
    fz = fy - lab_flat[:, 2] / 200.0

    def f_inv(t):
        return np.where(t > _DELTA, t ** 3, _DELTA2_3 * (t - 4.0 / 29.0))

    X = f_inv(fx) * D65_Xn
    Y = f_inv(fy) * D65_Yn
    Z = f_inv(fz) * D65_Zn

    xyz = np.stack([X, Y, Z], axis=-1)
    rgb_linear = xyz @ XYZ_TO_RGB.T
    rgb_linear = np.clip(rgb_linear, 0.0, 1.0).astype(np.float32)

    return rgb_linear.reshape(shape)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    """Apply sRGB gamma to linear RGB array."""
    c = np.clip(c, 0.0, 1.0).astype(np.float32)
    return np.where(
        c <= 0.0031308,
        c * 12.92,
        1.055 * (c ** (1.0 / 2.4)) - 0.055
    ).astype(np.float32)


