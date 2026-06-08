import React from 'react'

const variants = {
  pass: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  fail: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  warning: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  neutral: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  deutan: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  info: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
}

const sizes = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-3 py-1',
}

export function Badge({ variant = 'neutral', size = 'sm', className = '', children }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border font-medium',
        variants[variant] ?? variants.neutral,
        sizes[size] ?? sizes.sm,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  )
}
