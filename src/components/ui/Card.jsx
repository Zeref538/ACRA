import React from 'react'

export function Card({ className = '', children, ...props }) {
  return (
    <div
      className={[
        'border rounded-lg shadow-card relative',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        background: 'linear-gradient(180deg, rgb(var(--bg-elevated) / 0.5) 0%, rgb(var(--bg-surface)) 60px)',
        borderColor: 'rgba(255,255,255,0.07)',
      }}
      {...props}
    >
      {children}
    </div>
  )
}
