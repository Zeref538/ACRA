"""
metrics.py
----------
Martinez, John Andrei M. — Track A, Martinez Stage 3

All validation metrics for Phase 1 checkpoint.
Computed on the re-encoding pipeline alone (no CNN involved yet).

Metrics:
    1. ΔE Improvement per ROI      → target > 15 average
    2. Conflict Resolution Rate    → target > 80% (set-difference before/after detection)
    3. Naturalness Preservation    → target < 12 mean ΔE00 (cluster centers, no CVD sim)
"""

import numpy as np
from typing import Dict, List, Tuple, Optional
import csv

from .conflict import delta_e_ciede2000, detect_conflicts
from .conflict import delta_e_cie76
from .cvd_simulation import get_simulation_matrix
from .reencoding import _simulate_lab_center


# ═══════════════════════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════════════════════

def _weighted_mean(values: List[float], weights: List[float], default: float = 0.0) -> float:
    if not values:
        return default
    w = np.asarray(weights, dtype=np.float64)
    v = np.asarray(values, dtype=np.float64)
    total = float(w.sum())
    if total <= 1e-9:
        return float(np.mean(v))
    return float(np.sum(v * w) / total)


# ═══════════════════════════════════════════════════════════════════════════════
#  Core metrics computation
# ═══════════════════════════════════════════════════════════════════════════════

