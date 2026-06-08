"""
conflict.py
-----------
Gallo, Dave Andre A. — Track A, Stage 5

Identifies which cluster pairs perceptually collapse under CVD simulation.
Uses CIEDE2000 for final validation, CIE76 for real-time slider updates.

Only conflict pairs are passed to Martinez's LCH optimization.
"""

import numpy as np
from typing import List, Tuple
import math


# ── Confusion direction vectors in (a*, b*) space ────────────────────────────
CONFUSION_DIRECTIONS = {
    "protan": np.array([1.0, 0.0], dtype=np.float64),
    "deutan": np.array([0.9139, 0.4062], dtype=np.float64),
}
# Note: deutan direction is pre-normalized (magnitude ≈ 1.0)


# ═══════════════════════════════════════════════════════════════════════════════
#  CIE76 — Euclidean ΔE in CIELAB (fast, for real-time use on Pi 5)
# ═══════════════════════════════════════════════════════════════════════════════

def delta_e_cie76(lab1: np.ndarray, lab2: np.ndarray) -> float:
    """Simple Euclidean distance in CIELAB."""
    diff = np.asarray(lab1, dtype=np.float64) - np.asarray(lab2, dtype=np.float64)
    return float(np.sqrt(np.sum(diff ** 2)))


# ═══════════════════════════════════════════════════════════════════════════════
#  CIEDE2000 — Perceptually accurate ΔE (for final validation)
# ═══════════════════════════════════════════════════════════════════════════════

def delta_e_ciede2000(lab1: np.ndarray, lab2: np.ndarray) -> float:
    """
    CIEDE2000 color difference formula.
    kL = kC = kH = 1 (standard parametric factors).

    Source: Sharma et al. (2005) "The CIEDE2000 Color-Difference Formula"
    """
    L1, a1, b1 = float(lab1[0]), float(lab1[1]), float(lab1[2])
    L2, a2, b2 = float(lab2[0]), float(lab2[1]), float(lab2[2])

    # Step 1: Compute C'ab and a'
    C1ab = math.sqrt(a1 ** 2 + b1 ** 2)
    C2ab = math.sqrt(a2 ** 2 + b2 ** 2)
    C_ab_bar = (C1ab + C2ab) / 2.0

    C_ab_bar7 = C_ab_bar ** 7
    G = 0.5 * (1.0 - math.sqrt(C_ab_bar7 / (C_ab_bar7 + 25.0 ** 7)))

    a1p = a1 * (1.0 + G)
    a2p = a2 * (1.0 + G)

    C1p = math.sqrt(a1p ** 2 + b1 ** 2)
    C2p = math.sqrt(a2p ** 2 + b2 ** 2)

    # Step 2: Compute h'
    def compute_hp(ap, b):
        if ap == 0.0 and b == 0.0:
            return 0.0
        angle = math.degrees(math.atan2(b, ap))
        return angle + 360.0 if angle < 0.0 else angle

    h1p = compute_hp(a1p, b1)
    h2p = compute_hp(a2p, b2)

    # Step 3: Compute ΔL', ΔC', ΔH'
    dLp = L2 - L1
    dCp = C2p - C1p

    if C1p * C2p == 0.0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180.0:
        dhp = h2p - h1p
    elif h2p - h1p > 180.0:
        dhp = h2p - h1p - 360.0
    else:
        dhp = h2p - h1p + 360.0

    dHp = 2.0 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2.0))

    # Step 4: Compute CIEDE2000
    Lp_bar = (L1 + L2) / 2.0
    Cp_bar = (C1p + C2p) / 2.0

    if C1p * C2p == 0.0:
        hp_bar = h1p + h2p
    elif abs(h1p - h2p) <= 180.0:
        hp_bar = (h1p + h2p) / 2.0
    elif h1p + h2p < 360.0:
        hp_bar = (h1p + h2p + 360.0) / 2.0
    else:
        hp_bar = (h1p + h2p - 360.0) / 2.0

    T = (1.0
         - 0.17 * math.cos(math.radians(hp_bar - 30.0))
         + 0.24 * math.cos(math.radians(2.0 * hp_bar))
         + 0.32 * math.cos(math.radians(3.0 * hp_bar + 6.0))
         - 0.20 * math.cos(math.radians(4.0 * hp_bar - 63.0)))

    d_theta = 30.0 * math.exp(-((hp_bar - 275.0) / 25.0) ** 2)
    Cp_bar7 = Cp_bar ** 7
    RC = 2.0 * math.sqrt(Cp_bar7 / (Cp_bar7 + 25.0 ** 7))
    RT = -math.sin(math.radians(2.0 * d_theta)) * RC

    SL = 1.0 + 0.015 * (Lp_bar - 50.0) ** 2 / math.sqrt(20.0 + (Lp_bar - 50.0) ** 2)
    SC = 1.0 + 0.045 * Cp_bar
    SH = 1.0 + 0.015 * Cp_bar * T

    dE = math.sqrt(
        (dLp / SL) ** 2 +
        (dCp / SC) ** 2 +
        (dHp / SH) ** 2 +
        RT * (dCp / SC) * (dHp / SH)
    )

    return dE


# ═══════════════════════════════════════════════════════════════════════════════
#  Main conflict detection function
# ═══════════════════════════════════════════════════════════════════════════════

