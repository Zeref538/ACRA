import React, { useState, useRef } from 'react'
import { Eye, EyeOff, Tag, Percent } from 'lucide-react'
import { Skeleton } from '../ui/Skeleton'
import { BoundingBoxCanvas } from './BoundingBoxCanvas'
import { ImageViewer } from '../ui/ImageViewer'

// Machado 2009 CVD simulation matrices
const CVD_FILTERS = {
  deutan:       '0.293 0.707 0 0 0  0.293 0.707 0 0 0  0 0.022 0.978 0 0  0 0 0 1 0',
  deuteranopia: '0.293 0.707 0 0 0  0.293 0.707 0 0 0  0 0.022 0.978 0 0  0 0 0 1 0',
}

function ImagePanel({ label, src, boxes, showBoxes, showLabels, showConf, expired, simulated, filterId }) {
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef(null)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary truncate">{label}</span>

      <ImageViewer
        src={(!expired && src) ? src : null}
        boxes={simulated ? [] : boxes}
        showBoxes={!simulated && showBoxes}
        showLabels={showLabels}
        showConf={showConf}
        simulated={simulated}
      >
        <div
          className={[
            'relative rounded-lg overflow-hidden bg-bg-elevated border border-border-default',
            expired ? 'opacity-40 grayscale' : '',
          ].join(' ')}
          style={{ aspectRatio: '4/3' }}
        >
          {!loaded && <Skeleton className="absolute inset-0 w-full h-full" />}

          {src && !expired ? (
            <img
              ref={imgRef}
              src={src}
              alt={label}
              loading="lazy"
              crossOrigin="anonymous"
              onLoad={() => setLoaded(true)}
              className={`w-full h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
              style={simulated ? { filter: `url(#${filterId})` } : undefined}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
              Image unavailable
            </div>
          )}

          {!simulated && showBoxes && boxes?.length > 0 && loaded && (
            <BoundingBoxCanvas boxes={boxes} imgRef={imgRef} showLabels={showLabels} showConf={showConf} />
          )}

          {simulated && loaded && (
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white/70 font-mono pointer-events-none">
              CVD sim
            </div>
          )}
        </div>
      </ImageViewer>
    </div>
  )
}

export function ImageComparison({ originalUrl, correctedUrl, boxes = [], expired = false, cvdType = 'deutan' }) {
  const [showBoxes,  setShowBoxes]  = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showConf,   setShowConf]   = useState(false)
  const hasBoxes = boxes.length > 0
  const cvdLabel = cvdType === 'deutan' ? 'Deuteranomaly/Deuteranopia' : 'Deuteranopia'
  const filterId = 'acra-ic-cvd-sim'
  const matrix   = CVD_FILTERS[cvdType] ?? CVD_FILTERS.deutan

  return (
    <div className="flex flex-col gap-4">

      {/* Shared CVD filter — outside overflow:hidden so CSS filter: url() can find it */}
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          <filter id={filterId}>
            <feColorMatrix type="matrix" values={matrix} />
          </filter>
        </defs>
      </svg>

      {/* Detection controls */}
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
          </>
        )}
      </div>

      {/* 2×2 panel grid */}
      <div className="grid grid-cols-2 gap-3">
        <ImagePanel
          label="Original"
          src={originalUrl}
          boxes={boxes}
          showBoxes={showBoxes}
          showLabels={showLabels}
          showConf={showConf}
          expired={expired}
          simulated={false}
          filterId={null}
        />
        <ImagePanel
          label={`Original — ${cvdLabel} view`}
          src={originalUrl}
          boxes={[]}
          showBoxes={false}
          showLabels={false}
          showConf={false}
          expired={expired}
          simulated={true}
          filterId={filterId}
        />
        <ImagePanel
          label="Corrected"
          src={correctedUrl}
          boxes={boxes}
          showBoxes={showBoxes}
          showLabels={showLabels}
          showConf={showConf}
          expired={expired}
          simulated={false}
          filterId={null}
        />
        <ImagePanel
          label={`Corrected — ${cvdLabel} view`}
          src={correctedUrl}
          boxes={[]}
          showBoxes={false}
          showLabels={false}
          showConf={false}
          expired={expired}
          simulated={true}
          filterId={filterId}
        />
      </div>
    </div>
  )
}
