import React, { useState, useRef } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { CVDControls } from '../components/upload/CVDControls'
import { Badge } from '../components/ui/Badge'
import { Skeleton } from '../components/ui/Skeleton'
import {
  Layers, UploadCloud, X, CheckCircle, AlertCircle,
  Loader2, Download, Trash2, FileImage, ChevronDown, ChevronUp,
} from 'lucide-react'
import { passesDeImprovement, passesResolution, passesNaturalness } from '../lib/api'

function fmtEta(seconds) {
  if (seconds < 60)  return `~${Math.ceil(seconds)}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = Math.ceil(seconds % 60)
    return s > 0 ? `~${m}m ${s}s` : `~${m}m`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.ceil((seconds % 3600) / 60)
  return `~${h}h ${m}m`
}

function fmtBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    pending:    { variant: 'neutral',  label: 'Pending'    },
    processing: { variant: 'info',     label: 'Processing' },
    done:       { variant: 'pass',     label: 'Done'       },
    error:      { variant: 'fail',     label: 'Error'      },
  }
  const { variant, label } = map[status] ?? map.pending
  return <Badge variant={variant} size="sm">{label}</Badge>
}

// ── Mini metrics summary (3 coloured dots) ────────────────────────────────────
function MetricDots({ metrics }) {
  if (!metrics) return null
  const checks = [
    passesDeImprovement(metrics),
    passesResolution(metrics),
    passesNaturalness(metrics),
  ]
  const labels = ['ΔE', 'Res', 'Nat']
  return (
    <div className="flex items-center gap-1.5" aria-label="Metric summary">
      {checks.map((pass, i) => (
        <span
          key={i}
          title={`${labels[i]}: ${pass ? 'Pass' : 'Fail'}`}
          className={`w-2 h-2 rounded-full ${pass ? 'bg-sky-400' : 'bg-orange-400'}`}
        />
      ))}
    </div>
  )
}

// ── Drop zone for multiple files ──────────────────────────────────────────────
function MultiDropZone({ onFiles, disabled }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  function validate(files) {
    const valid = [], errors = []
    for (const f of files) {
      if (!ALLOWED.includes(f.type)) { errors.push(`${f.name}: unsupported format`); continue }
      if (f.size > MAX_BYTES)        { errors.push(`${f.name}: exceeds 10 MB limit`); continue }
      valid.push(f)
    }
    return { valid, errors }
  }

  function handleFiles(raw) {
    const list = Array.from(raw).slice(0, MAX_FILES)
    const { valid, errors } = validate(list)
    onFiles(valid, errors)
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload zone: drag and drop or click to select multiple JPEG or PNG images"
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) handleFiles(e.dataTransfer.files) }}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click() }}
        className={[
          'flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg px-6 py-10 cursor-pointer transition-colors duration-150',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border-default hover:border-primary/50 hover:bg-bg-elevated',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        <UploadCloud size={32} className={dragging ? 'text-primary' : 'text-text-muted'} aria-hidden="true" />
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">
            Drag & drop or click to select images
          </p>
          <p className="text-xs text-text-muted mt-1">
            JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC · up to {MAX_FILES} files · 10 MB each
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/avif,image/heic,image/heif"
        multiple
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  )
}

// ── Single queue row ──────────────────────────────────────────────────────────
function QueueRow({ item, onRemove, isRunning }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-surface">
        {/* Thumbnail */}
        <div className="w-10 h-10 rounded bg-bg-elevated shrink-0 overflow-hidden">
          {item.preview
            ? <img src={item.preview} alt="" className="w-full h-full object-cover" />
            : <FileImage size={20} className="text-text-disabled m-auto mt-2.5" />}
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{item.file.name}</p>
          <p className="text-xs text-text-muted">
            {(item.file.size / 1024 / 1024).toFixed(1)} MB
          </p>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {item.status === 'processing' && (
            <Loader2 size={14} className="animate-spin text-info" aria-hidden="true" />
          )}
          {item.status === 'done' && (
            <CheckCircle size={14} className="text-pass" aria-hidden="true" />
          )}
          {item.status === 'error' && (
            <AlertCircle size={14} className="text-fail" aria-hidden="true" />
          )}
          <StatusBadge status={item.status} />
        </div>

        {/* Metrics dots (done only) */}
        {item.status === 'done' && item.result?.metrics && (
          <MetricDots metrics={item.result.metrics} />
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {item.status === 'done' && item.result?.corrected_url && (
            <a
              href={item.result.corrected_url}
              download={`deutan_${item.file.name}`}
              className="p-1.5 rounded text-text-muted hover:text-sky-400 transition-colors"
              aria-label={`Download corrected ${item.file.name}`}
              title="Download corrected"
            >
              <Download size={15} />
            </a>
          )}
          {item.status === 'done' && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 rounded text-text-muted hover:text-text-primary transition-colors"
              aria-label={expanded ? 'Collapse details' : 'Expand details'}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          )}
          {item.status === 'pending' && !isRunning && (
            <button
              onClick={() => onRemove(item.id)}
              className="p-1.5 rounded text-text-muted hover:text-fail transition-colors"
              aria-label={`Remove ${item.file.name}`}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {item.status === 'error' && item.error && (
        <div className="px-4 py-2 bg-orange-500/5 border-t border-orange-500/20 text-xs text-orange-300">
          {item.error}
        </div>
      )}

      {/* Expanded metrics + thumbnails */}
      {expanded && item.result && (
        <>
          <div className="px-4 py-3 bg-bg-elevated border-t border-border-subtle grid grid-cols-3 gap-3">
            {[
              { label: 'ΔE Improvement',    value: item.result.metrics.delta_e_improvement?.toFixed(1),               pass: passesDeImprovement(item.result.metrics) },
              { label: 'Conflicts Resolved', value: `${(item.result.metrics.conflict_resolution_rate * 100).toFixed(0)}%`, pass: passesResolution(item.result.metrics) },
              { label: 'Naturalness (ΔE₀₀)',        value: item.result.metrics.naturalness_preservation?.toFixed(1),           pass: passesNaturalness(item.result.metrics) },
            ].map(({ label, value, pass }) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xs text-text-muted">{label}</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-sm font-medium text-text-primary">{value ?? '—'}</span>
                  <span className={`text-xs font-medium ${pass ? 'text-sky-400' : 'text-orange-400'}`}>
                    {pass ? 'Pass' : 'Fail'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 px-4 pb-3 pt-1 bg-bg-elevated border-t border-border-subtle">
            <div className="flex-1">
              <p className="text-xs text-text-muted mb-1">Original</p>
              <img src={item.result.original_url} alt="Original" className="w-full rounded object-contain max-h-32 bg-bg-base" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-text-muted mb-1">Corrected</p>
              <img src={item.result.corrected_url} alt="Corrected" className="w-full rounded object-contain max-h-32 bg-bg-base" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BulkPage() {
  const {
    queue, settings, setSettings,
    running, stopped, eta,
    addFiles, removeItem, clearAll,
    runAll, stopAll, downloadAll,
  } = useBulk()

  const pending    = queue.filter((i) => i.status === 'pending').length
  const processing = queue.filter((i) => i.status === 'processing').length
  const done       = queue.filter((i) => i.status === 'done').length
  const errored    = queue.filter((i) => i.status === 'error').length
  const totalBytes = queue.reduce((sum, i) => sum + i.file.size, 0)

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto flex flex-col gap-8">

        {/* Header */}
        <div>
          <h1
            className="font-heading font-bold text-2xl text-text-primary flex items-center gap-2"
            tabIndex={-1}
          >
            <Layers size={24} className="text-primary" aria-hidden="true" />
            Bulk Processing
          </h1>
          <div className="spectrum-line w-16 mt-1.5" aria-hidden="true" />
          <p className="text-sm text-text-muted mt-1">
            Upload up to {MAX_FILES} images (10 MB each) — processed sequentially with shared CVD settings
          </p>
        </div>

        {/* Running-in-background notice */}
        {running && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-info/10 border border-info/30 text-info text-sm">
            <Loader2 size={14} className="animate-spin shrink-0" aria-hidden="true" />
            <span>Batch processing continues even if you navigate to another tab — come back any time to check progress.</span>
          </div>
        )}

        {/* CVD controls */}
        <Card className="p-6">
          <h2 className="font-heading font-semibold text-base text-text-primary mb-4">
            Shared Settings
          </h2>
          <CVDControls values={settings} onChange={setSettings} disabled={running} />
        </Card>

        {/* Drop zone */}
        <MultiDropZone onFiles={addFiles} disabled={running} />

        {/* Queue */}
        {queue.length > 0 && (
          <div className="flex flex-col gap-4">

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-sm text-text-muted flex-wrap">
                {pending > 0    && <span>{pending} pending</span>}
                {processing > 0 && <span className="text-info">{processing} processing</span>}
                {done > 0       && <span className="text-pass">{done} done</span>}
                {errored > 0    && <span className="text-fail">{errored} failed</span>}
                <span className="text-xs text-text-disabled">{fmtBytes(totalBytes)}</span>
                {running && eta !== null && (
                  <span className="text-xs font-mono text-amber-400">{fmtEta(eta)} remaining</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {done > 0 && (
                  <Button variant="secondary" size="sm" onClick={downloadAll}>
                    <Download size={14} aria-hidden="true" />
                    Download all
                  </Button>
                )}
                {!running && queue.some((i) => i.status === 'pending') && (
                  <Button variant="secondary" size="sm" onClick={clearAll}>
                    <Trash2 size={14} aria-hidden="true" />
                    Clear all
                  </Button>
                )}
                {running ? (
                  <Button variant="danger" size="sm" onClick={stopAll}>
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={runAll}
                    disabled={!pending}
                  >
                    {stopped ? 'Resume processing' : `Process ${pending} image${pending !== 1 ? 's' : ''}`}
                  </Button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            {queue.length > 0 && (
              <div className="h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${(done / queue.length) * 100}%` }}
                  role="progressbar"
                  aria-valuenow={done}
                  aria-valuemax={queue.length}
                  aria-label={`${done} of ${queue.length} images processed`}
                />
              </div>
            )}

            {/* Queue rows */}
            <div className="flex flex-col gap-2" role="list" aria-label="Processing queue">
              {queue.map((item) => (
                <div key={item.id} role="listitem">
                  <QueueRow
                    item={item}
                    onRemove={removeItem}
                    isRunning={running}
                  />
                </div>
              ))}
            </div>

            {/* Summary when done */}
            {!running && done + errored === queue.length && queue.length > 0 && (
              <Card className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <CheckCircle size={20} className="text-pass shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      Batch complete — {done}/{queue.length} succeeded
                    </p>
                    {errored > 0 && (
                      <p className="text-xs text-orange-300">{errored} image{errored !== 1 ? 's' : ''} failed</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {done > 0 && (
                    <Button variant="primary" size="sm" onClick={downloadAll}>
                      <Download size={14} aria-hidden="true" />
                      Download all corrected
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={clearAll}>
                    Start new batch
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Empty state */}
        {queue.length === 0 && (
          <div className="text-center py-8 text-text-muted text-sm">
            Add images above to start a batch
          </div>
        )}
      </div>
    </AppShell>
  )
}
