import sys, os
sys.path.append('.')
import numpy as np
import colorsys
from pipeline.cvd_simulation import simulate_cvd
from pipeline.cielab import to_cielab
from pipeline.conflict import delta_e_ciede2000

def hex_to_rgb_linear(h):
    h = h.lstrip('#')
    rgb = tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    img = np.array([[[rgb[0]/255.0, rgb[1]/255.0, rgb[2]/255.0]]], dtype=np.float32)
    return np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)

def wcag_lum(linear):
    l = linear[0,0]
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]

def get_de(hex1, hex2):
    l1 = hex_to_rgb_linear(hex1)
    l2 = hex_to_rgb_linear(hex2)
    s1 = simulate_cvd(l1, 1.0, 'deutan')
    s2 = simulate_cvd(l2, 1.0, 'deutan')
    return delta_e_ciede2000(to_cielab(s1).reshape(3), to_cielab(s2).reshape(3))

def wcag_cr(hex1, hex2):
    L1 = wcag_lum(hex_to_rgb_linear(hex1))
    L2 = wcag_lum(hex_to_rgb_linear(hex2))
    return (max(L1, L2) + 0.05) / (min(L1, L2) + 0.05)

g_dark = '#1B3F1D'
print(f'DE orig red vs dark green: {get_de("#F44336", g_dark):.2f}')
print(f'CR orig red vs dark green: {wcag_cr("#F44336", g_dark):.2f}:1')

r_superdark = '#680C05'
print(f'DE orig green vs superdark red: {get_de("#4CAF50", r_superdark):.2f}')
print(f'CR orig green vs superdark red: {wcag_cr("#4CAF50", r_superdark):.2f}:1')
