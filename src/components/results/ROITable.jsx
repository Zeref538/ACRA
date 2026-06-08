import React, { useState, useMemo } from 'react'
import { Badge } from '../ui/Badge'
import { ChevronUp, ChevronDown } from 'lucide-react'

const CLASS_COLORS = {
  'roi-object': '#3B82F6',
  'roi-text': '#F59E0B',
  'roi-color': '#EF4444',
  'roi-symbol': '#22C55E',
  'exclude-person': '#6B7280',
}

function SortButton({ field, current, direction, onSort, children }) {
  const active = current === field
  return (
    <button
      onClick={() => onSort(field)}
      className="flex items-center gap-1 hover:text-text-primary transition-colors"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {children}
      <span className="text-text-disabled" aria-hidden="true">
        {active ? (direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronDown size={12} />}
      </span>
    </button>
  )
}

export function ROITable({ boxes = [] }) {
  const [sortField, setSortField] = useState('conf')
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (field) => {
    setSortDir(sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc')
    setSortField(field)
  }

  const sorted = useMemo(() => {
    return [...boxes].sort((a, b) => {
      const av = sortField === 'conf' ? a.conf : (a.delta_e_after ?? 0)
      const bv = sortField === 'conf' ? b.conf : (b.delta_e_after ?? 0)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [boxes, sortField, sortDir])

  if (!boxes.length) {
    return (
      <p className="text-sm text-text-muted text-center py-8">No regions detected</p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border-default">
      <table className="min-w-full text-sm" role="table">
        <thead>
          <tr className="border-b border-border-default">
            {[
              ['Class', null],
              ['Confidence', 'conf'],
              ['Coordinates', null],
              ['ΔE Before', null],
              ['ΔE After', 'delta_e_after'],
              ['Resolved', null],
            ].map(([label, field]) => (
              <th
                key={label}
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide whitespace-nowrap"
              >
                {field ? (
                  <SortButton field={field} current={sortField} direction={sortDir} onSort={handleSort}>
                    {label}
                  </SortButton>
                ) : label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((box, idx) => {
            const isExcluded = box.class === 'exclude-person'
            const color = CLASS_COLORS[box.class] ?? '#94A3B8'
            return (
              <tr
                key={idx}
                className={[
                  'border-b border-border-subtle last:border-0 hover:bg-bg-elevated transition-colors',
                  isExcluded ? 'opacity-50' : '',
                ].join(' ')}
              >
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: color }}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-xs text-text-primary">{box.class}</span>
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-text-primary">
                  {(box.conf * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-text-muted">
                  {box.x1},{box.y1} → {box.x2},{box.y2}
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-text-primary">
                  {box.delta_e_before?.toFixed(1) ?? '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-text-primary">
                  {box.delta_e_after?.toFixed(1) ?? '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {isExcluded ? (
                    <Badge variant="neutral" size="sm">Skipped</Badge>
                  ) : box.resolved ? (
                    <Badge variant="pass" size="sm">Yes</Badge>
                  ) : (
                    <Badge variant="fail" size="sm">No</Badge>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
