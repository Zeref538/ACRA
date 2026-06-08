import numpy as np
from typing import List, Tuple

from .conflict import delta_e_cie76, delta_e_ciede2000
from .cvd_simulation import get_simulation_matrix


def _simulate_lab_center(lab_centers: np.ndarray, sim_matrix: np.ndarray) -> np.ndarray:
    """Simulate CIELAB cluster centers through CVD."""
    is_1d = lab_centers.ndim == 1
    if is_1d:
        lab_centers = lab_centers.reshape(1, 3)

    from .__init__ import _lab_to_srgb_f32, _linear_to_lab_f32

    rgb_sim = _lab_to_srgb_f32(lab_centers.astype(np.float32))
    linear = np.where(
        rgb_sim <= 0.04045,
        rgb_sim / 12.92,
        ((rgb_sim + 0.055) / 1.055) ** 2.4,
    )
    sim_linear = np.clip(linear @ sim_matrix.T, 0.0, 1.0)
    sim_lab = _linear_to_lab_f32(sim_linear.astype(np.float32))

    return sim_lab[0] if is_1d else sim_lab


def _chroma(center: np.ndarray) -> float:
    return float(np.hypot(center[1], center[2]))


def _is_red(center: np.ndarray) -> bool:
    return float(center[1]) > 6.0 and _chroma(center) > 12.0


def _red_strength(center: np.ndarray) -> float:
    """Return 0..1 strength for how red a center is (a* and chroma)."""
    a = float(center[1])
    c = _chroma(center)
    a_score = np.clip((a - 6.0) / 22.0, 0.0, 1.0)
    c_score = np.clip((c - 12.0) / 28.0, 0.0, 1.0)
    return float(0.6 * a_score + 0.4 * c_score)


def _is_green(center: np.ndarray) -> bool:
    return float(center[1]) < -10.0 and _chroma(center) > 15.0


def _green_strength(center: np.ndarray) -> float:
    """Return 0..1 strength for how green a center is (a* and chroma)."""
    a = float(center[1])
    c = _chroma(center)
    a_score = np.clip((-a - 10.0) / 24.0, 0.0, 1.0)
    c_score = np.clip((c - 15.0) / 30.0, 0.0, 1.0)
    return float(0.6 * a_score + 0.4 * c_score)


# Near-achromatic centers (black/white/gray text & ink). Kept consistent with
# conflict.py._CHROMA_MIN (15) and _is_red()'s chroma>12 floor.
NEUTRAL_CHROMA = 12.0


def _is_neutral(center: np.ndarray) -> bool:
    """True for near-achromatic centers — text, ink and paper must not move."""
    return _chroma(center) < NEUTRAL_CHROMA


def _scale_chroma(
    center: np.ndarray,
    scale: float,
    max_delta_chroma: float,
) -> np.ndarray:
    """Scale a*/b* chroma without rotating hue."""
    out = center.copy()
    c = _chroma(out)
    if c < 1e-6:
        return out

    target_c = c * scale
    target_c = np.clip(target_c, max(0.0, c - max_delta_chroma), c + max_delta_chroma)
    out[1:3] *= target_c / c
    return out


def _candidate_center(
    base: np.ndarray,
    delta_l: float,
    chroma_scale: float,
    max_delta_chroma: float,
) -> np.ndarray:
    out = _scale_chroma(base.astype(np.float64), chroma_scale, max_delta_chroma)
    out[0] = np.clip(float(base[0]) + delta_l, 5.0, 95.0)
    return out


def _classify_pair(centers: np.ndarray, ci: int, cj: int) -> Tuple[int, int, bool]:
    c1_red, c1_green = _is_red(centers[ci]), _is_green(centers[ci])
    c2_red, c2_green = _is_red(centers[cj]), _is_green(centers[cj])
    is_rg_pair = (c1_red and c2_green) or (c1_green and c2_red)

    if c1_red and (c2_green or not c2_red):
        return ci, cj, is_rg_pair
    if c2_red and (c1_green or not c1_red):
        return cj, ci, is_rg_pair
    if c1_green and not c2_green:
        return cj, ci, is_rg_pair
    if c2_green and not c1_green:
        return ci, cj, is_rg_pair
    if centers[ci][0] <= centers[cj][0]:
        return ci, cj, is_rg_pair
    return cj, ci, is_rg_pair


