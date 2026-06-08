import React from 'react'
import { Slider } from '../ui/Slider'

export function CVDControls({ values, onChange, disabled = false }) {
  const { cvd_subtype = 'deuteranomaly', severity } = values
  const isDeutanopia = cvd_subtype === 'deuteranopia'

  function selectSubtype(subtype) {
    onChange({
      ...values,
      cvd_subtype: subtype,
      severity: subtype === 'deuteranopia' ? 1.0 : (severity >= 1.0 ? 0.8 : severity),
    })
  }

  return (
    <div className={`flex flex-col gap-4 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">CVD Type</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'deuteranomaly', label: 'Deuteranomaly', desc: 'Reduced green sensitivity' },
            { id: 'deuteranopia',  label: 'Deuteranopia',  desc: 'No green sensitivity · max' },
          ].map(({ id, label, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectSubtype(id)}
              className={[
                'flex flex-col items-start p-3 rounded-lg border text-left transition-all',
                cvd_subtype === id
                  ? 'border-primary bg-primary/10 text-text-primary'
                  : 'border-border-default bg-bg-surface text-text-secondary hover:border-border-strong',
              ].join(' ')}
              aria-pressed={cvd_subtype === id}
            >
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-text-muted mt-0.5">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {!isDeutanopia && (
        <Slider
          label="Severity"
          min={0}
          max={1}
          step={0.01}
          value={severity}
          onChange={(v) => onChange({ ...values, severity: v })}
          helper="0 = mild anomaly · 1 = complete deuteranopia"
          formatValue={(v) => v.toFixed(2)}
        />
      )}
    </div>
  )
}
