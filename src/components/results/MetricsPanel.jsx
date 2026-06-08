import React from 'react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { ArrowDown } from 'lucide-react'

function MetricCard({ label, value, target, pass, explanation, lowerIsBetter = false }) {
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
        <Badge variant={pass ? 'pass' : 'fail'} size="sm">
          {pass ? 'Pass' : 'Fail'}
        </Badge>
      </div>
      <div className="flex items-end gap-2">
        <span className="font-mono text-3xl font-medium text-text-primary leading-none">{value}</span>
        {lowerIsBetter && (
          <ArrowDown size={16} className="text-pass mb-1 shrink-0" aria-label="Lower is better" />
        )}
      </div>
      <p className="text-xs text-text-muted">{target}</p>
      <p className="text-xs text-text-secondary leading-relaxed border-t border-border-subtle pt-3">{explanation}</p>
    </Card>
  )
}

export function MetricsPanel({ metrics }) {
  if (!metrics) return null

  const {
    delta_e_improvement,
    conflict_resolution_rate,
    naturalness_preservation,
    boxes_detected,
    conflicts_found,
    auto_clusters,
    inference_ms,
  } = metrics

  const noConflicts = conflicts_found === 0

  const cards = [
    {
      label: 'Color Separation Gain',
      value: noConflicts ? 'None' : (delta_e_improvement?.toFixed(1) ?? '—'),
      target: 'Target: > 15',
      pass: noConflicts || delta_e_improvement > 15,
      explanation: noConflicts
        ? 'No conflicting color pairs detected — image is already CVD-safe.'
        : 'How much simulated color distance improved after re-encoding.',
    },
    {
      label: 'Conflicts Resolved',
      value: noConflicts
        ? 'None'
        : conflict_resolution_rate != null
          ? `${(conflict_resolution_rate * 100).toFixed(1)}%`
          : '—',
      target: 'Target: > 80%',
      pass: noConflicts || conflict_resolution_rate > 0.8,
      explanation: noConflicts
        ? 'No conflicting color pairs detected — image is already CVD-safe.'
        : 'Color pairs now distinguishable under CVD simulation.',
    },
    {
      label: 'CIE76 Naturalness',
      value: naturalness_preservation?.toFixed(1) ?? '—',
      target: 'Target: < 12',
      pass: naturalness_preservation < 12,
      explanation: 'Mean ΔE vs original — lower means more natural output.',
      lowerIsBetter: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <MetricCard key={c.label} {...c} />
        ))}
      </div>

      <div className="flex flex-wrap gap-6 px-1">
        <StatItem label="Regions Detected" value={boxes_detected ?? '—'} />
        <StatItem label="Conflicts Found" value={noConflicts ? 'None' : (conflicts_found ?? '—')} />
        <StatItem label="Clusters Used" value={auto_clusters ?? '—'} />
        <StatItem
          label="Inference Time"
          value={inference_ms != null ? `${inference_ms.toFixed(0)} ms` : '—'}
        />
      </div>
    </div>
  )
}

function StatItem({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="font-mono text-lg font-medium text-text-primary">{value}</p>
    </div>
  )
}
