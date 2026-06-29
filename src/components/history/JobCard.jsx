import React from 'react'
import { useNavigate } from 'react-router-dom'
import { passesDeImprovement, passesResolution, passesNaturalness } from '../../lib/api'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { ExpiryCountdown } from '../ui/ExpiryCountdown'
import { ImageOff, Check } from 'lucide-react'

function isExpired(expiresAt) {
  return new Date(expiresAt) < new Date()
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function MetricDots({ metrics }) {
  if (!metrics) return null
  const checks = [
    passesDeImprovement(metrics),
    passesResolution(metrics),
    passesNaturalness(metrics),
  ]
  return (
    <div className="flex items-center gap-1" aria-label="Metric summary">
      {checks.map((pass, i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full ${pass ? 'bg-sky-400' : 'bg-orange-400'}`}
          aria-label={pass ? 'Pass' : 'Fail'}
        />
      ))}
    </div>
  )
}

export function JobCard({ job, compact = false, selectable = false, selected = false, onSelect }) {
  const navigate = useNavigate()
  const expired = isExpired(job.expires_at)

  function handleClick() {
    if (selectable) {
      onSelect?.(job.job_id)
    } else if (!expired) {
      navigate(`/results/${job.job_id}`)
    }
  }

  return (
    <Card
      className={[
        'overflow-hidden transition-all duration-150 relative',
        selectable
          ? selected
            ? 'cursor-pointer border-primary ring-2 ring-primary/30'
            : 'cursor-pointer hover:border-primary/40 hover:-translate-y-1 hover:shadow-card-hover'
          : !expired
            ? 'cursor-pointer hover:border-primary/40 hover:-translate-y-1 hover:shadow-card-hover'
            : 'cursor-default opacity-60',
      ].join(' ')}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      aria-label={`Job ${job.job_id}${expired ? ' — expired' : ''}${selectable ? (selected ? ' — selected' : ' — not selected') : ''}`}
      aria-pressed={selectable ? selected : undefined}
    >
      {/* Selection checkbox overlay */}
      {selectable && (
        <div className={[
          'absolute top-2 left-2 z-10 w-5 h-5 rounded flex items-center justify-center border-2 transition-colors',
          selected ? 'bg-primary border-primary' : 'bg-bg-overlay border-border-default',
        ].join(' ')}>
          {selected && <Check size={12} className="text-white" aria-hidden="true" />}
        </div>
      )}

      {/* Thumbnail */}
      <div className={`relative bg-bg-elevated ${compact ? 'h-28' : 'h-36'}`}>
        {job.corrected_url && !expired ? (
          <img
            src={job.corrected_url}
            alt="Corrected image thumbnail"
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff size={24} className="text-text-disabled" aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-base/40 to-transparent pointer-events-none" aria-hidden="true" />
        {expired && (
          <div className="absolute top-2 right-2">
            <span className="bg-bg-overlay text-text-muted text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wide">
              Expired
            </span>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="deutan" size="sm">
            {job.severity >= 1.0 ? 'Deuteranopia' : 'Deuteranomaly'}
          </Badge>
          <span className="text-xs text-text-muted">{timeAgo(job.created_at)}</span>
        </div>

        <ExpiryCountdown expiresAt={job.expires_at} />

        <div className="flex items-center justify-between">
          <MetricDots metrics={job.metrics} />
          {job.metrics?.conflict_resolution_rate != null && (
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden w-16">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${(job.metrics.conflict_resolution_rate * 100).toFixed(0)}%` }}
                />
              </div>
              <span className="font-mono text-xs text-text-muted whitespace-nowrap">
                {(job.metrics.conflict_resolution_rate * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
