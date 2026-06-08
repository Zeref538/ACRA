import React from 'react'
import { Loader2 } from 'lucide-react'

const variants = {
  primary:
    'text-white focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:opacity-50 disabled:cursor-not-allowed btn-primary-hover transition-all duration-200',
  secondary:
    'bg-bg-elevated text-text-primary border border-border-default hover:bg-bg-overlay focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:opacity-50 disabled:cursor-not-allowed',
  ghost:
    'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-elevated focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'bg-fail/10 text-orange-300 border border-fail/30 hover:bg-fail/20 focus-visible:ring-2 focus-visible:ring-fail focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:opacity-50 disabled:cursor-not-allowed',
}

const sizes = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  className = '',
  children,
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      style={(variant === 'primary' && !disabled && !loading) ? {
        background: 'linear-gradient(135deg, rgb(var(--primary)) 0%, rgb(14,120,152) 100%)',
      } : undefined}
      className={[
        'inline-flex items-center justify-center font-medium rounded-md outline-none',
        variants[variant] ?? variants.primary,
        sizes[size] ?? sizes.md,
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin shrink-0" aria-hidden="true" />}
      {children}
    </button>
  )
}
