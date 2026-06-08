import React, { useState, useId } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function Input({
  label,
  error,
  helper,
  type = 'text',
  className = '',
  ...props
}) {
  const id = useId()
  const errorId = `${id}-error`
  const helperId = `${id}-helper`
  const [showPassword, setShowPassword] = useState(false)

  const isPassword = type === 'password'
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type

  const describedBy = [error ? errorId : null, helper ? helperId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type={inputType}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? 'true' : undefined}
          className={[
            'w-full px-3 py-2 rounded-md bg-bg-elevated border text-text-primary placeholder-text-muted text-sm transition-colors duration-150 outline-none',
            'focus:border-primary focus:ring-1 focus:ring-primary',
            error
              ? 'border-fail/60 focus:border-fail focus:ring-fail'
              : 'border-border-default',
            isPassword ? 'pr-10' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {helper && !error && (
        <p id={helperId} className="text-xs text-text-muted">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-orange-300">
          {error}
        </p>
      )}
    </div>
  )
}
