import React, { useState, useEffect } from 'react'
import { CheckCircle, Circle, Loader2 } from 'lucide-react'

const STEPS = [
  { label: 'Uploading image…', delay: 0 },
  { label: 'Normalizing input…', delay: 200 },
  { label: 'Running CNN detection…', delay: 400 },
  { label: 'Re-encoding colors…', delay: 600 },
]

export function ProcessingStatus({ elapsed = 0 }) {
  const [visibleCount, setVisibleCount] = useState(1)

  useEffect(() => {
    const timers = STEPS.map((step, i) => {
      if (i === 0) return null
      return setTimeout(() => setVisibleCount((c) => Math.max(c, i + 1)), step.delay)
    }).filter(Boolean)
    return () => timers.forEach(clearTimeout)
  }, [])

  const secs = (elapsed / 1000).toFixed(1)

  return (
    <div className="flex flex-col gap-4 p-4 bg-bg-elevated rounded-lg border border-border-default">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-primary">Processing your image…</p>
        <span className="font-mono text-xs text-text-disabled tabular-nums">{secs}s</span>
      </div>

      <ol className="flex flex-col gap-2" aria-label="Processing steps">
        {STEPS.map((step, i) => {
          const visible = i < visibleCount
          const active = i === visibleCount - 1
          const done = i < visibleCount - 1

          return (
            <li
              key={step.label}
              className={[
                'flex items-center gap-3 text-sm',
                visible ? 'animate-slide-in-left' : 'opacity-0 pointer-events-none',
              ].join(' ')}
              style={visible ? { animationDelay: `${i * 80}ms` } : undefined}
              aria-current={active ? 'step' : undefined}
            >
              {done ? (
                <CheckCircle size={16} className="text-pass shrink-0" aria-label="Complete" />
              ) : active ? (
                <Loader2 size={16} className="text-primary animate-spin shrink-0" aria-label="In progress" />
              ) : (
                <Circle size={16} className="text-text-disabled shrink-0" aria-label="Pending" />
              )}
              <span className={done ? 'text-text-muted' : active ? 'text-text-primary' : 'text-text-disabled'}>
                {step.label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
