"""
fcm.py
------
Gallo, Dave Andre A. — Track A, Stage 4

Fuzzy C-Means clustering of ROI pixels in CIELAB space.
Soft membership enables smooth reconstruction — edge pixels
belong partially to multiple clusters for seamless blending.

Parameters:
    m = 2       (fuzziness — standard value)
    ε = 0.001   (convergence threshold)
    max_iter = 100
    n_clusters = 5 (normal ROI), 3 (small ROI < 32x32)
"""

import numpy as np
from typing import Tuple


def _kmeans_plus_plus_init(
    data: np.ndarray,
    n_clusters: int,
    rng: np.random.Generator
) -> np.ndarray:
    """
    k-means++ seeding in CIELAB space.
    Reduces sensitivity to random initialization.

    Returns initial cluster centers, shape (n_clusters, 3).
    """
    n_points = data.shape[0]
    centers = []

    # Pick first center uniformly at random
    idx = rng.integers(0, n_points)
    centers.append(data[idx].copy())

    for _ in range(1, n_clusters):
        # Distance to nearest already-chosen center
        dists = np.array([
            np.min([np.sum((x - c) ** 2) for c in centers])
            for x in data
        ])
        # Pick next center with probability proportional to D(x)^2
        probs = dists / dists.sum()
        cumprobs = np.cumsum(probs)
        r = rng.random()
        idx = np.searchsorted(cumprobs, r)
        idx = min(idx, n_points - 1)
        centers.append(data[idx].copy())

    return np.array(centers, dtype=np.float64)


def _kmeans_plus_plus_init_fast(
    data: np.ndarray,
    n_clusters: int,
    rng: np.random.Generator
) -> np.ndarray:
    """
    Vectorized k-means++ — faster for large pixel arrays.
    """
    n_points = data.shape[0]
    idx = rng.integers(0, n_points)
    centers = [data[idx].copy()]

    for _ in range(1, n_clusters):
        # Compute squared distances to all existing centers, take minimum
        diffs = data[:, np.newaxis, :] - np.array(centers)[np.newaxis, :, :]
        sq_dists = (diffs ** 2).sum(axis=-1)   # (N, k)
        min_dists = sq_dists.min(axis=1)        # (N,)

        probs = min_dists / (min_dists.sum() + 1e-10)
        cumprobs = np.cumsum(probs)
        r = rng.random()
        idx = int(np.searchsorted(cumprobs, r))
        idx = min(idx, n_points - 1)
        centers.append(data[idx].copy())

    return np.array(centers, dtype=np.float64)


def _compute_memberships(
    data: np.ndarray,
    centers: np.ndarray,
    m: float = 2.0
) -> np.ndarray:
    """
    Membership update rule (fully vectorized — no per-pixel Python loop):
        w_ij = 1 / Σ_k (||x_i - c_j|| / ||x_i - c_k||)^(2/(m-1))

    Returns membership matrix W, shape (N, n_clusters), rows sum to 1.
    """
    exp = 2.0 / (m - 1.0)

    # Pairwise distances: (N, K)
    diffs = data[:, np.newaxis, :] - centers[np.newaxis, :, :]   # (N, K, 3)
    dists = np.sqrt((diffs ** 2).sum(axis=-1))                    # (N, K)

    # Pixels that exactly hit a center
    zero_mask = dists < 1e-10                   # (N, K) bool
    any_zero  = zero_mask.any(axis=1)           # (N,)   bool

    safe_dists = np.maximum(dists, 1e-10)
    inv_dists = safe_dists ** (-exp)
    W = inv_dists / inv_dists.sum(axis=1, keepdims=True)

    # For pixels that land exactly on a center, assign uniform membership
    # across all coincident centers (usually just 1) and 0 elsewhere.
    if any_zero.any():
        n_hits = zero_mask[any_zero].sum(axis=1, keepdims=True).astype(np.float64)
        W[any_zero] = zero_mask[any_zero].astype(np.float64) / n_hits

    return W


