import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Play, Pause, RotateCcw, Upload } from 'lucide-react'
import { AppShell } from '../components/layout/AppShell'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { UploadZone } from '../components/upload/UploadZone'
import { MetricsPanel } from '../components/results/MetricsPanel'
import { BoundingBoxCanvas } from '../components/results/BoundingBoxCanvas'
import { ImageViewer } from '../components/ui/ImageViewer'
import { useToast } from '../components/ui/Toast'
import { processImage } from '../lib/api'

// ── CVD filter matrices ────────────────────────────────────────────────────────
const CVD_MATRIX = {
  deutan: '0.293 0.707 0 0 0  0.293 0.707 0 0 0  0 0.022 0.978 0 0  0 0 0 1 0',
}

// ── Framework stage definitions ─────────────────────────────────────────────────
const STAGES = [
  {
    id: 'yolo', num: 'CNN', title: 'YOLOv8 Region Detection', subtitle: 'Neural Network — First Pass',
    author: 'Gallo, Dave Andre A.',
    desc: 'Before any color math runs, the neural network scans the image to identify meaningful regions. This tells the framework WHERE to apply corrections — protecting people, isolating symbols, and targeting color-critical areas.',
    bullets: [
      'Model: acra_medium_v7_best.pt — custom-trained on poster/infographic data',
      'Classes: roi-color, roi-object, roi-text, roi-symbol, exclude-person',
      'exclude-person regions are masked out — skin tones are never re-encoded',
      'If no regions found: HSV color fallback isolates red/green automatically',
    ],
  },
  {
    id: 'norm', num: '1', title: 'Normalization', subtitle: 'sRGB → Linear RGB',
    author: 'Gallo, Dave Andre A.',
    desc: 'The sRGB gamma curve is removed before any color transforms are applied. Applying LMS matrices directly to gamma-encoded values produces mathematically incorrect CVD simulation.',
    bullets: [
      'Piecewise formula: C/12.92 if C ≤ 0.04045, else ((C+0.055)/1.055)^2.4',
      'Output: float32 [0, 1] — physically proportional to light intensity',
      'Shadows are expanded; highlights are compressed by the curve',
      'CRITICAL: must precede every LMS-space transform in the framework',
    ],
  },
  {
    id: 'cvd', num: '2', title: 'CVD Simulation', subtitle: 'Machado 2009',
    author: 'Gallo, Dave Andre A.',
    desc: 'Simulates how the image appears to a CVD viewer at any severity from 0 (normal) to 1.0 (full dichromacy) using the Machado 2009 severity-interpolated model.',
    bullets: [
      'Chain: Linear RGB → LMS (HPE D65) → LMS_sim → Linear RGB → sRGB',
      'M_sim(s) = (1−s)·I + s·M_deficiency',
      'Deuteranopia: missing M-cone (most common CVD, ~6% of males)',
    ],
  },
  {
    id: 'cielab', num: '3', title: 'CIELAB Conversion', subtitle: 'Perceptual Color Space',
    author: 'Gallo, Dave Andre A.',
    desc: 'Converts the image into CIELAB — a perceptually uniform space where equal numerical distances correspond to equal perceived color differences.',
    bullets: [
      'Linear RGB → XYZ (sRGB primaries D65) → L*a*b* (D65 white point)',
      'L* = Lightness [0–100],  a* = Red(+)/Green(−),  b* = Yellow(+)/Blue(−)',
      'D65 white point: Xn=0.95047, Yn=1.0, Zn=1.08883',
      'All CIEDE2000 ΔE distance calculations operate in this space',
    ],
  },
  {
    id: 'autok', num: '4A', title: 'Auto Cluster Count', subtitle: 'Silhouette Analysis',
    author: 'Gallo, Dave Andre A.',
    desc: 'Automatically determines the optimal number of FCM clusters via a three-phase analysis of the image\'s color complexity — no manual input required.',
    bullets: [
      'Phase 1: 3D LAB histogram (12×12×12) → count occupied bins → lower bound',
      'Phase 2: Mini-batch k-means silhouette scan on 50k-pixel subsample',
      'Phase 3: Red/green chroma bonus — enforce k≥4 if >5% pixels are RG-active',
      'Resolution-aware: k_max scales with √pixels / 8',
    ],
  },
  {
    id: 'fcm', num: '4B', title: 'Fuzzy C-Means (FCM)', subtitle: 'Soft Color Clustering',
    author: 'Gallo, Dave Andre A.',
    desc: 'Groups pixels into color clusters with partial (fuzzy) membership — every pixel belongs to every cluster to some degree, enabling seamless blending during reconstruction.',
    bullets: [
      'Fuzziness m=2.0, convergence ε=0.001, max 100 iterations',
      'k-means++ seeding for stable initialization across runs',
      'FCM runs on 50k subsample; full-image memberships recomputed from centers',
      'Membership matrix W: each row sums to 1 (probabilistic assignment)',
    ],
  },
  {
    id: 'soft', num: '', title: 'Mask Edge Softness', subtitle: 'Gaussian Blur on Masks',
    author: 'Gallo, Dave Andre A.',
    desc: 'Binary YOLO masks create hard pixel-perfect edges that produce visible re-encoding seams. Gaussian blur creates smooth transition zones at object boundaries.',
    bullets: [
      'PIL GaussianBlur(radius=r) applied to each binary mask before weighting',
      'Radius 0 → hard edge (visible seam at object boundary)',
      'Radius 3 → moderate blend zone ~6–8px (default, best general purpose)',
      'Radius 4–8 → for natural images, photography, and high-res scans',
    ],
  },
  {
    id: 'conflict', num: '5', title: 'Conflict Detection', subtitle: 'CIEDE2000',
    author: 'Gallo, Dave Andre A.',
    desc: 'Identifies cluster pairs that collapse under CVD simulation — colors distinguishable to normal viewers that become identical to CVD viewers.',
    bullets: [
      'Primary: CIEDE2000 ΔE between simulated centers < 20 → conflict',
      'Secondary: ΔE_original < 12 → skip (already similar to everyone)',
      'Full Sharma et al. (2005) formula with RT blue-region cross-term',
      'Only flagged conflicts are passed to the re-encoding stage',
    ],
  },
  {
    id: 'reencode', num: '6', title: 'LCH Re-Encoding', subtitle: 'Guarded Lightness Push',
    author: 'Martinez, John Andrei M.',
    desc: 'Resolves conflicts by adjusting L* (lightness) only — hue and chroma are untouched. Red-ish clusters go darker; green-ish clusters go lighter.',
    bullets: [
      'Red (a*>10, chroma>15) → darker;  Green (a*<−10) → lighter',
      'Floor: neutral max(L_orig−15, 15);  chromatic max(L_orig−25, 5)',
      'Ceiling: min(85, L_orig+25);  naturalness budget: ±25 L* total per center',
      'Stops when CIEDE2000 ΔE_sim ≥ 20.5 (per pair, up to 30 iterations)',
    ],
  },
  {
    id: 'recon', num: '7', title: 'Reconstruction', subtitle: 'Fuzzy Membership Blend',
    author: 'Martinez, John Andrei M.',
    desc: 'Applies cluster-center lightness shifts to every pixel using the fuzzy membership weights. Edge pixels blend smoothly between adjacent corrected colors.',
    bullets: [
      "pixel'_lab = pixel_lab + Σ_j  w_ij × (c'_j − c_j)",
      'Equivalent matrix form: corrected = data + W @ shifts',
      'Fuzzy weights prevent posterization — no hard color boundaries',
      'Reconstruction is one matrix multiply — O(N·K) time',
    ],
  },
  {
    id: 'srgb', num: '8', title: 'Back to sRGB', subtitle: 'Linear → Display-Ready',
    author: 'Martinez, John Andrei M.',
    desc: 'Converts the corrected CIELAB image back to display-ready sRGB by re-applying the gamma curve, producing a JPEG/PNG identical in format to the input.',
    bullets: [
      'CIELAB → XYZ → Linear RGB → sRGB (gamma applied)',
      'Gamma: C·12.92  or  1.055·C^(1/2.4)−0.055',
      'Values clipped to [0,1] before uint8 cast [0–255]',
      'Output is perceptually subtle for normal viewers; impactful for CVD viewers',
    ],
  },
  {
    id: 'metrics', num: '9', title: 'Validation Metrics', subtitle: 'Objective Accessibility Targets',
    author: 'Martinez, John Andrei M.',
    desc: 'Three objective metrics validate the re-encoding output against quantitative accessibility and perceptual naturalness targets.',
    bullets: [
      'ΔE Improvement: mean CIEDE2000 gain on conflict pairs  → target > 15',
      'Conflict Resolution Rate: fraction of conflicts resolved → target > 80%',
      'Naturalness (CIE76): mean ΔE between original and corrected centers → target < 12',
    ],
  },
  {
    id: 'perf', num: '', title: 'Performance & Auto-Downsampling', subtitle: 'Speed Targets',
    author: 'Gallo, Dave Andre A.',
    desc: 'Images exceeding 1.5M pixels are automatically downsampled for framework processing, then bicubic-upscaled back to the original resolution.',
    bullets: [
      '420×420 px  → target < 1 second',
      '1920×1080 px → target < 4 seconds',
      '3300×2550 px → target < 10 seconds',
      'Box resample down → framework → bicubic upsample back',
    ],
  },
  {
    id: 'roi', num: '', title: 'Color ROI Fallback', subtitle: 'HSV Detection',
    author: 'Gallo, Dave Andre A.',
    desc: 'When YOLO finds no objects, HSV color thresholding isolates the red and green regions most critical for CVD on posters and signage.',
    bullets: [
      'Red: saturation > 0.35,  hue < 20° or > 340°,  value > 0.15',
      'Green: saturation > 0.28,  hue 85°–155°,  value > 0.15',
      'Region must cover ≥ 0.3% of image (smaller patches discarded as noise)',
      'Detected regions feed the same FCM → conflict → re-encode framework',
    ],
  },
]

