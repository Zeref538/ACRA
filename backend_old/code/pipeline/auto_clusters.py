"""
auto_clusters.py
----------------
Gallo, Dave Andre A. — Automatic FCM cluster count estimation.

Analyses the image's color distribution in CIELAB to determine how many
FCM clusters are needed.  Pure-numpy implementation — no scikit-learn
dependency.

Strategy:
    1.  Subsample to max_pixels for speed.
    2.  Coarse pass: count distinct color bins in a 3D LAB histogram
        to get a rough lower bound for k.
    3.  Refinement: run lightweight mini-batch k-means for a set of
        candidate k values, score each with a fast silhouette
        approximation (sample-based), pick the best.
    4.  Red/green chroma bonus: if the image has significant content in
        the red-green confusion zone, bump k to capture fine CVD-critical
        distinctions.
    5.  Clamp result to [k_min, k_max].
"""

import numpy as np
from typing import Optional


# ═══════════════════════════════════════════════════════════════════════════════
#  Lightweight Mini-Batch K-Means (pure numpy)
# ═══════════════════════════════════════════════════════════════════════════════

def _mini_batch_kmeans(
    data: np.ndarray,
    k: int,
    batch_size: int = 1024,
    max_iter: int = 30,
    rng: Optional[np.random.Generator] = None,
) -> np.ndarray:
    """
    Minimal mini-batch k-means.  Returns cluster centers (k, D).
    """
    if rng is None:
        rng = np.random.default_rng(42)
    n, d = data.shape
    # k-means++ init
    idx = rng.integers(0, n)
    centers = [data[idx].copy()]
    for _ in range(1, k):
        diffs = data[:, None, :] - np.array(centers)[None, :, :]
        dists = (diffs ** 2).sum(axis=-1).min(axis=1)
        total = dists.sum()
        if total < 1e-10:
            # All points are on existing centers — pick uniformly
            idx = int(rng.integers(0, n))
        else:
            probs = dists / total
            probs = probs / probs.sum()  # ensure exact sum-to-1
            idx = int(rng.choice(n, p=probs))
        centers.append(data[idx].copy())
    centers = np.array(centers, dtype=np.float64)

    for _ in range(max_iter):
        batch_idx = rng.choice(n, size=min(batch_size, n), replace=False)
        batch = data[batch_idx]
        # assign
        diffs = batch[:, None, :] - centers[None, :, :]
        labels = (diffs ** 2).sum(axis=-1).argmin(axis=1)
        # update
        for c in range(k):
            mask = labels == c
            if mask.any():
                centers[c] = 0.8 * centers[c] + 0.2 * batch[mask].mean(axis=0)
    return centers


def _assign_labels(data: np.ndarray, centers: np.ndarray) -> np.ndarray:
    """Assign each point to its nearest center.  Returns labels (N,)."""
    # Process in chunks to avoid huge memory allocation
    n = data.shape[0]
    labels = np.empty(n, dtype=np.intp)
    CHUNK = 20000
    for start in range(0, n, CHUNK):
        end = min(start + CHUNK, n)
        diffs = data[start:end, None, :] - centers[None, :, :]
        labels[start:end] = (diffs ** 2).sum(axis=-1).argmin(axis=1)
    return labels


# ═══════════════════════════════════════════════════════════════════════════════
#  Fast Silhouette Approximation (sample-based)
# ═══════════════════════════════════════════════════════════════════════════════

def _silhouette_score_sampled(
    data: np.ndarray,
    labels: np.ndarray,
    sample_size: int = 3000,
    rng: Optional[np.random.Generator] = None,
) -> float:
    """
    Approximate silhouette score using a random subsample.

    For each sampled point:
        a(i) = mean distance to same-cluster points (intra)
        b(i) = min over other clusters of mean distance (inter)
        s(i) = (b - a) / max(a, b)

    Returns mean s(i) over the sample.  Range [-1, 1], higher = better.
    """
    if rng is None:
        rng = np.random.default_rng(42)

    n = data.shape[0]
    unique_labels = np.unique(labels)
    if len(unique_labels) < 2:
        return -1.0  # degenerate — single cluster

    sample_size = min(sample_size, n)
    idx = rng.choice(n, size=sample_size, replace=False)
    sample = data[idx]
    sample_labels = labels[idx]

    # Pre-compute cluster means for the "inter" distance (fast approximation)
    # Using mean distance to cluster centroid instead of mean pairwise distance
    # makes this O(N·K) instead of O(N²).
    cluster_centers = np.array([
        data[labels == c].mean(axis=0) for c in unique_labels
    ])
    label_to_idx = {int(c): i for i, c in enumerate(unique_labels)}

    scores = np.empty(sample_size, dtype=np.float64)
    for si in range(sample_size):
        pt = sample[si]
        my_label = sample_labels[si]
        my_cidx = label_to_idx[int(my_label)]

        # a(i): distance to own cluster centroid
        a_val = float(np.sqrt(((pt - cluster_centers[my_cidx]) ** 2).sum()))

        # b(i): min distance to other cluster centroids
        dists_to_centers = np.sqrt(((pt - cluster_centers) ** 2).sum(axis=1))
        dists_to_centers[my_cidx] = np.inf
        b_val = float(dists_to_centers.min())

        denom = max(a_val, b_val)
        scores[si] = (b_val - a_val) / denom if denom > 1e-10 else 0.0

    return float(np.mean(scores))


# ═══════════════════════════════════════════════════════════════════════════════
#  Histogram-based lower-bound heuristic
# ═══════════════════════════════════════════════════════════════════════════════

