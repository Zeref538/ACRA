import numpy as np
import math
from typing import List, Tuple
from .conflict import delta_e_ciede2000
from .cvd_simulation import get_simulation_matrix
from .cielab import to_cielab, from_cielab

def _simulate_lab_center(lab_centers: np.ndarray, sim_matrix: np.ndarray) -> np.ndarray:
    """Simulate CIELAB cluster centers through CVD."""
    is_1d = lab_centers.ndim == 1
    if is_1d:
        lab_centers = lab_centers.reshape(1, 3)

    from .__init__ import _lab_to_srgb_f32, _srgb_to_linear_clahe_f32, _linear_to_lab_f32
    rgb_sim = _lab_to_srgb_f32(lab_centers.astype(np.float32))
    
    # Linearize
    linear = np.where(rgb_sim <= 0.04045, rgb_sim / 12.92, ((rgb_sim + 0.055) / 1.055) ** 2.4)
    # Apply matrix
    sim_linear = np.clip(linear @ sim_matrix.T, 0.0, 1.0)
    # Back to lab
    sim_lab = _linear_to_lab_f32(sim_linear.astype(np.float32))
    
    return sim_lab[0] if is_1d else sim_lab

def reencode(
    centers: np.ndarray,
    conflict_pairs: List[Tuple[int, int]],
    severity: float,
    cvd_type: str,
) -> np.ndarray:
    """
    Guarded Red/Green Reprojection Pipeline.

    Resolves CVD conflicts by pushing lightness apart, with four guardrails:
      1. Per-center lightness floor — neutrals/greys never crush to black.
      2. Per-center naturalness budget — cumulative drift capped at MAX_DRIFT.
      3. Adaptive step size — centers in many conflicts get smaller steps.
      4. Light cap raised to 85 for better upward separation.
    """
    modified_centers = centers.copy().astype(np.float64)
    original_centers = centers.copy().astype(np.float64)

    if not conflict_pairs:
        return modified_centers

    sim_matrix = get_simulation_matrix(severity, cvd_type)

    # ── Guardrail 1: Per-center lightness floor ───────────────────────────
    # Neutrals (low chroma) get a tight floor — never crush grey to black.
    # Chromatic colors get more room to shift.
    n_centers = len(centers)
    L_floor = np.zeros(n_centers, dtype=np.float64)
    L_ceil  = np.full(n_centers, 85.0, dtype=np.float64)

    for k in range(n_centers):
        orig_L = float(original_centers[k][0])
        orig_chroma = math.sqrt(float(original_centers[k][1])**2 +
                                float(original_centers[k][2])**2)
        if orig_chroma < 15:
            # Neutral / grey — protect strongly
            L_floor[k] = max(orig_L - 15.0, 15.0)
        else:
            # Chromatic — more room but still don't crush to black
            L_floor[k] = max(orig_L - 25.0, 5.0)

        # Light ceiling: don't push further than 85 or +25 from original
        L_ceil[k] = min(85.0, orig_L + 25.0)

    # ── Guardrail 2: Per-center naturalness budget ────────────────────────
    MAX_DRIFT = 25.0  # max total ΔL per center across ALL conflict pairs
    drift = np.zeros(n_centers, dtype=np.float64)  # accumulated |ΔL|

    # ── Guardrail 3: Adaptive step size ───────────────────────────────────
    # Count how many conflict pairs each center participates in
    conflict_count = np.zeros(n_centers, dtype=np.int32)
    for ci, cj in conflict_pairs:
        conflict_count[ci] += 1
        conflict_count[cj] += 1

    def approx_luminance(L: float) -> float:
        return max(0.0, ((L + 16.0) / 116.0) ** 3.0)

    for ci, cj in conflict_pairs:
        c1 = modified_centers[ci]
        c2 = modified_centers[cj]

        # Determine dark/light assignment
        c1_chroma = math.sqrt(c1[1]**2 + c1[2]**2)
        c2_chroma = math.sqrt(c2[1]**2 + c2[2]**2)

        # Classify each center: is it "red-ish" (positive a*, chromatic)
        # or "green-ish" (negative a*, chromatic)?
        c1_is_red   = c1[1] > 10.0 and c1_chroma > 15.0
        c1_is_green = c1[1] < -10.0 and c1_chroma > 15.0
        c2_is_red   = c2[1] > 10.0 and c2_chroma > 15.0
        c2_is_green = c2[1] < -10.0 and c2_chroma > 15.0

        if c1_is_red and (c2_is_green or not c2_is_red):
            # c1 is red → push it dark; c2 goes light
            dark_idx, light_idx = ci, cj
        elif c2_is_red and (c1_is_green or not c1_is_red):
            # c2 is red → push it dark; c1 goes light
            dark_idx, light_idx = cj, ci
        elif c1_is_green and not c2_is_green:
            # c1 is green → push it light; c2 goes dark
            dark_idx, light_idx = cj, ci
        elif c2_is_green and not c1_is_green:
            # c2 is green → push it light; c1 goes dark
            dark_idx, light_idx = ci, cj
        else:
            # Neither has clear red/green character (both neutral,
            # both same hue, etc.) — push apart by existing lightness.
            if c1[0] > c2[0]:
                light_idx, dark_idx = ci, cj
            else:
                light_idx, dark_idx = cj, ci

        dark_target  = modified_centers[dark_idx]
        light_target = modified_centers[light_idx]

        # Adaptive step: scale down when a center is in many conflicts
        step_dark  = 4.0 / max(1, min(conflict_count[dark_idx], 5))
        step_light = 2.0 / max(1, min(conflict_count[light_idx], 5))

        for _ in range(30):
            sim_1 = _simulate_lab_center(dark_target, sim_matrix)
            sim_2 = _simulate_lab_center(light_target, sim_matrix)

            de_ok = delta_e_ciede2000(sim_1, sim_2) >= 20.5

            Y_dark  = approx_luminance(dark_target[0])
            Y_light = approx_luminance(light_target[0])
            lighter_Y = max(Y_dark, Y_light)
            darker_Y  = min(Y_dark, Y_light)
            wcag_ok = ((lighter_Y + 0.05) / (darker_Y + 0.05)) >= 3.0

            if de_ok and wcag_ok:
                break

            # Check drift budgets before pushing
            dark_budget  = MAX_DRIFT - drift[dark_idx]
            light_budget = MAX_DRIFT - drift[light_idx]

            if dark_budget < 0.5 and light_budget < 0.5:
                break  # both centers exhausted — stop to preserve naturalness

            # Push dark target darker (respect floor and budget)
            if dark_budget >= 0.5 and dark_target[0] > L_floor[dark_idx]:
                actual_step = min(step_dark, dark_budget,
                                  dark_target[0] - L_floor[dark_idx])
                dark_target[0] -= actual_step
                drift[dark_idx] += actual_step

            # Push light target lighter (respect ceiling and budget)
            if light_budget >= 0.5 and light_target[0] < L_ceil[light_idx]:
                actual_step = min(step_light, light_budget,
                                  L_ceil[light_idx] - light_target[0])
                light_target[0] += actual_step
                drift[light_idx] += actual_step

    return modified_centers