def _clipping_penalty(center: np.ndarray) -> float:
    """Small penalty for colors likely to clip after LAB to sRGB conversion."""
    L = float(center[0])
    c = _chroma(center)
    penalty = max(0.0, 8.0 - L) + max(0.0, L - 92.0)
    penalty += max(0.0, c - 85.0) * 0.15
    return penalty


def reencode(
    centers: np.ndarray,
    conflict_pairs: List[Tuple[int, int]],
    severity: float,
    cvd_type: str,
    use_fast: bool = False,
    target_de: float = 24.0,
    target_rg_l_gap: float = 30.0,
    allow_chroma_shift: bool = True,
    max_delta_l: float = 38.0,
    max_delta_chroma: float = 10.0,
    refinement_passes: int = 2,
) -> np.ndarray:
    """
    Bounded candidate-search re-encoding.

    The optimizer tries conservative L* and chroma candidates for each
    conflicting pair, then keeps the candidate that best satisfies simulated
    separation, visible red/green lightness gap, and naturalness.
    """
    original_centers = centers.copy().astype(np.float64)
    modified_centers = original_centers.copy()

    if not conflict_pairs:
        return modified_centers

    sim_matrix = get_simulation_matrix(severity, cvd_type)
    delta_e_fn = delta_e_cie76 if use_fast else delta_e_ciede2000

    cumulative_drift = np.zeros(len(centers), dtype=np.float64)

    # Protected clusters (text / ink / paper) are pinned — their centers must
    # never move, so the chromatic partner carries the whole separation.
    protected = np.array(
        [_is_neutral(c) for c in original_centers], dtype=bool
    )

    dark_steps = np.array([0.0, -5.0, -8.0, -10.0, -12.0, -15.0])
    light_steps = np.array([0.0, 5.0, 8.0, 10.0])
    rg_dark_steps = np.array([0.0, -8.0, -14.0, -20.0, -26.0])
    rg_light_steps = np.array([-8.0, -4.0, 0.0, 6.0, 12.0, 18.0])
    neutral_chroma = [1.0]
    red_chroma = [1.0, 1.10] if allow_chroma_shift else neutral_chroma
    green_chroma = [1.0, 1.06] if allow_chroma_shift else neutral_chroma
    other_chroma = [1.0, 1.08] if allow_chroma_shift else neutral_chroma

    for pass_idx in range(max(1, refinement_passes)):
        changed = False
        pass_target_de = 20.0 if pass_idx == refinement_passes - 1 else target_de

        for ci, cj in conflict_pairs:
            current_de = delta_e_fn(
                _simulate_lab_center(modified_centers[ci], sim_matrix),
                _simulate_lab_center(modified_centers[cj], sim_matrix),
            )
            if current_de >= pass_target_de:
                continue

            dark_idx, light_idx, is_rg_pair = _classify_pair(original_centers, ci, cj)

            # Two near-neutral clusters are already distinguishable by lightness
            # — nothing to fix, and neither may be recolored.
            if protected[dark_idx] and protected[light_idx]:
                continue

            red_strength = 0.0
            green_strength = 0.0
            red_min_l = 18.0
            red_max_l = 52.0
            green_min_l = 46.0
            green_max_l = 76.0
            rg_gap_target = target_rg_l_gap
            if is_rg_pair:
                red_idx = ci if _is_red(original_centers[ci]) else cj
                green_idx = ci if _is_green(original_centers[ci]) else cj
                original_red_l = float(original_centers[red_idx][0])
                original_green_l = float(original_centers[green_idx][0])
                red_strength = _red_strength(original_centers[red_idx])
                green_strength = _green_strength(original_centers[green_idx])
                red_min_l = 14.0 + 4.0 * (1.0 - red_strength)
                red_max_l = 48.0 - 10.0 * red_strength
                green_min_l = 46.0 + 4.0 * green_strength
                green_max_l = 72.0 + 4.0 * green_strength
                rg_gap_target = target_rg_l_gap + 4.0 * min(red_strength, green_strength)

            if is_rg_pair:
                red_idx = ci if _is_red(original_centers[ci]) else cj
                green_idx = ci if _is_green(original_centers[ci]) else cj
                red_l = float(modified_centers[red_idx][0])
                green_l = float(modified_centers[green_idx][0])
                if green_l - red_l >= rg_gap_target and current_de >= 20.0:
                    continue

            dark_base = modified_centers[dark_idx]
            light_base = modified_centers[light_idx]
            dark_is_red   = _is_red(original_centers[dark_idx])
            light_is_green = _is_green(original_centers[light_idx])
            pair_dark_steps = rg_dark_steps if is_rg_pair and dark_is_red else dark_steps
            pair_light_steps = rg_light_steps if is_rg_pair and light_is_green else light_steps
            dark_l_budget = min(max_delta_l, 16.0 + 16.0 * red_strength) if is_rg_pair and dark_is_red else 10.0
            light_l_budget = min(max_delta_l, 26.0 + 14.0 * green_strength) if is_rg_pair and light_is_green else 10.0

            dark_chroma_options  = red_chroma   if dark_is_red   else other_chroma
            light_chroma_options = green_chroma if light_is_green else other_chroma

            # Pin protected (near-neutral) clusters: no lightness or chroma move.
            if protected[dark_idx]:
                pair_dark_steps = np.array([0.0])
                dark_chroma_options = neutral_chroma
            if protected[light_idx]:
                pair_light_steps = np.array([0.0])
                light_chroma_options = neutral_chroma

            best_score = -np.inf
            best_dark = dark_base.copy()
            best_light = light_base.copy()

            for dl_dark in pair_dark_steps:
                for dl_light in pair_light_steps:
                    for c_dark in dark_chroma_options:
                        for c_light in light_chroma_options:
                            cand_dark = _candidate_center(
                                dark_base, dl_dark, c_dark, max_delta_chroma
                            )
                            cand_light = _candidate_center(
                                light_base, dl_light, c_light, max_delta_chroma
                            )

                            if dark_is_red:
                                cand_dark[0] = max(cand_dark[0], red_min_l)
                                cand_dark[0] = min(cand_dark[0], red_max_l)
                            if light_is_green:
                                cand_light[0] = max(cand_light[0], green_min_l)
                                cand_light[0] = min(cand_light[0], green_max_l)

                            if abs(float(cand_dark[0]) - float(original_centers[dark_idx][0])) > dark_l_budget:
                                continue
                            if abs(float(cand_light[0]) - float(original_centers[light_idx][0])) > light_l_budget:
                                continue

                            sim_dark = _simulate_lab_center(cand_dark, sim_matrix)
                            sim_light = _simulate_lab_center(cand_light, sim_matrix)
                            de_sim = delta_e_fn(sim_dark, sim_light)
                            l_gap = float(cand_light[0] - cand_dark[0])
                            rg_gap = 0.0
                            red_l = green_l = None
                            red_drop = green_lift = 0.0
                            if is_rg_pair:
                                cand_red = cand_dark if dark_idx == red_idx else cand_light
                                cand_green = cand_light if light_idx == green_idx else cand_dark
                                red_l = float(cand_red[0])
                                green_l = float(cand_green[0])
                                rg_gap = green_l - red_l
                                red_drop = max(0.0, original_red_l - red_l)
                                green_lift = max(0.0, green_l - green_min_l)

                            drift_dark = delta_e_fn(original_centers[dark_idx], cand_dark)
                            drift_light = delta_e_fn(original_centers[light_idx], cand_light)
                            mean_drift = 0.5 * (drift_dark + drift_light)
                            extra_drift = cumulative_drift[dark_idx] + cumulative_drift[light_idx]

                            score = 0.0
                            score += min(de_sim, target_de + 12.0) * 20.0
                            score += min(max(l_gap, 0.0), rg_gap_target + 14.0) * 3.0
                            if is_rg_pair:
                                score += min(max(rg_gap, 0.0), rg_gap_target + 20.0) * 9.0
                                score += min(red_drop, 28.0) * 5.0
                                green_above_min = max(0.0, green_l - green_min_l)
                                score += min(green_above_min, 20.0) * 4.0
                                score -= max(0.0, green_lift - red_drop) * 22.0
                                score -= max(0.0, green_lift * 1.35 - red_drop) * 9.0
                                if rg_gap < 0:
                                    score -= 400.0
                                else:
                                    score -= max(0.0, rg_gap_target - rg_gap) * 38.0
                            if de_sim >= 20.0:
                                score += 120.0
                            if de_sim >= target_de:
                                score += 60.0
                            if (not is_rg_pair) or l_gap >= rg_gap_target:
                                score += 80.0

                            score -= max(0.0, 20.0 - de_sim) * 50.0
                            drift_soft_limit = 24.0 if is_rg_pair else 22.0
                            score -= max(0.0, mean_drift - drift_soft_limit) * 4.5
                            score -= extra_drift * 0.15
                            score -= _clipping_penalty(cand_dark) * 8.0
                            score -= _clipping_penalty(cand_light) * 8.0

                            if dark_is_red and cand_dark[0] < red_min_l:
                                score -= 120.0
                            if light_is_green and cand_light[0] > green_max_l:
                                score -= 160.0

                            if is_rg_pair and red_l is not None and green_l is not None:
                                score -= max(0.0, green_min_l - green_l) * 55.0
                                score -= max(0.0, red_l - (red_max_l - 4.0)) * 70.0
                                if red_l > red_max_l:
                                    score -= (red_l - red_max_l) * (140.0 + 60.0 * red_strength)
                                if red_l < red_min_l:
                                    score -= (red_min_l - red_l) * 120.0
                                if green_l < green_min_l:
                                    score -= (green_min_l - green_l) * (110.0 + 50.0 * green_strength)
                                if green_l > green_max_l:
                                    score -= (green_l - green_max_l) * 150.0

                            if not light_is_green:
                                score -= max(0.0, float(cand_light[0]) - 73.0) * 120.0
                            if dark_is_red:
                                score -= max(0.0, red_min_l - float(cand_dark[0])) * 55.0
                            else:
                                score -= max(0.0, 35.0 - float(cand_dark[0])) * 40.0

                            if score > best_score:
                                best_score = score
                                best_dark = cand_dark
                                best_light = cand_light

            if (
                delta_e_fn(modified_centers[dark_idx], best_dark) > 1e-6
                or delta_e_fn(modified_centers[light_idx], best_light) > 1e-6
            ):
                changed = True
            cumulative_drift[dark_idx] += delta_e_fn(modified_centers[dark_idx], best_dark)
            cumulative_drift[light_idx] += delta_e_fn(modified_centers[light_idx], best_light)
            modified_centers[dark_idx] = best_dark
            modified_centers[light_idx] = best_light

        if not changed:
            break

    return modified_centers


