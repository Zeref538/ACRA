"""
normalization.py
----------------
Gallo, Dave Andre A. — Track A, Stage 1

Converts sRGB image to linear RGB (removes gamma).

CRITICAL: This MUST happen before any LMS transform. Applying
LMS to gamma-corrected sRGB is the most common CVD simulation error.
"""

import numpy as np
from PIL import Image


def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    """
    Apply inverse sRGB gamma per channel.
    Piecewise formula:
        C_linear = C / 12.92              if C <= 0.04045
        C_linear = ((C + 0.055) / 1.055) ^ 2.4   otherwise
    Input:  float32 array, values in [0, 1]
    Output: float32 array, values in [0, 1]
    """
    c = np.clip(c, 0.0, 1.0).astype(np.float32)
    linear = np.where(
        c <= 0.04045,
        c / 12.92,
        ((c + 0.055) / 1.055) ** 2.4
    )
    return linear.astype(np.float32)


def normalize_image(image_path: str) -> np.ndarray:
    """
    Load image, remove gamma → linear RGB float32.

    Parameters
    ----------
    image_path : str
        Path to the source image.

    Returns
    -------
    np.ndarray
        Linear RGB image, shape (H, W, 3), dtype float32, values in [0, 1].
        Channel order: R, G, B.
    """
    # --- Load image as RGB ---
    try:
        img_rgb = np.array(Image.open(image_path).convert("RGB"), dtype=np.uint8)
    except Exception as exc:
        raise FileNotFoundError(f"Could not read image: {image_path}") from exc

    # Convert BGR → RGB

    # --- Normalize to [0, 1] float32 ---
    img_float = img_rgb.astype(np.float32) / 255.0

    # --- Remove gamma: sRGB → Linear RGB ---
    img_linear = _srgb_to_linear(img_float)

    return img_linear


def normalize_array(img_rgb_uint8: np.ndarray) -> np.ndarray:
    """
    Same as normalize_image but accepts an already-loaded uint8 RGB array.
    Useful for Streamlit (image already decoded from file uploader).

    Parameters
    ----------
    img_rgb_uint8 : np.ndarray
        RGB image, shape (H, W, 3), dtype uint8.

    Returns
    -------
    np.ndarray
        Linear RGB float32, values in [0, 1].
    """
    if img_rgb_uint8.dtype != np.uint8:
        raise ValueError("Expected uint8 RGB array.")

    img_float = img_rgb_uint8.astype(np.float32) / 255.0
    return _srgb_to_linear(img_float)
