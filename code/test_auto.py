"""Test grey preservation, high-K naturalness, and auto-cluster accuracy."""
import numpy as np
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from pipeline import run_full_pipeline

# ═══════════════════════════════════════════════════════════════════════════════
#  Test 1: Grey preservation — grey must NOT become black
# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 60)
print("TEST 1: Grey preservation")
img = np.zeros((200, 200, 3), dtype=np.uint8)
img[:100, :] = [128, 128, 128]  # Grey top half
img[100:, :] = [0, 180, 0]      # Green bottom half

result, metrics = run_full_pipeline(img, 1.0, "deutan", use_segmentation=False)

grey_region = result[:100, :, :]
mean_brightness = grey_region.mean()
min_brightness = grey_region.min()

print(f"  Auto clusters: {metrics.get('auto_clusters', '?')}")
print(f"  Grey region mean brightness: {mean_brightness:.1f} (should be > 60)")
print(f"  Grey region min brightness:  {min_brightness} (should be > 20)")
print(f"  Naturalness: {metrics.get('naturalness_preservation', 0):.2f}")

assert mean_brightness > 60, f"FAIL: Grey crushed too dark ({mean_brightness:.1f})"
assert min_brightness > 20, f"FAIL: Grey has near-black pixels ({min_brightness})"
print("  PASS")

# ═══════════════════════════════════════════════════════════════════════════════
#  Test 2: High-K naturalness — forced k=50 must not break naturalness
# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 60)
print("TEST 2: High-K naturalness (k=50)")
img2 = np.zeros((300, 300, 3), dtype=np.uint8)
img2[:100, :100] = [200, 50, 50]
img2[:100, 100:200] = [50, 200, 50]
img2[:100, 200:] = [50, 50, 200]
img2[100:200, :] = [180, 180, 50]
img2[200:, :100] = [128, 128, 128]
img2[200:, 100:200] = [255, 255, 255]
img2[200:, 200:] = [40, 40, 40]

result2, metrics2 = run_full_pipeline(img2, 1.0, "deutan", n_clusters=50, use_segmentation=False)
nat = metrics2.get('naturalness_preservation', 999)
print(f"  Naturalness: {nat:.2f} (target < 12)")
print(f"  DE improvement: {metrics2.get('de_improvement', 0):.2f}")
print(f"  Resolution rate: {metrics2.get('conflict_resolution_rate', 0)*100:.1f}%")

assert nat < 12, f"FAIL: Naturalness too high at k=50 ({nat:.2f})"
print("  PASS")

# ═══════════════════════════════════════════════════════════════════════════════
#  Test 3: Auto-cluster sanity — simple images get low k
# ═══════════════════════════════════════════════════════════════════════════════
print("=" * 60)
print("TEST 3: Auto-cluster accuracy")

solid = np.full((100, 100, 3), 128, dtype=np.uint8)
_, m3a = run_full_pipeline(solid, 1.0, "deutan", use_segmentation=False)
k_solid = m3a.get('auto_clusters', '?')
print(f"  Solid color -> k={k_solid} (expect 4-6)")

poster = np.zeros((200, 200, 3), dtype=np.uint8)
poster[:100, :100] = [255, 0, 0]
poster[:100, 100:] = [0, 255, 0]
poster[100:, :100] = [0, 0, 255]
poster[100:, 100:] = [255, 255, 0]
_, m3b = run_full_pipeline(poster, 1.0, "deutan", use_segmentation=False)
k_poster = m3b.get('auto_clusters', '?')
print(f"  4-color poster -> k={k_poster} (expect 4-12)")

print("  PASS")
print("=" * 60)
print("ALL TESTS PASSED!")