def detect_conflicts(
    centers_orig: np.ndarray,
    centers_sim: np.ndarray,
    cvd_type: str,
    threshold: float = 20.0,
    rg_separation_threshold: float = 35.0,
    rg_luminance_threshold: float = 25.0,
    rg_original_luminance_threshold: float = 22.0,
    use_fast: bool = False,
    max_clusters: int = None,
    cluster_weights: np.ndarray = None,
    min_cluster_weight: float = 0.004,
    max_conflicts: int = 80,
) -> List[Tuple[int, int]]:
    """
    Identify cluster pairs that perceptually collapse under CVD simulation.

    Parameters
    ----------
    centers_orig : np.ndarray, shape (K, 3)
        Original cluster centers in CIELAB (from FCM on original image).
    centers_sim : np.ndarray, shape (K, 3)
        Simulated cluster centers in CIELAB (from FCM on CVD-simulated image).
    cvd_type : str
        'protan' or 'deutan'.
    threshold : float
        ΔE threshold below which a pair is flagged as conflicting (default 20).
    rg_separation_threshold : float
        Red/green conflict threshold in simulated ΔE00 (default 35).
    rg_luminance_threshold : float
        Minimum simulated L* separation for red/green pairs to skip re-encoding
        (default 15).
    use_fast : bool
        If True, use CIE76 instead of CIEDE2000 (for real-time Pi 5 updates).

    Returns
    -------
    List[Tuple[int, int]]
        List of (i, j) conflict pairs where i < j.
        These pairs are passed directly to Martinez's reencode().
    """
    if cvd_type not in CONFUSION_DIRECTIONS:
        raise ValueError(f"cvd_type must be 'protan' or 'deutan', got: {cvd_type!r}")

    delta_e_fn = delta_e_cie76 if use_fast else delta_e_ciede2000

    _A_MIN = 10.0
    _CHROMA_MIN = 15.0
    orig_chroma = np.sqrt(centers_orig[:, 1] ** 2 + centers_orig[:, 2] ** 2)
    if cluster_weights is None:
        cluster_weights = np.ones(centers_sim.shape[0], dtype=np.float64)
    else:
        cluster_weights = np.asarray(cluster_weights, dtype=np.float64).reshape(-1)
        if len(cluster_weights) != centers_sim.shape[0]:
            cluster_weights = np.ones(centers_sim.shape[0], dtype=np.float64)

    index_map = np.arange(centers_sim.shape[0], dtype=np.int32)
    if max_clusters is not None and max_clusters > 0:
        n_total = centers_sim.shape[0]
        if n_total > max_clusters:
            order = np.argsort(centers_orig[:, 0])  # sort by L* for deterministic spacing
            keep_idx = np.linspace(0, n_total - 1, max_clusters).round().astype(int)
            keep = np.unique(order[keep_idx])
            centers_orig = centers_orig[keep]
            centers_sim = centers_sim[keep]
            cluster_weights = cluster_weights[keep]
            index_map = index_map[keep]

    n_clusters = centers_sim.shape[0]
    candidates = []

    for i in range(n_clusters):
        for j in range(i + 1, n_clusters):
            ci_sim = centers_sim[i]
            cj_sim = centers_sim[j]

            # Primary check: perceptual distance in simulated space
            de_sim = delta_e_fn(ci_sim, cj_sim)

            # Red/green pairs use a higher simulated ΔE threshold.
            a_i, a_j = float(centers_orig[i][1]), float(centers_orig[j][1])
            w_i, w_j = float(cluster_weights[i]), float(cluster_weights[j])
            is_red_i = (a_i > _A_MIN) and (orig_chroma[i] > _CHROMA_MIN)
            is_green_i = (a_i < -_A_MIN) and (orig_chroma[i] > _CHROMA_MIN)
            is_red_j = (a_j > _A_MIN) and (orig_chroma[j] > _CHROMA_MIN)
            is_green_j = (a_j < -_A_MIN) and (orig_chroma[j] > _CHROMA_MIN)
            is_rg_pair = (is_red_i and is_green_j) or (is_green_i and is_red_j)

            if min(w_i, w_j) < min_cluster_weight and not is_rg_pair:
                continue

            pair_threshold = rg_separation_threshold if is_rg_pair else threshold

            if is_rg_pair:
                # Idempotence guard: a previously corrected image often has
                # red already dark and green already light. Do not re-encode
                # that pair again just because chroma still looks red/green.
                red_idx = i if is_red_i else j
                green_idx = i if is_green_i else j
                red_l = float(centers_orig[red_idx][0])
                green_l = float(centers_orig[green_idx][0])
                if green_l - red_l >= rg_original_luminance_threshold:
                    continue

                L_i = float(ci_sim[0])
                L_j = float(cj_sim[0])
                if abs(L_i - L_j) >= rg_luminance_threshold:
                    continue

            if de_sim >= pair_threshold:
                continue  # Colors are distinguishable — no conflict

            # Secondary check: Were the colors distinguishable originally?
            # If the two clusters are essentially the same color to a normal viewer
            # (e.g. two shades of white), they aren't a CVD conflict.
            ci_orig = centers_orig[i]
            cj_orig = centers_orig[j]
            de_orig = delta_e_fn(ci_orig, cj_orig)
            
            if de_orig < 12.0:
                continue

            # If the perceptual distance didn't drop by at least 6.0 under CVD simulation,
            # the low contrast is inherent to the original image (e.g. two shades of green)
            # and is not a CVD-caused conflict.
            if de_sim >= de_orig - 6.0:
                continue

            severity_score = (pair_threshold - de_sim) * (w_i + w_j)
            if is_rg_pair:
                severity_score *= 4.0
            candidates.append((severity_score, int(index_map[i]), int(index_map[j])))

    candidates.sort(reverse=True)
    if max_conflicts is not None and max_conflicts > 0:
        candidates = candidates[:max_conflicts]
    return [(i, j) for _, i, j in candidates]