def _histogram_color_count(lab_pixels: np.ndarray, bins: int = 12) -> int:
    """
    Count how many non-empty cells exist in a coarse 3D LAB histogram.
    This gives a rough lower bound for meaningful clusters.

    L ∈ [0, 100], a ∈ [-128, 127], b ∈ [-128, 127]
    """
    L_bins = np.linspace(0, 100, bins + 1)
    a_bins = np.linspace(-128, 127, bins + 1)
    b_bins = np.linspace(-128, 127, bins + 1)

    L_idx = np.clip(np.digitize(lab_pixels[:, 0], L_bins) - 1, 0, bins - 1)
    a_idx = np.clip(np.digitize(lab_pixels[:, 1], a_bins) - 1, 0, bins - 1)
    b_idx = np.clip(np.digitize(lab_pixels[:, 2], b_bins) - 1, 0, bins - 1)

    flat_idx = L_idx * bins * bins + a_idx * bins + b_idx
    n_occupied = len(np.unique(flat_idx))
    return n_occupied


# ═══════════════════════════════════════════════════════════════════════════════
#  Red/Green chroma analysis
# ═══════════════════════════════════════════════════════════════════════════════

def _red_green_energy_ratio(lab_pixels: np.ndarray) -> float:
    """
    Fraction of pixels that have significant chroma in the a* (red-green) axis.
    High ratio means the image has lots of red/green content that CVD users
    would struggle with — worth using more clusters for fine separation.

    A pixel is "red-green active" if |a*| > 20 and chroma > 25.
    """
    a_vals = lab_pixels[:, 1]
    b_vals = lab_pixels[:, 2]
    chroma = np.sqrt(a_vals ** 2 + b_vals ** 2)

    rg_active = (np.abs(a_vals) > 20) & (chroma > 25)
    return float(rg_active.sum()) / max(1, len(lab_pixels))


# ═══════════════════════════════════════════════════════════════════════════════
#  Main entry point
# ═══════════════════════════════════════════════════════════════════════════════

def estimate_n_clusters(
    lab_pixels: np.ndarray,
    max_pixels: int = 25000,
    k_min: int = 1,
    k_max: int = 30,
    seed: int = 42,
) -> int:
    """
    Automatically determine the optimal number of FCM clusters for an image.

    Parameters
    ----------
    lab_pixels : np.ndarray
        CIELAB pixel data, shape (N, 3) or (H, W, 3).
    max_pixels : int
        Subsample size for analysis.
    k_min, k_max : int
        Allowed cluster range.
    seed : int
        RNG seed for reproducibility.

    Returns
    -------
    int
        Recommended number of clusters.
    """
    import math as _math

    rng = np.random.default_rng(seed)

    # Flatten to (N, 3)
    if lab_pixels.ndim == 3:
        lab_pixels = lab_pixels.reshape(-1, 3)
    data = lab_pixels.astype(np.float64)

    n_total = data.shape[0]

    # ── Trivial cases ─────────────────────────────────────────────────────
    if n_total < 100:
        return k_min

    # ── Resolution-aware k_max ────────────────────────────────────────────
    # Small images don't need many clusters — scale by sqrt(pixels)/8.
    # E.g. 200×200 (40k px) → effective max ≈ 25.
    #      500×500 (250k px) → effective max ≈ 62.
    effective_k_max = min(k_max, max(k_min, int(_math.sqrt(n_total) / 8)))

    # ── Subsample ─────────────────────────────────────────────────────────
    if n_total > max_pixels:
        idx = rng.choice(n_total, size=max_pixels, replace=False)
        sample = data[idx]
    else:
        sample = data

    # ── Phase 1: histogram lower bound ────────────────────────────────────
    n_colors = _histogram_color_count(sample, bins=12)
    # Map occupied bins to a rough cluster suggestion
    hist_k = max(k_min, min(effective_k_max, n_colors // 3))

    # ── Phase 2: silhouette scan ──────────────────────────────────────────
    # Generate candidates tightly around the histogram estimate
    raw_candidates = set()
    raw_candidates.add(k_min)
    # Dense spread around histogram estimate
    for offset in [-4, -2, 0, 2, 4, 8, 12]:
        raw_candidates.add(hist_k + offset)
    # A few strategic probes
    raw_candidates.add(8)
    raw_candidates.add(12)
    raw_candidates.add(16)

    candidates = sorted([
        k for k in raw_candidates
        if k_min <= k <= effective_k_max
    ])

    best_k = hist_k
    best_score = -2.0

    for k in candidates:
        if k > sample.shape[0]:
            continue
        centers = _mini_batch_kmeans(sample, k, rng=np.random.default_rng(seed))
        labels = _assign_labels(sample, centers)
        score = _silhouette_score_sampled(sample, labels, sample_size=2000, rng=rng)

        # Complexity penalty: prefer simpler models at equal quality.
        # Mild linear penalty above k=8 discourages unnecessarily high K.
        penalty = 1.0 - 0.003 * max(0, k - 8)
        adjusted_score = score * max(penalty, 0.5)  # floor at 0.5× to not kill large k entirely

        if adjusted_score > best_score:
            best_score = adjusted_score
            best_k = k

    # ── Phase 3: red/green chroma bonus ───────────────────────────────────
    rg_ratio = _red_green_energy_ratio(sample)
    if rg_ratio > 0.05:
        # Any meaningful red/green content: enforce a floor of 12 clusters
        # so FCM doesn't average red and green into one muddy center.
        best_k = max(best_k, min(4, effective_k_max))
    if rg_ratio > 0.15:
        # Heavy red/green content: bump further for fine separation
        bonus = int(best_k * 0.35 * min(1.0, rg_ratio / 0.25))
        best_k = min(effective_k_max, best_k + bonus)

    # ── Clamp and return ──────────────────────────────────────────────────
    best_k = max(k_min, min(effective_k_max, best_k))
    return best_k