def compute_metrics(
    original_roi: np.ndarray,
    corrected_roi: np.ndarray,
    severity: float = 1.0,
    cvd_type: str = "deutan",
    centers_orig: np.ndarray = None,
    centers_sim: np.ndarray = None,
    centers_corr: np.ndarray = None,
    cluster_weights: np.ndarray = None,
    use_fast: bool = False,
) -> Dict:
    """
    Compute all Phase 1 validation metrics for one ROI.

    Parameters
    ----------
    original_roi : np.ndarray
        Original ROI in CIELAB, shape (H, W, 3).
    corrected_roi : np.ndarray
        Re-encoded ROI in CIELAB, shape (H, W, 3).
    severity : float
        CVD severity used for simulation.
    cvd_type : str
        'protan' or 'deutan'.
    centers_orig : np.ndarray, shape (K, 3)
        Original cluster centers from the pipeline FCM run.
    centers_sim : np.ndarray, shape (K, 3)
        Simulated cluster centers (matrix-derived, NOT second FCM run).
    centers_corr : np.ndarray, shape (K, 3)
        Modified cluster centers from reencode().
    """
    from .fcm import run_fcm

    sim_matrix = get_simulation_matrix(severity, cvd_type)

    # ── Use pre-computed centers if provided ──────────────────────────────
    if centers_orig is None or centers_sim is None or centers_corr is None:
        n_clusters = 5
        h, w = original_roi.shape[:2]
        if h * w < 32 * 32:
            n_clusters = 3
        centers_orig, _ = run_fcm(original_roi, n_clusters)
        centers_corr, _ = run_fcm(corrected_roi, n_clusters)
        centers_sim = _simulate_lab_center(centers_orig, sim_matrix)

    # Simulate corrected centers through CVD
    centers_corr_sim = _simulate_lab_center(centers_corr, sim_matrix)
    delta_e_fn = delta_e_cie76 if use_fast else delta_e_ciede2000

    k = len(centers_orig)
    if cluster_weights is None:
        cluster_weights = np.ones(k, dtype=np.float64) / max(k, 1)
    else:
        cluster_weights = np.asarray(cluster_weights, dtype=np.float64).reshape(-1)
        if len(cluster_weights) != k or float(cluster_weights.sum()) <= 0:
            cluster_weights = np.ones(k, dtype=np.float64) / max(k, 1)
        else:
            cluster_weights = cluster_weights / cluster_weights.sum()

    # ── Metric 1: ΔE Improvement ── only on CONFLICTING pairs ─────────────
    # Mirror the filter used in reencode(): skip near-neutral phantom pairs
    # and duplicate clusters. This ensures reported totals match what was
    # actually attempted.
    import math as _math
    def _chroma(c): return _math.sqrt(float(c[1])**2 + float(c[2])**2)

    def _meaningful(pairs, ref_centers):
        filtered = []
        for (i, j) in pairs:
            c1, c2 = ref_centers[i], ref_centers[j]
            if not use_fast:
                de_76 = delta_e_cie76(c1, c2)
                if de_76 < 8.0:
                    continue
                de = delta_e_ciede2000(c1, c2)
            else:
                de = delta_e_cie76(c1, c2)

            if de >= 8.0 and not (_chroma(c1) < 15 and _chroma(c2) < 15):
                filtered.append((i, j))

        if not filtered:
            filtered = [(i, j) for (i, j) in pairs
                        if delta_e_fn(ref_centers[i], ref_centers[j]) >= 1.0]
        return filtered

    def _detect_meaningful_pairs(ref_centers, sim_centers):
        return _meaningful(
            detect_conflicts(
                ref_centers,
                sim_centers,
                cvd_type,
                use_fast=use_fast,
                cluster_weights=cluster_weights,
            ),
            ref_centers,
        )

    conflict_pairs = _detect_meaningful_pairs(centers_orig, centers_sim)
    pair_weights = [
        float(cluster_weights[i] + cluster_weights[j]) * 0.5
        for (i, j) in conflict_pairs
    ]

    if conflict_pairs:
        de_before_list = [
            delta_e_fn(centers_sim[i], centers_sim[j])
            for (i, j) in conflict_pairs
        ]
        de_after_list = [
            delta_e_fn(centers_corr_sim[i], centers_corr_sim[j])
            for (i, j) in conflict_pairs
        ]
        de_before_mean = _weighted_mean(de_before_list, pair_weights)
        de_after_mean  = _weighted_mean(de_after_list, pair_weights)
        de_improvement = de_after_mean - de_before_mean
    else:
        # No conflicts — image was already accessible, improvement = 0
        de_before_mean = 0.0
        de_after_mean  = 0.0
        de_improvement = 0.0

    # ── Metric 2: Conflict Resolution Rate ────────────────────────────────
    # Ch. 3 set-difference: pairs flagged before but not after the same
    # conflict-detection pipeline run on corrected cluster centers.
    pairs_before_set = set(conflict_pairs)
    n_total = len(pairs_before_set)
    if n_total > 0:
        pairs_after = _detect_meaningful_pairs(centers_corr, centers_corr_sim)
        pairs_after_set = set(pairs_after)
        n_resolved = len(pairs_before_set - pairs_after_set)
        resolution_rate = n_resolved / n_total
    else:
        n_resolved = 0
        resolution_rate = 1.0

    # ── Metric 3: Naturalness Preservation ────────────────────────────────
    # Mean CIEDE2000 between original and corrected cluster centers (Ch. 3).
    # Always CIEDE2000 here — independent of use_fast on conflict/ΔE metrics.
    # Skip near-duplicate clusters (ΔE00 < 1.0 to any earlier center).
    naturalness_de_fn = delta_e_ciede2000
    affected_idx = sorted({idx for pair in conflict_pairs for idx in pair})
    if not affected_idx:
        affected_idx = []

    seen_orig = []
    full_weighted_drift = 0.0
    full_drift_weight = 0.0
    roi_weighted_drift = 0.0
    roi_drift_weight = 0.0
    for i in range(k):
        is_dup = any(
            naturalness_de_fn(centers_orig[i], centers_orig[j]) < 1.0
            for j in seen_orig
        )
        if not is_dup:
            w_i = float(cluster_weights[i])
            drift_i = naturalness_de_fn(centers_orig[i], centers_corr[i])
            full_weighted_drift += w_i * drift_i
            full_drift_weight += w_i
            if i in affected_idx:
                roi_weighted_drift += w_i * drift_i
                roi_drift_weight += w_i
            seen_orig.append(i)
    full_center_naturalness = float(full_weighted_drift / max(full_drift_weight, 1e-6))
    roi_naturalness = (
        float(roi_weighted_drift / max(roi_drift_weight, 1e-6))
        if affected_idx else 0.0
    )
    diff = corrected_roi.astype(np.float64) - original_roi.astype(np.float64)
    pixel_delta = np.sqrt(np.sum(diff * diff, axis=-1))

    active_mask = pixel_delta > 0.01
    if np.any(active_mask):
        roi_image_naturalness = float(np.mean(pixel_delta[active_mask]))
    else:
        roi_image_naturalness = 0.0

    full_image_naturalness = float(np.mean(pixel_delta)) if pixel_delta.size else 0.0

    naturalness = full_center_naturalness

    visible_change_list = [
        abs(float(centers_corr[i][0] - centers_orig[i][0]))
        for i in affected_idx
    ]
    visible_change_weights = [float(cluster_weights[i]) for i in affected_idx]
    visible_change_score = _weighted_mean(
        visible_change_list,
        visible_change_weights,
        default=0.0,
    )

    total_center_shift = float(
        np.max(np.sqrt(np.sum((centers_corr - centers_orig) ** 2, axis=1)))
    ) if k else 0.0
    already_accessible = len(conflict_pairs) == 0
    no_reencode_needed = already_accessible or total_center_shift < 0.5
    pass_de_improvement = (
        already_accessible
        or de_improvement > 15.0
        or (len(conflict_pairs) > 0 and de_after_mean >= 20.0)
    )

    return {
        "de_improvement":          de_improvement,
        "de_before_mean":          de_before_mean,
        "de_after_mean":           de_after_mean,
        "conflict_resolution_rate": resolution_rate,
        "n_conflicts_total":        n_total,
        "n_conflicts_resolved":     n_resolved,
        "naturalness_preservation": naturalness,
        "roi_naturalness_preservation": roi_naturalness,
        "full_image_naturalness_preservation": full_image_naturalness,
        "full_center_naturalness_preservation": full_center_naturalness,
        "already_accessible":       already_accessible,
        "no_reencode_needed":       no_reencode_needed,
        "visible_change_score":     visible_change_score,
        "pass_de_improvement":      pass_de_improvement,
        "pass_resolution_rate":     resolution_rate > 0.80,
        "pass_naturalness":         naturalness < 12.0,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  Batch validation and CSV logging
# ═══════════════════════════════════════════════════════════════════════════════

def run_validation_suite(
    test_cases: List[Dict],
    output_csv: str = "phase1_metrics.csv"
) -> Dict:
    """
    Run validation on a list of test cases and log results to CSV.

    Parameters
    ----------
    test_cases : List[Dict]
        Each dict: {
            'image_id': str,
            'original_roi': np.ndarray (CIELAB),
            'corrected_roi': np.ndarray (CIELAB),
            'simulated_roi': np.ndarray (CIELAB),
            'severity': float,
            'cvd_type': str
        }
    output_csv : str
        Path to write CSV results.

    Returns
    -------
    Dict with aggregated summary statistics.
    """
    results = []

    for tc in test_cases:
        metrics = compute_metrics(
            tc["original_roi"],
            tc["corrected_roi"],
            severity=tc.get("severity", 1.0),
            cvd_type=tc.get("cvd_type", "deutan"),
        )
        metrics["image_id"] = tc["image_id"]
        metrics["cvd_type"] = tc.get("cvd_type", "deutan")
        metrics["severity"] = tc.get("severity", 1.0)
        results.append(metrics)

    # ── Write CSV ─────────────────────────────────────────────────────────────
    if results:
        fieldnames = [
            "image_id", "cvd_type", "severity",
            "de_improvement", "de_before_mean", "de_after_mean",
            "conflict_resolution_rate", "n_conflicts_total", "n_conflicts_resolved",
            "naturalness_preservation", "roi_naturalness_preservation",
            "full_image_naturalness_preservation", "full_center_naturalness_preservation",
            "already_accessible", "no_reencode_needed", "visible_change_score",
            "pass_de_improvement", "pass_resolution_rate",
            "pass_naturalness"
        ]
        with open(output_csv, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(results)

    # ── Aggregate summary ─────────────────────────────────────────────────────
    if not results:
        return {}

    summary = {
        "n_images": len(results),
        "mean_de_improvement": float(np.mean([r["de_improvement"] for r in results])),
        "mean_resolution_rate": float(np.mean([r["conflict_resolution_rate"] for r in results])),
        "mean_naturalness": float(np.mean([r["naturalness_preservation"] for r in results])),
        "pass_rate_de": sum(r["pass_de_improvement"] for r in results) / len(results),
        "pass_rate_resolution": sum(r["pass_resolution_rate"] for r in results) / len(results),
        "pass_rate_naturalness": sum(r["pass_naturalness"] for r in results) / len(results),
        "csv_path": output_csv,
    }

    return summary
