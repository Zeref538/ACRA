import React, { useRef, useEffect, useCallback } from 'react'

export const CLASS_COLORS = {
  'roi-object':      '#3B82F6',
  'roi-text':        '#F59E0B',
  'roi-color':       '#EF4444',
  'roi-symbol':      '#22C55E',
  'exclude-person':  '#6B7280',
}

function draw(canvas, img, boxes, showLabels = true, showConf = false) {
  const ctx = canvas.getContext('2d')
  const { naturalWidth: nw, naturalHeight: nh } = img
  const { width: cw, height: ch } = canvas.getBoundingClientRect()
  canvas.width = cw
  canvas.height = ch

  // object-contain: uniform scale, centered with letterbox offset
  const scale   = Math.min(cw / nw, ch / nh)
  const offsetX = (cw - nw * scale) / 2
  const offsetY = (ch - nh * scale) / 2

  ctx.clearRect(0, 0, cw, ch)

  for (const box of boxes) {
    const x = box.x1 * scale + offsetX
    const y = box.y1 * scale + offsetY
    const w = (box.x2 - box.x1) * scale
    const h = (box.y2 - box.y1) * scale
    const color = CLASS_COLORS[box.class] ?? '#94A3B8'
    const isExcluded = box.class === 'exclude-person'

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    if (isExcluded) ctx.setLineDash([6, 3])
    ctx.fillStyle = color + '1A'
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x, y, w, h)
    ctx.restore()

    if (showLabels) {
      const conf  = showConf && box.conf != null ? ` ${Math.round(box.conf * 100)}%` : ''
      const label = box.class + conf
      ctx.save()
      ctx.font = '11px "Fira Code", monospace'
      const textWidth = ctx.measureText(label).width
      const chipX = x
      const chipY = y > 20 ? y - 20 : y + h
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(chipX, chipY, textWidth + 8, 18, 3)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, chipX + 4, chipY + 13)
      ctx.restore()
    }
  }
}

export function BoundingBoxCanvas({ boxes, imgRef, showLabels = true, showConf = false }) {
  const canvasRef = useRef(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef?.current
    if (!canvas || !img || !img.complete) return
    draw(canvas, img, boxes, showLabels, showConf)
  }, [boxes, imgRef, showLabels, showConf])

  useEffect(() => {
    redraw()
    const observer = new ResizeObserver(redraw)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [redraw])

  const regionSummary = boxes
    .map((b) => `${b.class} at ${b.x1},${b.y1} to ${b.x2},${b.y2}`)
    .join('; ')

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-label={`Detected regions: ${regionSummary || 'none'}`}
    />
  )
}