// ── Sub-visuals ────────────────────────────────────────────────────────────────

function ImagePair({ leftSrc, rightSrc, leftLabel, rightLabel, cvdType, rightFiltered }) {
  const imgRef = useRef(null)
  const matrix = CVD_MATRIX[cvdType] ?? CVD_MATRIX.deutan

  if (!leftSrc) return (
    <div className="flex-1 rounded-xl bg-bg-elevated border border-border-default flex items-center justify-center text-text-muted text-sm">
      No image — run the framework first
    </div>
  )

  return (
    <div className="flex-1 flex flex-col sm:flex-row gap-3 min-h-0">
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <defs>
          <filter id="demo-cvd">
            <feColorMatrix type="matrix" values={matrix} />
          </filter>
        </defs>
      </svg>

      {[
        { src: leftSrc,  label: leftLabel,  filtered: false },
        { src: rightSrc, label: rightLabel, filtered: rightFiltered },
      ].map(({ src, label, filtered }) => (
        <div key={label} className="flex-1 flex flex-col gap-1.5 min-h-0">
          <span className="text-xs font-mono text-text-muted shrink-0">{label}</span>
          <div className="flex-1 rounded-xl overflow-hidden bg-bg-elevated border border-border-default min-h-0">
            <img
              src={src}
              alt={label}
              ref={label === rightLabel ? imgRef : undefined}
              className="w-full h-full object-contain"
              style={filtered ? { filter: 'url(#demo-cvd)' } : undefined}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function NormVisual({ originalSrc }) {
  const pts = []
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    const lin = t <= 0.04045 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4)
    pts.push(`${i * 2},${200 - lin * 200}`)
  }
  return (
    <div className="flex-1 flex flex-col sm:flex-row gap-3 min-h-0">
      <div className="flex-1 flex flex-col gap-1.5 min-h-0">
        <span className="text-xs font-mono text-text-muted">sRGB input (gamma-encoded)</span>
        <div className="flex-1 rounded-xl overflow-hidden bg-bg-elevated border border-border-default min-h-0">
          {originalSrc
            ? <img src={originalSrc} alt="Original sRGB" className="w-full h-full object-contain" />
            : <div className="w-full h-full flex items-center justify-center text-text-muted text-sm p-4">Upload an image first</div>}
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-1.5">
        <span className="text-xs font-mono text-text-muted">sRGB gamma curve (γ = 2.4) — removed before processing</span>
        <div className="flex-1 rounded-xl bg-bg-elevated border border-border-default p-4 flex flex-col gap-3 justify-center">
          <svg viewBox="0 0 200 210" className="w-full max-h-48">
            {[0,50,100,150,200].map(v => (
              <g key={v}>
                <line x1={v} y1={0} x2={v} y2={200} stroke="rgb(30 41 59)" strokeWidth="0.5"/>
                <line x1={0} y1={v} x2={200} y2={v} stroke="rgb(30 41 59)" strokeWidth="0.5"/>
              </g>
            ))}
            <line x1={0} y1={200} x2={200} y2={0} stroke="rgb(51 65 85)" strokeWidth="1" strokeDasharray="4 4"/>
            <polyline points={pts.join(' ')} fill="none" stroke="rgb(8 145 178)" strokeWidth="2.5"/>
            <text x={4} y={208} fill="rgb(100 116 139)" fontSize="9">0</text>
            <text x={192} y={208} fill="rgb(100 116 139)" fontSize="9">1</text>
            <text x={2}  y={10}  fill="rgb(100 116 139)" fontSize="9">1</text>
            <text x={55} y={125} fill="rgb(8 145 178)"   fontSize="9">linear</text>
            <text x={110} y={80} fill="rgb(51 65 85)"    fontSize="9">identity</text>
          </svg>
          <p className="text-xs text-text-muted leading-relaxed">
            Gamma removal expands shadow detail and makes arithmetic on color channels physically meaningful.
          </p>
        </div>
      </div>
    </div>
  )
}

function CielabVisual({ originalSrc }) {
  return (
    <div className="flex-1 flex flex-col sm:flex-row gap-3 min-h-0">
      <div className="flex-1 flex flex-col gap-1.5 min-h-0">
        <span className="text-xs font-mono text-text-muted">sRGB input (full colour)</span>
        <div className="flex-1 rounded-xl overflow-hidden bg-bg-elevated border border-border-default min-h-0">
          {originalSrc
            ? <img src={originalSrc} alt="Original" className="w-full h-full object-contain" />
            : <div className="w-full h-full flex items-center justify-center text-text-muted text-sm p-4">Upload an image first</div>}
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-1.5 min-h-0">
        <span className="text-xs font-mono text-text-muted">L* channel (lightness only — hue &amp; chroma stripped)</span>
        <div className="flex-1 rounded-xl overflow-hidden bg-bg-elevated border border-border-default min-h-0">
          {originalSrc
            ? <img src={originalSrc} alt="L* channel" className="w-full h-full object-contain" style={{ filter: 'grayscale(1) brightness(1.05)' }} />
            : (
              <div className="flex-1 flex flex-col gap-3 items-center justify-center p-4 h-full">
                <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
                  {[
                    { label: 'L* Lightness', grad: 'from-black to-white', range: '0 → 100' },
                    { label: 'a* Red/Green', grad: 'from-green-600 to-red-600', range: '−128 → +127' },
                    { label: 'b* Yellow/Blue', grad: 'from-blue-600 to-yellow-400', range: '−128 → +127' },
                  ].map(({ label, grad, range }) => (
                    <div key={label} className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-mono text-text-muted">{label}</span>
                      <div className={`h-6 rounded bg-gradient-to-r ${grad} border border-border-default`} />
                      <span className="text-[10px] text-text-muted text-center">{range}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

function AutoKVisual({ clusters }) {
  const [displayed, setDisplayed] = useState(0)
  useEffect(() => {
    if (!clusters) return
    let n = 0
    const id = setInterval(() => {
      n = Math.min(n + Math.ceil(clusters / 20), clusters)
      setDisplayed(n)
      if (n >= clusters) clearInterval(id)
    }, 40)
    return () => clearInterval(id)
  }, [clusters])

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6">
      <div className="text-center">
        <div className="text-8xl font-bold font-heading text-primary tabular-nums">
          {clusters ? displayed : '—'}
        </div>
        <div className="text-text-muted text-lg mt-2">clusters detected</div>
      </div>
      <div className="flex gap-2 flex-wrap justify-center max-w-sm">
        {Array.from({ length: Math.min(clusters ?? 8, 20) }).map((_, i) => (
          <div
            key={i}
            className="w-5 h-5 rounded-full border-2 border-primary/40"
            style={{ background: `hsl(${(i * 360 / (clusters ?? 8)).toFixed(0)} 70% 55%)` }}
          />
        ))}
      </div>
      <p className="text-xs text-text-muted text-center max-w-xs">
        Determined via silhouette-scored mini-batch k-means on a 50,000-pixel subsample of the image.
      </p>
    </div>
  )
}

function FcmVisual({ originalSrc, clusters }) {
  return (
    <div className="flex-1 flex flex-col sm:flex-row gap-3 min-h-0">
      <div className="flex-1 flex flex-col gap-1.5 min-h-0">
        <span className="text-xs font-mono text-text-muted">Input to FCM (CIELAB pixels)</span>
        <div className="flex-1 rounded-xl overflow-hidden bg-bg-elevated border border-border-default min-h-0">
          {originalSrc
            ? <img src={originalSrc} alt="Original" className="w-full h-full object-contain" style={{ filter: 'saturate(1.5)' }} />
            : <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">Upload an image first</div>}
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-1.5 min-h-0">
        <span className="text-xs font-mono text-text-muted">Cluster centers ({clusters ?? '?'} clusters)</span>
        <div className="flex-1 rounded-xl overflow-hidden bg-bg-elevated border border-border-default min-h-0 p-4">
          <div className="flex flex-wrap gap-2 content-start">
            {Array.from({ length: Math.min(clusters ?? 8, 30) }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <div
                  className="w-8 h-8 rounded-lg border border-border-default shadow-sm"
                  style={{ background: `hsl(${(i * 361 / (clusters ?? 8)).toFixed(0)} ${60 + (i % 3) * 10}% ${40 + (i % 4) * 8}%)` }}
                />
                <span className="text-[9px] text-text-muted font-mono">{i + 1}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-muted mt-3 leading-relaxed">
            Each cluster center is the weighted mean CIELAB value for that color group.
            Pixels have partial membership in all clusters simultaneously.
          </p>
        </div>
      </div>
    </div>
  )
}

function YoloVisual({ originalSrc, boxes }) {
  const imgRef = useRef(null)
  const [loaded,     setLoaded]     = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [showConf,   setShowConf]   = useState(false)
  const hasBoxes = boxes?.length > 0

  if (!originalSrc) return (
    <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
      Upload an image first
    </div>
  )

  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0">
      {/* Status + toggles */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-mono text-text-muted">
          YOLOv8 — {hasBoxes ? `${boxes.length} region${boxes.length !== 1 ? 's' : ''} detected` : 'no objects found → Color ROI fallback active'}
        </span>
        {hasBoxes && (
          <>
            <button
              type="button"
              onClick={() => setShowLabels(v => !v)}
              className={[
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors',
                showLabels
                  ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                  : 'bg-bg-elevated border-border-default text-text-muted hover:text-text-primary',
              ].join(' ')}
            >
              {showLabels ? 'Names on' : 'Names off'}
            </button>
            {showLabels && (
              <button
                type="button"
                onClick={() => setShowConf(v => !v)}
                className={[
                  'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors',
                  showConf
                    ? 'bg-violet-500/10 border-violet-500/30 text-violet-400'
                    : 'bg-bg-elevated border-border-default text-text-muted hover:text-text-primary',
                ].join(' ')}
              >
                {showConf ? 'Conf on' : 'Conf off'}
              </button>
            )}
          </>
        )}
      </div>

      <ImageViewer
        src={originalSrc}
        boxes={boxes ?? []}
        showBoxes={hasBoxes}
        showLabels={showLabels}
        showConf={showConf}
        simulated={false}
        className="flex-1 min-h-0"
      >
        <div className="relative rounded-xl overflow-hidden bg-bg-elevated border border-border-default w-full h-full" style={{ minHeight: '200px' }}>
          <img
            ref={imgRef}
            src={originalSrc}
            alt="YOLO detection result"
            onLoad={() => setLoaded(true)}
            className="w-full h-full object-contain"
          />
          {loaded && hasBoxes && (
            <BoundingBoxCanvas boxes={boxes} imgRef={imgRef} showLabels={showLabels} showConf={showConf} />
          )}
          {loaded && !hasBoxes && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/20">
              <div className="px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-xs text-amber-300 text-center max-w-xs">
                CNN found no objects in this image.<br/>
                The framework will use HSV color thresholding to isolate red/green regions instead.
              </div>
            </div>
          )}
        </div>
      </ImageViewer>

      {/* Legend */}
      {hasBoxes && (
        <div className="flex flex-wrap gap-3">
          {[
            { cls: 'roi-color',  color: '#EF4444', label: 'roi-color' },
            { cls: 'roi-object', color: '#3B82F6', label: 'roi-object' },
            { cls: 'roi-text',   color: '#F59E0B', label: 'roi-text' },
            { cls: 'roi-symbol', color: '#22C55E', label: 'roi-symbol' },
            { cls: 'exclude-person', color: '#6B7280', label: 'exclude (person)' },
          ].filter(({ cls }) => boxes.some(b => b.class === cls)).map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SoftVisual({ originalSrc }) {
  const bars = (
    <div className="flex flex-col gap-3">
      {[
        { label: 'radius = 0  (hard mask)', steps: [1,1,1,1,0,0,0,0] },
        { label: 'radius = 3  (default)',   steps: [1,0.9,0.7,0.4,0.2,0.05,0,0] },
        { label: 'radius = 8  (heavy)',     steps: [1,0.85,0.65,0.45,0.3,0.15,0.05,0] },
      ].map(({ label, steps }) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-xs font-mono text-text-muted">{label}</span>
          <div className="flex gap-0.5 h-8">
            {steps.map((w, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{ background: `rgb(8 145 178 / ${w})`, border: '1px solid rgb(51 65 85)' }}
              />
            ))}
            <div className="flex-1 rounded-sm bg-bg-elevated border border-border-default" />
            <div className="flex-1 rounded-sm bg-bg-elevated border border-border-default" />
          </div>
        </div>
      ))}
      <p className="text-xs text-text-muted leading-relaxed">
        Soft transition zones blend re-encoded object pixels with background pixels at boundaries, making corrections invisible at edges.
      </p>
    </div>
  )

  if (!originalSrc) {
    return <div className="flex-1 flex flex-col gap-4 items-center justify-center"><div className="w-full max-w-lg">{bars}</div></div>
  }

  return (
    <div className="flex-1 flex flex-col sm:flex-row gap-3 min-h-0">
      <div className="flex-1 flex flex-col gap-1.5 min-h-0">
        <span className="text-xs font-mono text-text-muted">Image — boundary edges where softness applies</span>
        <div className="flex-1 rounded-xl overflow-hidden bg-bg-elevated border border-border-default min-h-0">
          <img src={originalSrc} alt="Original" className="w-full h-full object-contain" />
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-1.5 justify-center">
        <span className="text-xs font-mono text-text-muted">Mask alpha falloff per radius</span>
        <div className="rounded-xl bg-bg-elevated border border-border-default p-4">
          {bars}
        </div>
      </div>
    </div>
  )
}

function ConflictVisual({ conflicts, metrics }) {
  const n = conflicts ?? metrics?.conflicts_found ?? 0
  const pairs = Array.from({ length: Math.min(n, 6) }, (_, i) => ({
    a: `hsl(${120 + i * 15} 60% 45%)`,
    b: `hsl(${0   + i * 15} 65% 45%)`,
  }))

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6">
      <div className="text-center">
        <div className="text-7xl font-bold font-heading text-fail tabular-nums">{n}</div>
        <div className="text-text-muted text-base mt-1">conflict pair{n !== 1 ? 's' : ''} detected</div>
      </div>
      {pairs.length > 0 ? (
        <div className="flex flex-wrap gap-3 justify-center">
          {pairs.map(({ a, b }, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-bg-elevated border border-border-default rounded-lg px-3 py-2">
              <div className="w-6 h-6 rounded" style={{ background: a }} />
              <span className="text-text-muted text-xs">≡</span>
              <div className="w-6 h-6 rounded" style={{ background: b }} />
              <span className="text-[10px] text-fail font-mono ml-1">ΔE&lt;20</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-2 rounded-lg bg-pass/10 border border-pass/30 text-pass text-sm">
          No conflicts — image is already CVD-accessible
        </div>
      )}
      <p className="text-xs text-text-muted text-center max-w-sm">
        Pairs with CIEDE2000 ΔE &lt; 20 under CVD simulation are flagged. Only pairs distinguishable to normal viewers (ΔE_orig ≥ 12) count.
      </p>
    </div>
  )
}

function PerfVisual({ metrics }) {
  const ms = metrics?.inference_ms
  const rows = [
    { size: '420 × 420',    target: '< 1 s',  pixels: '176 k' },
    { size: '1920 × 1080',  target: '< 4 s',  pixels: '2.1 M' },
    { size: '3300 × 2550',  target: '< 10 s', pixels: '8.4 M' },
  ]
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6">
      <div className="w-full max-w-md">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border-default">
              <th className="text-left py-2 px-3 text-text-muted font-normal text-xs">Resolution</th>
              <th className="text-left py-2 px-3 text-text-muted font-normal text-xs">Pixels</th>
              <th className="text-left py-2 px-3 text-text-muted font-normal text-xs">Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.size} className="border-b border-border-subtle">
                <td className="py-2.5 px-3 font-mono text-xs text-text-primary">{r.size}</td>
                <td className="py-2.5 px-3 text-xs text-text-muted">{r.pixels}</td>
                <td className="py-2.5 px-3 text-xs text-pass font-mono">{r.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ms != null && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-primary/10 border border-primary/20 text-sm text-center">
            This image processed in <span className="font-mono font-bold text-primary">{(ms / 1000).toFixed(2)} s</span>
          </div>
        )}
      </div>
    </div>
  )
}

function RoiVisual() {
  return (
    <div className="flex-1 flex flex-col sm:flex-row gap-3 items-center justify-center">
      {[
        { label: 'Red ROI (check/X marks)', hue: '0', sat: '>0.35', hueRange: '<20° or >340°' },
        { label: 'Green ROI (safe/pass)',   hue: '120', sat: '>0.28', hueRange: '85°–155°' },
      ].map(({ label, hue, sat, hueRange }) => (
        <div key={label} className="flex-1 flex flex-col gap-2">
          <span className="text-xs font-mono text-text-muted">{label}</span>
          <div
            className="flex-1 min-h-[120px] rounded-xl border border-border-default flex flex-col items-center justify-center gap-2 p-4"
            style={{ background: `hsl(${hue} 60% 15%)` }}
          >
            <div
              className="w-12 h-12 rounded-full"
              style={{ background: `hsl(${hue} 70% 50%)` }}
            />
            <div className="text-xs text-center space-y-0.5" style={{ color: `hsl(${hue} 60% 75%)` }}>
              <div className="font-mono">Saturation {sat}</div>
              <div className="font-mono">Hue {hueRange}</div>
              <div className="font-mono">Value &gt;0.15</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Stage visual switcher ──────────────────────────────────────────────────────
function StageVisual({ stageId, result, cvdType }) {
  const orig = result?.original_url
  const corr = result?.corrected_url
  const boxes = result?.boxes ?? []
  const metrics = result?.metrics

  switch (stageId) {
    case 'norm':
      return <NormVisual originalSrc={orig} />
    case 'cvd':
      return <ImagePair leftSrc={orig} rightSrc={orig} leftLabel="Original (normal vision)" rightLabel={`CVD simulation (${cvdType})`} rightFiltered cvdType={cvdType} />
    case 'cielab':
      return <CielabVisual originalSrc={orig} />
    case 'autok':
      return <AutoKVisual clusters={metrics?.auto_clusters} />
    case 'fcm':
      return <FcmVisual originalSrc={orig} clusters={metrics?.auto_clusters} />
    case 'yolo':
      return <YoloVisual originalSrc={orig} boxes={boxes} />
    case 'soft':
      return <SoftVisual originalSrc={orig} />
    case 'conflict':
      return <ConflictVisual metrics={metrics} />
    case 'reencode':
      return <ImagePair leftSrc={orig} rightSrc={corr} leftLabel="Before re-encoding" rightLabel="After LCH lightness push" cvdType={cvdType} rightFiltered={false} />
    case 'recon':
      return <ImagePair leftSrc={corr} rightSrc={corr} leftLabel="Corrected image" rightLabel="CVD view of corrected" cvdType={cvdType} rightFiltered />
    case 'srgb':
      return <ImagePair leftSrc={orig} rightSrc={corr} leftLabel="Original sRGB" rightLabel="Re-encoded sRGB (final output)" cvdType={cvdType} rightFiltered={false} />
    case 'metrics':
      return metrics
        ? <div className="flex-1 overflow-y-auto"><MetricsPanel metrics={metrics} /></div>
        : <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Run the framework to see metrics</div>
    case 'perf':
      return <PerfVisual metrics={metrics} />
    case 'roi':
      return <RoiVisual />
    default:
      return null
  }
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const toast = useToast()
  const [file,      setFile]      = useState(null)
  const [severity,  setSeverity]  = useState(1.0)
  const [result,    setResult]    = useState(null)   // { deutan }
  const [activeDemo, setActiveDemo] = useState('deutan')
  const [running,   setRunning]   = useState(false)
  const [stageIdx,  setStageIdx]  = useState(0)
  const [autoPlay,  setAutoPlay]  = useState(false)
  const autoRef = useRef(null)

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (!result) return
      if (e.key === 'ArrowRight') setStageIdx((i) => Math.min(i + 1, STAGES.length - 1))
      if (e.key === 'ArrowLeft')  setStageIdx((i) => Math.max(i - 1, 0))
      if (e.key === 'Escape')     setAutoPlay(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result])

  // Auto-play
  useEffect(() => {
    if (!autoPlay) { clearInterval(autoRef.current); return }
    autoRef.current = setInterval(() => {
      setStageIdx((i) => {
        if (i >= STAGES.length - 1) { setAutoPlay(false); return i }
        return i + 1
      })
    }, 8000)
    return () => clearInterval(autoRef.current)
  }, [autoPlay])

  async function handleRun() {
    if (!file) { toast('Please select an image first.', 'warning'); return }
    setRunning(true)
    try {
      const deutan = await processImage({ file, cvd_type: 'deutan', severity, conf_threshold: 0.30, seg_soft: 8.0 })
      setResult({ deutan })
      setActiveDemo('deutan')
      setStageIdx(0)
      setAutoPlay(false)
    } catch (err) {
      toast(err?.response?.data?.detail ?? 'Framework failed. Is the backend running?', 'error')
    } finally {
      setRunning(false)
    }
  }

  const stage      = STAGES[stageIdx]
  const activeResult = result?.[activeDemo]

  // ── Upload screen ────────────────────────────────────────────────────────────
  if (!result) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-heading font-bold text-text-primary">Algorithm Explorer</h1>
            <p className="text-text-muted text-sm mt-1">
              Upload an image to walk through all {STAGES.length} algorithm stages step by step.
            </p>
          </div>

          <Card className="p-6 flex flex-col gap-5">
            <UploadZone file={file} onFile={setFile} disabled={running} />

            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-muted font-medium">Severity — {severity.toFixed(1)}</label>
              <input
                type="range" min={0} max={1} step={0.1}
                value={severity}
                onChange={(e) => setSeverity(parseFloat(e.target.value))}
                className="mt-1.5"
              />
              <p className="text-xs text-text-muted">Generates Deuteranopia corrections</p>
            </div>

            <Button variant="primary" fullWidth onClick={handleRun} loading={running} disabled={running || !file}>
              {running ? 'Running…' : 'Run Algorithm Explorer'}
            </Button>
          </Card>

          <p className="text-xs text-text-muted text-center">
            Use ← → arrow keys to navigate between stages after processing.
          </p>
        </div>
      </AppShell>
    )
  }

  // ── Stage walkthrough ────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="flex flex-col h-full gap-0 -m-4 md:-m-8">

        {/* Top bar */}
        <div className="shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-b border-border-default bg-bg-surface gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs text-text-muted font-mono hidden sm:block">Algorithm Explorer</span>
            <div className="w-32 sm:w-48 bg-bg-elevated rounded-full h-1.5 border border-border-subtle">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${((stageIdx + 1) / STAGES.length) * 100}%` }}
              />
            </div>
            <span className="text-xs text-text-muted font-mono whitespace-nowrap">
              {stageIdx + 1} / {STAGES.length}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setAutoPlay((v) => !v)}
              title={autoPlay ? 'Pause auto-play' : 'Auto-play (8s per stage)'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors border-border-default text-text-muted hover:text-text-primary"
            >
              {autoPlay ? <Pause size={12} /> : <Play size={12} />}
              <span className="hidden sm:inline">{autoPlay ? 'Pause' : 'Auto'}</span>
            </button>
            <button
              onClick={() => { setResult(null); setFile(null); setStageIdx(0); setAutoPlay(false); setActiveDemo('deutan') }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-border-default text-text-muted hover:text-text-primary transition-colors"
            >
              <RotateCcw size={12} />
              <span className="hidden sm:inline">New image</span>
            </button>
          </div>
        </div>

        {/* Main area */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Stage list sidebar */}
          <nav className="hidden lg:flex flex-col w-52 shrink-0 border-r border-border-default bg-bg-surface overflow-y-auto py-3 px-2 gap-0.5">
            {STAGES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => { setStageIdx(i); setAutoPlay(false) }}
                className={[
                  'flex items-start gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors w-full',
                  i === stageIdx
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
                ].join(' ')}
              >
                <span className={`font-mono shrink-0 w-6 text-right ${i === stageIdx ? 'text-primary' : 'text-text-muted'}`}>
                  {s.num || '·'}
                </span>
                <span className="leading-tight">{s.title}</span>
              </button>
            ))}
          </nav>

          {/* Stage content */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 md:p-6 gap-4">

            {/* Stage header */}
            <div className="shrink-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                {stage.num && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary">
                    Stage {stage.num}
                  </span>
                )}
                <h2 className="text-xl md:text-2xl font-heading font-bold text-text-primary">{stage.title}</h2>
                <span className="text-text-muted text-sm">{stage.subtitle}</span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">Author: {stage.author}</p>
            </div>

            <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 overflow-hidden">

              {/* Visual area */}
              <div className="flex-1 min-h-0 flex flex-col" style={{ minHeight: '200px' }}>
                <StageVisual stageId={stage.id} result={activeResult} cvdType={activeDemo} />
              </div>

              {/* Explanation panel */}
              <div className="md:w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">
                <Card className="p-4 flex flex-col gap-3">
                  <p className="text-sm text-text-secondary leading-relaxed">{stage.desc}</p>
                  <ul className="flex flex-col gap-2">
                    {stage.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2 text-xs text-text-muted leading-relaxed">
                        <span className="text-primary shrink-0 mt-0.5">▸</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>

            {/* Navigation */}
            <div className="shrink-0 flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                onClick={() => { setStageIdx((i) => Math.max(i - 1, 0)); setAutoPlay(false) }}
                disabled={stageIdx === 0}
              >
                <ChevronLeft size={15} />
                Previous
              </Button>

              {/* Mobile stage dots */}
              <div className="flex gap-1 flex-wrap justify-center lg:hidden">
                {STAGES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => { setStageIdx(i); setAutoPlay(false) }}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === stageIdx ? 'bg-primary' : 'bg-border-strong'}`}
                  />
                ))}
              </div>

              <Button
                variant={stageIdx === STAGES.length - 1 ? 'secondary' : 'primary'}
                onClick={() => { setStageIdx((i) => Math.min(i + 1, STAGES.length - 1)); setAutoPlay(false) }}
                disabled={stageIdx === STAGES.length - 1}
              >
                Next
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