def _update_centers(
    data: np.ndarray,
    W: np.ndarray,
    m: float = 2.0
) -> np.ndarray:
    """
    Center update rule:
        c_j = Σ_i w_ij^m * x_i / Σ_i w_ij^m
    """
    Wm = W ** m   # (N, K)
    # centers = (Wm.T @ data) / Wm.T.sum(axis=1, keepdims=True)
    numerator = Wm.T @ data            # (K, 3)
    denominator = Wm.sum(axis=0)       # (K,)
    centers = numerator / denominator[:, np.newaxis]
    return centers


def run_fcm(
    roi_lab: np.ndarray,
    n_clusters: int,
    m: float = 2.0,
    max_iter: int = 100,
    eps: float = 0.001,
    seed: int = 42,
    max_pixels: int = 50000,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Run Fuzzy C-Means on an ROI in CIELAB space.

    For large images, FCM runs on a random subsample (max_pixels) to find
    cluster centers, then memberships are computed for ALL pixels using
    those centers. This keeps runtime O(max_pixels) regardless of image size
    while still producing accurate per-pixel memberships for reconstruction.

    Parameters
    ----------
    roi_lab : np.ndarray
        CIELAB pixels, shape (H, W, 3) or (N, 3).
    n_clusters : int
        Number of clusters (5 normal, 3 for small ROIs).
    m : float
        Fuzziness parameter (default 2.0).
    max_iter : int
        Maximum iterations (default 100).
    eps : float
        Convergence threshold (default 0.001).
    seed : int
        RNG seed.
    max_pixels : int
        Maximum pixels used for FCM clustering. Full-image memberships are
        recomputed from the resulting centers. Default 50000.

    Returns
    -------
    centers : np.ndarray, shape (n_clusters, 3)
    memberships : np.ndarray, shape (N_pixels, n_clusters)
    """
    original_shape = roi_lab.shape
    if roi_lab.ndim == 3:
        h, w, _ = roi_lab.shape
        if h * w < 32 * 32:
            n_clusters = min(n_clusters, 3)
        data = roi_lab.reshape(-1, 3).astype(np.float64)
    elif roi_lab.ndim == 2:
        data = roi_lab.astype(np.float64)
    else:
        raise ValueError(f"roi_lab must be (H,W,3) or (N,3), got shape {roi_lab.shape}")

    n_points = data.shape[0]
    n_clusters = min(n_clusters, n_points)
    if n_clusters < 2:
        centers = data.mean(axis=0, keepdims=True)
        memberships = np.ones((n_points, 1), dtype=np.float64)
        return centers, memberships

    rng = np.random.default_rng(seed)

    # ── Subsample for FCM if image is large ───────────────────────────────
    if n_points > max_pixels:
        idx = rng.choice(n_points, size=max_pixels, replace=False)
        sample = data[idx]
    else:
        sample = data

    # ── Initialize cluster centers with k-means++ on sample ───────────────
    centers = _kmeans_plus_plus_init_fast(sample, n_clusters, rng)
    W = _compute_memberships(sample, centers, m)

    # ── Iterative optimization on sample ──────────────────────────────────
    for iteration in range(max_iter):
        W_prev = W.copy()
        centers = _update_centers(sample, W, m)
        W = _compute_memberships(sample, centers, m)
        if np.max(np.abs(W - W_prev)) < eps:
            break

    # ── Compute full-image memberships from the converged centers ─────────
    # Do this in chunks to avoid building an (N, K, K) tensor for huge images
    if n_points > max_pixels:
        CHUNK = 50000
        W_full = np.empty((n_points, n_clusters), dtype=np.float64)
        for start in range(0, n_points, CHUNK):
            end = min(start + CHUNK, n_points)
            W_full[start:end] = _compute_memberships(data[start:end], centers, m)
        W = W_full

    return centers, W