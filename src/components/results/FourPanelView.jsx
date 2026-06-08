import React, { useState, useRef, useEffect } from 'react'
import { Eye, EyeOff, Tag, Percent } from 'lucide-react'
import { Skeleton } from '../ui/Skeleton'
import { BoundingBoxCanvas } from './BoundingBoxCanvas'
import { ImageViewer } from '../ui/ImageViewer'

// Machado 2009 CVD simulation matrices (severity=1.0 for *opia, ~0.7 for *anomaly)
const CVD_FILTERS = {
  deutan:        '0.293 0.707 0 0 0  0.293 0.707 0 0 0  0 0.022 0.978 0 0  0 0 0 1 0',
  deuteranomaly: '0.505 0.495 0 0 0  0.205 0.795 0 0 0  0 0.016 0.984 0 0  0 0 0 1 0',
  deuteranopia:  '0.293 0.707 0 0 0  0.293 0.707 0 0 0  0 0.022 0.978 0 0  0 0 0 1 0',
}

// Parse a 20-value SVG feColorMatrix string into a flat float array
function parseMatrix(str) {
  return str.trim().split(/\s+/).map(Number)
}

// ── Dominant color extraction from image via canvas ────────────────────────────
function extractColors(imgEl, n = 8, cvdMatrix = null) {
  try {
    const MAX = 80
    const scale = Math.min(MAX / imgEl.naturalWidth, MAX / imgEl.naturalHeight, 1)
    const w = Math.max(1, Math.round(imgEl.naturalWidth  * scale))
    const h = Math.max(1, Math.round(imgEl.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgEl, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const m = cvdMatrix ? parseMatrix(cvdMatrix) : null
    const freq = {}
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      let r = data[i], g = data[i + 1], b = data[i + 2]
      if (m) {
        const nr = Math.round(Math.min(255, Math.max(0, m[0]*r + m[1]*g + m[2]*b)) / 40) * 40
        const ng = Math.round(Math.min(255, Math.max(0, m[5]*r + m[6]*g + m[7]*b)) / 40) * 40
        const nb = Math.round(Math.min(255, Math.max(0, m[10]*r + m[11]*g + m[12]*b)) / 40) * 40
        r = nr; g = ng; b = nb
      } else {
        r = Math.round(r / 40) * 40
        g = Math.round(g / 40) * 40
        b = Math.round(b / 40) * 40
      }
      const k = `${r},${g},${b}`
      freq[k] = (freq[k] ?? 0) + 1
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => { const [r, g, b] = k.split(','); return `rgb(${r},${g},${b})` })
  } catch {
    return []
  }
}

// ── Single image panel ─────────────────────────────────────────────────────────
function Panel({ label, src, boxes, showBoxes, showLabels, showConf, simulated, cvdMatrix, filterId }) {
  const [loaded,  setLoaded]  = useState(false)
  const [colors,  setColors]  = useState([])
  const [hovered, setHovered] = useState(false)
  const imgRef = useRef(null)

  function handleMouseEnter() {
    setHovered(true)
    if (colors.length === 0 && imgRef.current?.complete) {
      setColors(extractColors(imgRef.current, 8, cvdMatrix))
    }
  }

  // Re-extract when image loads on hover
  function handleLoad() {
    setLoaded(true)
    if (hovered) setColors(extractColors(imgRef.current, 8, cvdMatrix))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary truncate">{label}</span>

      <ImageViewer src={src} alt={label} boxes={boxes} showBoxes={showBoxes} showLabels={showLabels} showConf={showConf} simulated={simulated}>
        <div
          className="relative rounded-lg overflow-hidden bg-bg-elevated border border-border-default"
          style={{ aspectRatio: '4/3' }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setHovered(false)}
        >
          {!loaded && <Skeleton className="absolute inset-0 w-full h-full" />}

          {src && (
            <img
              ref={imgRef}
              src={src}
              alt={label}
              crossOrigin="anonymous"
              loading="lazy"
              onLoad={handleLoad}
              className={`w-full h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
              style={simulated && filterId ? { filter: `url(#${filterId})` } : undefined}
            />
          )}

          {/* Bounding boxes — non-simulated panels only */}
          {!simulated && showBoxes && boxes?.length > 0 && loaded && (
            <BoundingBoxCanvas boxes={boxes} imgRef={imgRef} showLabels={showLabels} showConf={showConf} />
          )}

          {/* CVD sim badge */}
          {simulated && loaded && (
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white/70 font-mono pointer-events-none">
              CVD sim
            </div>
          )}

          {/* FCM color cluster overlay on hover */}
          {hovered && loaded && colors.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-black/75 flex items-center gap-1.5 flex-wrap pointer-events-none">
              <span className="text-[9px] text-white/50 font-mono shrink-0">clusters</span>
              {colors.map((c, i) => (
                <div
                  key={i}
                  className="w-3.5 h-3.5 rounded-sm border border-white/20 shrink-0"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>
      </ImageViewer>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export function FourPanelView({
  originalUrl,
  correctedUrl,
  cvdType = 'deutan',
  cvdLabel = 'Deuteranomaly',
  boxes = [],
}) {
  const [showBoxes,   setShowBoxes]   = useState(true)
  const [showLabels,  setShowLabels]  = useState(true)
  const [showConf,    setShowConf]    = useState(false)
  const hasBoxes = boxes.length > 0

  const filterId  = 'acra-cvd-sim'
  const matrix    = cvdLabel === 'Deuteranopia' ? CVD_FILTERS.deuteranopia : CVD_FILTERS.deuteranomaly

  return (
    <div className="flex flex-col gap-4">

      {/* Shared CVD simulation filter — placed at root to avoid overflow:hidden clipping */}
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          <filter id={filterId}>
            <feColorMatrix type="matrix" values={matrix} />
          </filter>
        </defs>
      </svg>

      {/* Detection controls — always visible */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => hasBoxes && setShowBoxes((v) => !v)}
          disabled={!hasBoxes}
          className={[
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            !hasBoxes
              ? 'bg-bg-elevated border-border-default text-text-disabled opacity-50 cursor-not-allowed'
              : showBoxes
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-bg-elevated border-border-default text-text-muted hover:text-text-primary',
          ].join(' ')}
          aria-pressed={showBoxes}
          title={!hasBoxes ? 'No CNN detections returned' : undefined}
        >
          {showBoxes ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
          {!hasBoxes ? 'No detections' : showBoxes ? 'Hide detections' : 'Show detections'}
        </button>

        {hasBoxes && showBoxes && (
          <>
            <button
              type="button"
              onClick={() => setShowLabels((v) => !v)}
              className={[
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                showLabels
                  ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                  : 'bg-bg-elevated border-border-default text-text-muted hover:text-text-primary',
              ].join(' ')}
              aria-pressed={showLabels}
            >
              <Tag size={13} aria-hidden="true" />
              {showLabels ? 'Names on' : 'Names off'}
            </button>
            {showLabels && (
              <button
                type="button"
                onClick={() => setShowConf((v) => !v)}
                className={[
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  showConf
                    ? 'bg-violet-500/10 border-violet-500/30 text-violet-400'
                    : 'bg-bg-elevated border-border-default text-text-muted hover:text-text-primary',
                ].join(' ')}
                aria-pressed={showConf}
              >
                <Percent size={13} aria-hidden="true" />
                {showConf ? 'Conf on' : 'Conf off'}
              </button>
            )}
          </>
        )}
      </div>

      {/* 2×2 grid */}
      <div className="grid grid-cols-2 gap-3">
        <Panel
          label="Original"
          src={originalUrl}
          boxes={boxes}
          showBoxes={showBoxes}
          showLabels={showLabels}
          showConf={showConf}
          simulated={false}
          cvdMatrix={null}
          filterId={null}
        />
        <Panel
          label={`Original — ${cvdLabel} view`}
          src={originalUrl}
          boxes={[]}
          showBoxes={false}
          showLabels={false}
          showConf={false}
          simulated={true}
          cvdMatrix={matrix}
          filterId={filterId}
        />
        <Panel
          label="Re-encoded"
          src={correctedUrl}
          boxes={boxes}
          showBoxes={showBoxes}
          showLabels={showLabels}
          showConf={showConf}
          simulated={false}
          cvdMatrix={null}
          filterId={null}
        />
        <Panel
          label={`Re-encoded — ${cvdLabel} view`}
          src={correctedUrl}
          boxes={[]}
          showBoxes={false}
          showLabels={false}
          showConf={false}
          simulated={true}
          cvdMatrix={matrix}
          filterId={filterId}
        />
      </div>
    </div>
  )
}