def enforce_rg_separation(
    centers: np.ndarray,
    target_gap: float = 30.0,
    l_min: float = 10.0,
    l_max: float = 90.0,
) -> np.ndarray:
    """
    Deterministic safety net: guarantee green clusters read lighter than red
    clusters for a CVD viewer.

    Unlike reencode()'s scored search, this runs unconditionally and bypasses
    the conflict-detection idempotence guards. It is idempotent by construction
    — an already-separated input is returned unchanged.

    The red group is shifted down and the green group up by equal halves of any
    lightness shortfall. The shift is rigid per group, so light/dark variation
    within the reds (or greens) is preserved.

    Parameters
    ----------
    centers    : (K, 3) cluster centers in CIELAB (typically reencode()'s output)
    target_gap : minimum median L* gap to enforce between greens and reds
    l_min/l_max: hard L* clamp so shifted centers stay in a sane range
    """
    out = centers.copy().astype(np.float64)
    if out.shape[0] == 0:
        return out

    red_idx = [i for i in range(out.shape[0]) if _is_red(out[i])]
    green_idx = [i for i in range(out.shape[0]) if _is_green(out[i])]
    if not red_idx or not green_idx:
        return out  # need both a red and a green cluster to separate

    red_l = float(np.median(out[red_idx, 0]))
    green_l = float(np.median(out[green_idx, 0]))
    shortfall = target_gap - (green_l - red_l)
    if shortfall <= 0.0:
        return out  # already separated — no-op (keeps the pass idempotent)

    half = shortfall / 2.0
    for i in red_idx:
        out[i, 0] = float(np.clip(out[i, 0] - half, l_min, l_max))
    for i in green_idx:
        out[i, 0] = float(np.clip(out[i, 0] + half, l_min, l_max))
    return out
