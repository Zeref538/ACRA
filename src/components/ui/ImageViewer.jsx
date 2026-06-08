import React, { useState, useEffect, useRef } from 'react'
import { Maximize2, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { CLASS_COLORS } from '../../components/results/BoundingBoxCanvas'

export function ImageViewer({ src, alt = '', className = '', style, children, boxes = [], showBoxes = false, showLabels = true, showConf = false, simulated = false }) {
  const [open, setOpen]       = useState(false)
  const [zoom, setZoom]       = useState(1)
  const [natSize, setNatSize] = useState(null)
  const scrollRef             = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape') { setOpen(false); setZoom(1) }
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(z + 0.25, 5))
      if (e.key === '-') setZoom((z) => Math.max(z - 0.25, 0.25))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else      document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!src) return children ?? null

  return (
    <>
      <div className={`relative group ${className}`} style={style}>
        {children ?? (
          <img src={src} alt={alt} className="w-full h-full object-contain" />
        )}
        <button
          onClick={() => setOpen(true)}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 border border-white/20 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:bg-black/80 z-10"
          aria-label="Open fullscreen"
          title="Fullscreen (Esc to close)"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col" role="dialog" aria-modal="true" aria-label="Image fullscreen viewer">
          {/* Toolbar */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-black/60">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
                className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Zoom out"
              >
                <ZoomOut size={15} />
              </button>
              <span className="font-mono text-xs text-white/60 w-12 text-center select-none">
                {(zoom * 100).toFixed(0)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.25, 5))}
                className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Zoom in"
              >
                <ZoomIn size={15} />
              </button>
              <button
                onClick={() => setZoom(1)}
                className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors ml-1"
                aria-label="Reset zoom"
                title="Reset zoom"
              >
                <RotateCcw size={13} />
              </button>
              <span className="text-xs text-white/30 ml-2 hidden sm:inline">+/- keys · Esc to close</span>
            </div>
            <button
              onClick={() => { setOpen(false); setZoom(1) }}
              className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Image area — click backdrop to close */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto flex items-center justify-center p-6 cursor-zoom-out"
            onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); setZoom(1) } }}
          >
            <div
              className="relative inline-block"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'center',
                transition: 'transform 0.15s ease',
              }}
            >
              <img
                src={src}
                alt={alt}
                crossOrigin="anonymous"
                draggable={false}
                onLoad={(e) => setNatSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                className="max-w-none select-none block"
              />
              {/* Box overlay — SVG maps directly to original image pixel coords */}
              {!simulated && showBoxes && boxes.length > 0 && natSize && (
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={natSize.w}
                  height={natSize.h}
                  viewBox={`0 0 ${natSize.w} ${natSize.h}`}
                >
                  {boxes.map((box, i) => {
                    const color   = CLASS_COLORS[box.class] ?? '#94A3B8'
                    const bw      = box.x2 - box.x1
                    const bh      = box.y2 - box.y1
                    const conf    = showConf && box.conf != null ? ` ${Math.round(box.conf * 100)}%` : ''
                    const label   = showLabels ? box.class + conf : null
                    const chipY   = box.y1 > 20 ? box.y1 - 20 : box.y1 + bh
                    return (
                      <g key={i}>
                        <rect
                          x={box.x1} y={box.y1} width={bw} height={bh}
                          fill={color + '1A'} stroke={color} strokeWidth={2}
                          strokeDasharray={box.class === 'exclude-person' ? '6 3' : undefined}
                        />
                        {label && (
                          <text
                            x={box.x1 + 4} y={chipY + 13}
                            fill="white" fontSize={12}
                            fontFamily='"Fira Code", monospace'
                            paintOrder="stroke"
                            stroke={color} strokeWidth={3} strokeLinejoin="round"
                          >
                            {label}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </svg>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
