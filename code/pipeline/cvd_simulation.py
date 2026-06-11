"""
cvd_simulation.py
-----------------
Gallo, Dave Andre A. — Track A, Stage 2

Simulates how a CVD user perceives an image.
Implements Machado et al. (2009) severity interpolation model.

Pipeline:
    Linear RGB → LMS (HPE D65) → apply M_sim(s) → LMS_sim
    → Linear RGB → sRGB (reapply gamma)

Severity s ∈ [0, 1]:
    0 = normal vision (identity matrix)
    1 = full dichromacy
"""

import numpy as np


# ── Hunt-Pointer-Estévez D65 matrix: Linear RGB → LMS ────────────────────────
HPE_RGB_TO_LMS = np.array([
    [ 0.4002,  0.7076, -0.0808],
    [-0.2263,  1.1653,  0.0457],
    [ 0.0000,  0.0000,  0.9182],
], dtype=np.float64)

HPE_LMS_TO_RGB = np.linalg.inv(HPE_RGB_TO_LMS)

# ── Full dichromacy matrices in LMS space ─────────────────────────────────────
# Protanopia: L-cone row replaced by M-cone (L' = M)
PROTAN_MATRIX = np.array([
    [0.0, 1.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
], dtype=np.float64)

# Deuteranopia: M-cone row derived from remaining L and S channels
DEUTAN_MATRIX = np.array([
    [1.0,        0.0, 0.0       ],
    [0.9513092,  0.0, 0.04866992],
    [0.0,        0.0, 1.0       ],
], dtype=np.float64)

DEFICIENCY_MATRICES = {
    "protan":  PROTAN_MATRIX,
    "deutan":  DEUTAN_MATRIX,
}


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    """Apply sRGB gamma (linear → display-ready sRGB)."""
    c = np.clip(c, 0.0, 1.0).astype(np.float32)
    return np.where(
        c <= 0.0031308,
        c * 12.92,
        1.055 * (c ** (1.0 / 2.4)) - 0.055
    ).astype(np.float32)


def simulate_cvd(
    image_linear: np.ndarray,
    severity: float,
    cvd_type: str
) -> np.ndarray:
    """
    Simulate CVD perception of a linear RGB image.

    Parameters
    ----------
    image_linear : np.ndarray
        Linear RGB image, shape (H, W, 3), float32, values in [0, 1].
        Must be gamma-corrected (linearized) BEFORE this call.
    severity : float
        CVD severity ∈ [0.0, 1.0].  0 = normal vision, 1 = full dichromacy.
    cvd_type : str
        'protan' or 'deutan'.

    Returns
    -------
    np.ndarray
        Simulated sRGB image, shape (H, W, 3), float32, values in [0, 1].
    """
    if cvd_type not in DEFICIENCY_MATRICES:
        raise ValueError(f"cvd_type must be 'protan' or 'deutan', got: {cvd_type!r}")

    severity = float(np.clip(severity, 0.0, 1.0))
    M_deficiency = DEFICIENCY_MATRICES[cvd_type]

    # Severity-interpolated simulation matrix: M_sim(s) = (1-s)·I + s·M_deficiency
    M_sim = (1.0 - severity) * np.eye(3) + severity * M_deficiency

    # Full transform: Linear RGB → LMS → LMS_sim → Linear RGB
    # Combined matrix: HPE_LMS_TO_RGB @ M_sim @ HPE_RGB_TO_LMS
    M_full = HPE_LMS_TO_RGB @ M_sim @ HPE_RGB_TO_LMS

    # Apply to image
    h, w, _ = image_linear.shape
    img_flat = image_linear.reshape(-1, 3).astype(np.float64)
    sim_flat = img_flat @ M_full.T   # (N, 3) @ (3, 3)^T

    # Protanopia can produce negative LMS values — clamp to 0
    if cvd_type == "protan":
        sim_flat = np.maximum(sim_flat, 0.0)

    sim_linear = sim_flat.reshape(h, w, 3).astype(np.float32)
    sim_linear = np.clip(sim_linear, 0.0, 1.0)

    # Linear RGB → sRGB (reapply gamma)
    sim_srgb = _linear_to_srgb(sim_linear)
    return sim_srgb


def get_simulation_matrix(severity: float, cvd_type: str) -> np.ndarray:
    """
    Return the combined Linear RGB → simulated Linear RGB matrix.
    Useful for direct matrix application without image reshaping.
    """
    if cvd_type not in DEFICIENCY_MATRICES:
        raise ValueError(f"cvd_type must be 'protan' or 'deutan'")
    severity = float(np.clip(severity, 0.0, 1.0))
    M_deficiency = DEFICIENCY_MATRICES[cvd_type]
    M_sim = (1.0 - severity) * np.eye(3) + severity * M_deficiency
    return HPE_LMS_TO_RGB @ M_sim @ HPE_RGB_TO_LMS
