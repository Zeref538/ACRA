import React from 'react'

export function Skeleton({ className = '', ...props }) {
  return (
    <div
      className={`shimmer rounded-md bg-bg-elevated ${className}`}
      aria-hidden="true"
      {...props}
    />
  )
}

export function SkeletonText({ lines = 3, className = '' }) {
  const widths = ['w-full', 'w-5/6', 'w-4/6', 'w-3/4', 'w-2/3']
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${widths[i % widths.length]}`}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-bg-surface border border-border-default rounded-lg p-4 ${className}`} aria-hidden="true">
      <Skeleton className="h-40 w-full mb-4" />
      <SkeletonText lines={2} />
    </div>
  )
}

export function SkeletonImage({ className = '' }) {
  return <Skeleton className={`w-full aspect-video ${className}`} />
}

export function SkeletonTableRow({ cols = 5, className = '' }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className={`px-4 py-3 ${className}`}>
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  )
}
