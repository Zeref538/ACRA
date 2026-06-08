import React, { useId } from 'react'

export function Slider({
  label,
  helper,
  min = 0,
  max = 1,
  step = 0.01,
  value,
  onChange,
  formatValue,
  className = '',
}) {
  const id = useId()
  const helperId = `${id}-helper`
  const displayValue = formatValue ? formatValue(value) : value

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
        <span
          className="font-mono text-sm text-text-primary bg-bg-elevated px-2 py-0.5 rounded border border-border-default min-w-[3.5rem] text-center"
          aria-live="polite"
          aria-atomic="true"
        >
          {displayValue}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={String(displayValue)}
        aria-describedby={helper ? helperId : undefined}
        className="h-11 cursor-pointer"
        style={{ minHeight: '44px' }}
      />
      {helper && (
        <p id={helperId} className="text-xs text-text-muted">
          {helper}
        </p>
      )}
    </div>
  )
}
