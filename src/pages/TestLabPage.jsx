import React, { useState, useCallback, useRef, useEffect } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Skeleton } from '../components/ui/Skeleton'
import { CVDControls } from '../components/upload/CVDControls'
import { useToast } from '../components/ui/Toast'
import { createTestRun, getTestAnalytics, deleteTestRun, clearTestRuns } from '../lib/api'
import {
  FlaskConical, UploadCloud, X, CheckCircle, AlertCircle, Loader2,
  TrendingUp, TrendingDown, Minus, Trash2, RefreshCw, Download,
  ChevronDown, ChevronUp, AlertTriangle, Info,
} from 'lucide-react'

const MAX_FILES   = 50
const MAX_BYTES   = 10 * 1024 * 1024
const ALLOWED     = ['image/jpeg', 'image/png']
const DEFAULT_CVD = { cvd_subtype: 'deuteranomaly', severity: 0.5, conf_threshold: 0.34 }

// ── Diagnostic engine ─────────────────────────────────────────────────────────
function diagnose(analytics) {
  if (!analytics || analytics.total < 1) return []
  const { averages, pass_rates, targets, minimums, maximums } = analytics
  const issues = []

  // ΔE Improvement
  const dePassRate = pass_rates.de_improvement
  const deAvg      = averages.de_improvement
  const deGap      = targets.de_improvement - deAvg
  if (dePassRate < 0.5) {
    issues.push({
      severity: dePassRate < 0.2 ? 'critical' : 'high',
      metric:   'ΔE Improvement',
      value:    deAvg.toFixed(1),
      target:   `> ${targets.de_improvement}`,
      passRate: dePassRate,
      summary:  `Average improvement is ${deAvg.toFixed(1)} — ${deGap.toFixed(1)} below target`,
      cause: deAvg < 5
        ? 'Very low ΔE suggests conflicts are barely being detected. The ONNX model may not be segmenting red/green regions on your image types, so the FCM fallback is treating the whole image as one cluster pool with no meaningful conflicts.'
        : 'Conflicts are detected but lightness adjustments are too small. The re-encoding drift budget (MAX_DRIFT = 25 ΔL) or floor/ceiling constraints may be preventing colors from separating enough.',
      fix: deAvg < 5
        ? 'Check segmentation: run with use_segmentation=True and inspect whether any ROIs are detected. If YOLO finds nothing, verify the ONNX model classes match your image content. Consider lowering conf_threshold to 0.15–0.20.'
        : 'In reencoding.py, try increasing MAX_DRIFT from 25 to 35, or widen the lightness floor/ceiling (L_floor, L_ceil). Also verify CIEDE2000 threshold in conflict.py — currently conflicts require ΔE_sim < 20.',
    })
  }

  // Conflict Resolution Rate
  const resPassRate = pass_rates.conflict_resolution
  const resAvg      = averages.conflict_resolution
  if (resPassRate < 0.5) {
    issues.push({
      severity: resPassRate < 0.2 ? 'critical' : 'high',
      metric:   'Conflict Resolution Rate',
      value:    `${(resAvg * 100).toFixed(0)}%`,
      target:   '> 80%',
      passRate: resPassRate,
      summary:  `Only ${(resAvg * 100).toFixed(0)}% of conflicts resolved on average`,
      cause: resAvg < 0.3
        ? 'Less than 30% of detected conflicts are resolved. The lightness push algorithm is likely hitting its iteration limit (max 30 iterations) without reaching the ΔE_sim ≥ 20.5 threshold. Colors may be close in both L and chroma, leaving no room to separate.'
        : 'Resolution is partial. Some conflict pairs are resolved but others resist — likely neutral colors (chroma < 15) where the naturalness budget prevents large L shifts.',
      fix: 'In reencoding.py, increase max_iter from 30 to 60. For near-neutral conflicts, consider allowing larger L steps for colors with chroma < 10. Also check that WCAG target (3.0) in reencoding isn\'t fighting the ΔE target — they can conflict on mid-tone pairs.',
    })
  }

  // Naturalness Preservation (lower is better)
  const natPassRate = pass_rates.naturalness
  const natAvg      = averages.naturalness
  if (natPassRate < 0.5) {
    issues.push({
      severity: 'medium',
      metric:   'Naturalness Preservation (CIE76 Color Drift)',
      value:    natAvg.toFixed(1),
      target:   '< 12',
      passRate: natPassRate,
      summary:  `Average color drift is ${natAvg.toFixed(1)} ΔE — above the 12 limit`,
      cause: 'The re-encoding is shifting colors too far from the original. This often happens when the conflict list is large and many centers need large L adjustments, each pulling the reconstructed pixels further from their original color.',
      fix: 'Lower MAX_DRIFT in reencoding.py (try 18–20). Also check naturalness_preservation in metrics.py — it deduplicates near-identical clusters (ΔE < 1) before computing drift. If many near-duplicate clusters exist, the effective drift appears higher. Try reducing FCM n_clusters or enabling auto-cluster estimation.',
    })
  }

  // Good news if most pass
  if (issues.length === 0) {
    issues.push({
      severity: 'ok',
      metric:   'All metrics',
      summary:  'Framework is performing well across tested images',
      cause:    'All three metrics pass at > 50% rate.',
      fix:      'Continue testing with more diverse image types to stress the framework.',
    })
  }

  return issues
}

// ── Severity colour ───────────────────────────────────────────────────────────
const SEVERITY_STYLE = {
  critical: 'border-l-4 border-orange-500 bg-orange-500/5',
  high:     'border-l-4 border-amber-500 bg-amber-500/5',
  medium:   'border-l-4 border-indigo-400 bg-indigo-400/5',
  ok:       'border-l-4 border-sky-500 bg-sky-500/5',
}
const SEVERITY_ICON = {
  critical: <AlertCircle size={16} className="text-orange-400 shrink-0 mt-0.5" />,
  high:     <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />,
  medium:   <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />,
  ok:       <CheckCircle size={16} className="text-sky-400 shrink-0 mt-0.5" />,
}

// ── Metric bar card ───────────────────────────────────────────────────────────
function MetricBar({ label, passRate, avg, min, max, target, targetLabel, lowerBetter = false }) {
  const pct    = Math.round(passRate * 100)
  const passing = pct >= 50
  const barW   = `${pct}%`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        <Badge variant={passing ? 'pass' : 'fail'} size="sm">{pct}% pass</Badge>
      </div>

      {/* Pass-rate bar */}
      <div className="h-2 bg-bg-elevated rounded-full overflow-hidden" aria-label={`${pct}% pass rate`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${passing ? 'bg-sky-500' : 'bg-orange-500'}`}
          style={{ width: barW }}
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span className="font-mono">avg {lowerBetter
          ? avg?.toFixed(1)
          : typeof avg === 'number' && avg < 1 ? `${(avg * 100).toFixed(0)}%` : avg?.toFixed(1)
        }</span>
        <span className="text-text-disabled">
          {lowerBetter
            ? `target < ${targetLabel}`
            : `target ${typeof target === 'number' && target < 1 ? `> ${(target * 100).toFixed(0)}%` : `> ${target}`}`
          }
        </span>
        <span className="font-mono text-text-disabled">
          {lowerBetter
            ? `${min?.toFixed(1)} – ${max?.toFixed(1)}`
            : typeof min === 'number' && min < 1
              ? `${(min * 100).toFixed(0)}% – ${(max * 100).toFixed(0)}%`
              : `${min?.toFixed(1)} – ${max?.toFixed(1)}`
          }
        </span>
      </div>
    </div>
  )
}

// ── Queue file status badge ───────────────────────────────────────────────────
function QueueStatus({ status }) {
  const map = { pending: 'neutral', processing: 'info', done: 'pass', error: 'fail' }
  const lab = { pending: 'Pending', processing: 'Processing', done: 'Done', error: 'Error' }
  return <Badge variant={map[status]} size="sm">{lab[status]}</Badge>
}

// ── Per-run table row ─────────────────────────────────────────────────────────
function RunRow({ run, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const m = run.metrics
  const passes = [
    m.delta_e_improvement > 15,
    m.conflict_resolution_rate > 0.8,
    m.naturalness_preservation < 12,
  ]
  const passCount = passes.filter(Boolean).length

  return (
    <>
      <tr className="border-b border-border-subtle hover:bg-bg-elevated transition-colors">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <img
              src={run.corrected_url}
              alt=""
              className="w-8 h-8 object-cover rounded bg-bg-elevated shrink-0"
            />
            <span className="text-xs text-text-primary truncate max-w-[120px]" title={run.filename}>
              {run.filename}
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <Badge variant="deutan" size="sm">
            {run.severity >= 1.0 ? 'Deuteranopia' : 'Deuteranomaly'}
          </Badge>
        </td>
        <td className="px-3 py-2.5 font-mono text-xs text-text-primary text-right">
          <span className={m.delta_e_improvement > 15 ? 'text-sky-400' : 'text-orange-400'}>
            {m.delta_e_improvement?.toFixed(1)}
          </span>
        </td>
        <td className="px-3 py-2.5 font-mono text-xs text-text-primary text-right">
          <span className={m.conflict_resolution_rate > 0.8 ? 'text-sky-400' : 'text-orange-400'}>
            {(m.conflict_resolution_rate * 100)?.toFixed(0)}%
          </span>
        </td>
        <td className="px-3 py-2.5 font-mono text-xs text-text-primary text-right">
          <span className={m.naturalness_preservation < 12 ? 'text-sky-400' : 'text-orange-400'}>
            {m.naturalness_preservation?.toFixed(1)}
          </span>
        </td>
        <td className="px-3 py-2.5 text-center">
          <span className={`font-mono text-xs font-bold ${passCount === 3 ? 'text-sky-400' : passCount === 0 ? 'text-orange-400' : 'text-amber-400'}`}>
            {passCount}/3
          </span>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            <button
              onClick={() => onDelete(run.run_id)}
              className="p-1 rounded text-text-muted hover:text-fail transition-colors"
              aria-label="Delete run"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-bg-elevated border-b border-border-subtle">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex gap-4">
              <div className="flex gap-3">
                <div>
                  <p className="text-xs text-text-muted mb-1">Original</p>
                  <img src={run.original_url} alt="Original" className="h-24 rounded object-contain bg-bg-base" />
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-1">Corrected</p>
                  <img src={run.corrected_url} alt="Corrected" className="h-24 rounded object-contain bg-bg-base" />
                </div>
              </div>
              <div className="flex flex-col gap-1 text-xs text-text-muted">
                <span>Severity: <span className="font-mono text-text-primary">{run.severity?.toFixed(2)}</span></span>
                <span>Conf: <span className="font-mono text-text-primary">{run.conf_threshold?.toFixed(2)}</span></span>
                <span>Conflicts found: <span className="font-mono text-text-primary">{m.conflicts_found ?? 0}</span></span>
                <span>Regions detected: <span className="font-mono text-text-primary">{m.boxes_detected ?? 0}</span></span>
                <span>Inference: <span className="font-mono text-text-primary">{m.inference_ms?.toFixed(0)} ms</span></span>
                <span>Tested: <span className="text-text-secondary">{new Date(run.created_at).toLocaleString()}</span></span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
let _qid = 0

export default function TestLabPage() {
  const toast = useToast()

  // Queue
  const [queue, setQueue]     = useState([])
  const [cvd, setCvd]         = useState(DEFAULT_CVD)
  const [running, setRunning] = useState(false)
  const stopRef               = useRef(false)

  // Analytics
  const [analytics, setAnalytics]   = useState(null)
  const [analyticsLoading, setAL]   = useState(true)
  const [clearing, setClearing]     = useState(false)
  const [activeTab, setActiveTab]   = useState('queue') // 'queue' | 'analytics' | 'data'

  useEffect(() => {
    loadAnalytics()
  }, [])

  async function loadAnalytics() {
    setAL(true)
    try { setAnalytics(await getTestAnalytics()) } catch {}
    setAL(false)
  }

  function addFiles(rawFiles) {
    const files = Array.from(rawFiles)
    const remaining = MAX_FILES - queue.length
    const toAdd = [], errors = []

    for (const f of files.slice(0, remaining)) {
      if (!ALLOWED.includes(f.type)) { errors.push(`${f.name}: not JPEG/PNG`); continue }
      if (f.size > MAX_BYTES)        { errors.push(`${f.name}: over 10 MB`); continue }
      toAdd.push({ id: ++_qid, file: f, preview: URL.createObjectURL(f), status: 'pending', error: null })
    }
    if (errors.length) toast(errors[0], 'warning')
    if (files.length > remaining) toast(`Max ${MAX_FILES} files. Some ignored.`, 'warning')
    setQueue(q => [...q, ...toAdd])
  }

  function updateItem(id, patch) {
    setQueue(q => q.map(i => i.id === id ? { ...i, ...patch } : i))
  }

  async function runAll() {
    const pending = queue.filter(i => i.status === 'pending')
    if (!pending.length) return
    setRunning(true)
    stopRef.current = false

    for (const item of pending) {
      if (stopRef.current) break
      updateItem(item.id, { status: 'processing' })
      try {
        const result = await createTestRun({
          file:           item.file,
          cvd_type:       'deutan',
          severity:       cvd.cvd_subtype === 'deuteranopia' ? 1.0 : cvd.severity,
          conf_threshold: cvd.conf_threshold,
        })
        updateItem(item.id, { status: 'done', metrics: result.metrics })
      } catch (err) {
        const msg = err.response?.data?.detail ?? err.message ?? 'Failed'
        updateItem(item.id, { status: 'error', error: msg })
      }
    }

    setRunning(false)
    await loadAnalytics()  // refresh analytics after batch
  }

  async function handleClearAll() {
    setClearing(true)
    try {
      await clearTestRuns()
      setAnalytics(await getTestAnalytics())
      toast('All test data cleared.', 'success')
    } catch {
      toast('Failed to clear data.', 'error')
    } finally {
      setClearing(false)
    }
  }

  async function handleDeleteRun(runId) {
    try {
      await deleteTestRun(runId)
      setAnalytics(prev => {
        if (!prev) return prev
        const runs = prev.runs?.filter(r => r.run_id !== runId) ?? []
        return runs.length ? { ...prev, runs, total: runs.length } : { total: 0, runs: [] }
      })
    } catch {
      toast('Failed to delete run.', 'error')
    }
  }

  function exportCSV() {
    const runs = analytics?.runs ?? []
    if (!runs.length) return
    const header = 'filename,cvd_type,severity,conf_threshold,de_improvement,conflict_resolution_rate,naturalness_preservation,conflicts_found,boxes_detected,inference_ms,pass_de,pass_resolution,pass_naturalness,created_at'
    const rows = runs.map(r => {
      const m = r.metrics
      return [
        r.filename, r.cvd_type, r.severity, r.conf_threshold,
        m.delta_e_improvement, m.conflict_resolution_rate,
        m.naturalness_preservation,
        m.conflicts_found ?? 0, m.boxes_detected ?? 0, m.inference_ms ?? 0,
        m.delta_e_improvement > 15 ? 1 : 0,
        m.conflict_resolution_rate > 0.8 ? 1 : 0,
        m.naturalness_preservation < 12 ? 1 : 0,
        r.created_at,
      ].join(',')
    })
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `acra_test_results_${Date.now()}.csv`; a.click()
  }

  const issues   = diagnose(analytics)
  const done     = queue.filter(i => i.status === 'done').length
  const pending  = queue.filter(i => i.status === 'pending').length
  const errored  = queue.filter(i => i.status === 'error').length
  const total    = analytics?.total ?? 0

  const TAB = (id, label) => (
    <button
      onClick={() => setActiveTab(id)}
      className={[
        'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
        activeTab === id
          ? 'bg-primary/10 text-primary border border-primary/20'
          : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
      ].join(' ')}
      aria-pressed={activeTab === id}
    >
      {label}
    </button>
  )

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto flex flex-col gap-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1
              className="font-heading font-bold text-2xl text-text-primary flex items-center gap-2"
              tabIndex={-1}
            >
              <FlaskConical size={24} className="text-primary" aria-hidden="true" />
              Test Lab
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Run images through the framework in bulk — results stored permanently for diagnostic analysis
            </p>
          </div>
          <div className="flex items-center gap-2">
            {total > 0 && (
              <>
                <Button variant="secondary" size="sm" onClick={exportCSV}>
                  <Download size={14} aria-hidden="true" />
                  Export CSV
                </Button>
                <Button variant="danger" size="sm" loading={clearing} onClick={handleClearAll}>
                  <Trash2 size={14} aria-hidden="true" />
                  Clear all data
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Images tested', value: total },
            { label: 'ΔE pass rate',  value: total ? `${(analytics.pass_rates.de_improvement * 100).toFixed(0)}%` : '—', danger: analytics && analytics.pass_rates.de_improvement < 0.5 },
            { label: 'Conflict res.', value: total ? `${(analytics.pass_rates.conflict_resolution * 100).toFixed(0)}%` : '—', danger: analytics && analytics.pass_rates.conflict_resolution < 0.5 },
            { label: 'CIE76 Naturalness',   value: total ? `${(analytics.pass_rates.naturalness * 100).toFixed(0)}%` : '—', danger: analytics && analytics.pass_rates.naturalness < 0.5 },
          ].map(({ label, value, danger }) => (
            <Card key={label} className="p-4">
              <p className="text-xs text-text-muted">{label}</p>
              <p className={`font-mono text-2xl font-semibold mt-1 ${danger ? 'text-orange-400' : 'text-text-primary'}`}>
                {analyticsLoading ? <Skeleton className="h-7 w-16 mt-1" /> : value}
              </p>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap" role="tablist">
          {TAB('queue',     `Queue (${queue.length})`)}
          {TAB('analytics', 'Analytics & Diagnosis')}
          {TAB('data',      `All Runs (${total})`)}
        </div>

        {/* ── TAB: Queue ──────────────────────────────────────────────────── */}
        {activeTab === 'queue' && (
          <div className="flex flex-col gap-5">
            <Card className="p-5">
              <h2 className="font-heading font-semibold text-base text-text-primary mb-4">
                Shared Settings
              </h2>
              <CVDControls values={cvd} onChange={setCvd} disabled={running} />
            </Card>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); if (!running) addFiles(e.dataTransfer.files) }}
              onClick={() => !running && document.getElementById('tl-file-input').click()}
              className={[
                'flex flex-col items-center gap-3 border-2 border-dashed rounded-lg px-6 py-10 cursor-pointer transition-colors',
                running ? 'opacity-50 cursor-not-allowed border-border-default'
                        : 'border-border-default hover:border-primary/50 hover:bg-bg-elevated',
              ].join(' ')}
              role="button"
              tabIndex={running ? -1 : 0}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !running) document.getElementById('tl-file-input').click() }}
              aria-label="Add images to test queue"
            >
              <UploadCloud size={32} className="text-text-muted" aria-hidden="true" />
              <div className="text-center">
                <p className="text-sm font-medium text-text-primary">
                  Add images to the test queue
                </p>
                <p className="text-xs text-text-muted mt-1">
                  JPEG, PNG — up to {MAX_FILES} files, no time limit
                </p>
              </div>
            </div>
            <input
              id="tl-file-input"
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="sr-only"
              onChange={e => addFiles(e.target.files)}
              disabled={running}
            />

            {/* Queue controls */}
            {queue.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-sm text-text-muted flex-wrap">
                    {pending > 0  && <span>{pending} pending</span>}
                    {running      && <span className="text-info">processing…</span>}
                    {done > 0     && <span className="text-pass">{done} saved</span>}
                    {errored > 0  && <span className="text-fail">{errored} failed</span>}
                  </div>
                  <div className="flex gap-2">
                    {!running && (
                      <Button variant="ghost" size="sm" onClick={() => setQueue([])}>
                        <X size={14} /> Clear queue
                      </Button>
                    )}
                    {running ? (
                      <Button variant="danger" size="sm" onClick={() => { stopRef.current = true }}>
                        Stop after current
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={runAll}
                        disabled={!pending || !cvd.cvd_type}
                      >
                        Run {pending} image{pending !== 1 ? 's' : ''}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Progress */}
                <div
                  className="h-1.5 bg-bg-elevated rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={done}
                  aria-valuemax={queue.length}
                >
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${(done / queue.length) * 100}%` }}
                  />
                </div>

                {/* File list */}
                <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto pr-1">
                  {queue.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-3 py-2.5 bg-bg-surface border border-border-default rounded-lg"
                    >
                      <img src={item.preview} alt="" className="w-8 h-8 object-cover rounded shrink-0" />
                      <span className="flex-1 text-xs text-text-primary truncate">{item.file.name}</span>
                      {item.status === 'processing' && <Loader2 size={14} className="animate-spin text-info shrink-0" />}
                      {item.status === 'done'       && <CheckCircle size={14} className="text-pass shrink-0" />}
                      {item.status === 'error'      && <AlertCircle size={14} className="text-fail shrink-0" />}
                      {item.status === 'done' && item.metrics && (
                        <div className="flex gap-3 text-[11px] font-mono mr-1">
                          <span className={item.metrics.delta_e_improvement > 15 ? 'text-sky-400' : 'text-orange-400'} title="ΔE Improvement (target > 15)">
                            ΔE:{item.metrics.delta_e_improvement?.toFixed(1)}
                          </span>
                          <span className={item.metrics.conflict_resolution_rate > 0.8 ? 'text-sky-400' : 'text-orange-400'} title="Resolution Rate (target > 80%)">
                            Res:{(item.metrics.conflict_resolution_rate * 100)?.toFixed(0)}%
                          </span>
                          <span className={item.metrics.naturalness_preservation < 12 ? 'text-sky-400' : 'text-orange-400'} title="Naturalness Preservation (target < 12)">
                            Drift:{item.metrics.naturalness_preservation?.toFixed(1)}
                          </span>
                        </div>
                      )}
                      <QueueStatus status={item.status} />
                      {item.status === 'pending' && !running && (
                        <button
                          onClick={() => setQueue(q => q.filter(i => i.id !== item.id))}
                          className="text-text-muted hover:text-fail transition-colors"
                          aria-label="Remove"
                        >
                          <X size={13} />
                        </button>
                      )}
                      {item.error && (
                        <span className="text-xs text-orange-300 truncate max-w-[120px]" title={item.error}>{item.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAB: Analytics & Diagnosis ─────────────────────────────────── */}
        {activeTab === 'analytics' && (
          <div className="flex flex-col gap-6">
            {analyticsLoading ? (
              <div className="flex flex-col gap-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : !analytics || analytics.total === 0 ? (
              <Card className="flex flex-col items-center gap-3 py-16 text-center">
                <FlaskConical size={40} className="text-text-disabled" />
                <p className="font-medium text-text-secondary">No test data yet</p>
                <p className="text-sm text-text-muted">Run images from the Queue tab to populate diagnostics</p>
              </Card>
            ) : (
              <>
                {/* Metric bars */}
                <Card className="p-5 flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <h2 className="font-heading font-semibold text-base text-text-primary">
                      Metric Pass Rates — {analytics.total} images
                    </h2>
                    <button
                      onClick={loadAnalytics}
                      className="text-text-muted hover:text-text-primary transition-colors"
                      aria-label="Refresh analytics"
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                  <MetricBar
                    label="ΔE Improvement (target > 15)"
                    passRate={analytics.pass_rates.de_improvement}
                    avg={analytics.averages.de_improvement}
                    min={analytics.minimums.de_improvement}
                    max={analytics.maximums.de_improvement}
                    target={15}
                    targetLabel="15"
                  />
                  <MetricBar
                    label="Conflict Resolution Rate (target > 80%)"
                    passRate={analytics.pass_rates.conflict_resolution}
                    avg={analytics.averages.conflict_resolution}
                    min={analytics.minimums.conflict_resolution}
                    max={analytics.maximums.conflict_resolution}
                    target={0.8}
                    targetLabel="80%"
                  />
                  <MetricBar
                    label="CIE76 Color Drift / Naturalness (target < 12)"
                    passRate={analytics.pass_rates.naturalness}
                    avg={analytics.averages.naturalness}
                    min={analytics.minimums.naturalness}
                    max={analytics.maximums.naturalness}
                    target={12}
                    targetLabel="12"
                    lowerBetter
                  />
                </Card>

                {/* Diagnostic cards */}
                <div className="flex flex-col gap-1">
                  <h2 className="font-heading font-semibold text-base text-text-primary mb-2">
                    Diagnosis
                  </h2>
                  {issues.map((issue, i) => (
                    <details key={i} className={`rounded-lg p-4 ${SEVERITY_STYLE[issue.severity] ?? ''}`}>
                      <summary className="flex items-start gap-2 cursor-pointer list-none">
                        {SEVERITY_ICON[issue.severity]}
                        <div className="flex-1">
                          <p className="text-sm font-medium text-text-primary">
                            {issue.metric}
                            {issue.value && (
                              <span className="font-mono text-text-muted ml-2 text-xs">
                                avg {issue.value} — target {issue.target}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-text-secondary mt-0.5">{issue.summary}</p>
                        </div>
                        {issue.severity !== 'ok' && (
                          <ChevronDown size={14} className="text-text-muted mt-0.5 shrink-0" />
                        )}
                      </summary>
                      {issue.cause && (
                        <div className="mt-3 pl-6 flex flex-col gap-2 border-t border-border-subtle pt-3">
                          <div>
                            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Likely cause</p>
                            <p className="text-sm text-text-secondary leading-relaxed">{issue.cause}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">What to try</p>
                            <p className="text-sm text-text-secondary leading-relaxed">{issue.fix}</p>
                          </div>
                        </div>
                      )}
                    </details>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAB: All runs table ─────────────────────────────────────────── */}
        {activeTab === 'data' && (
          <div className="flex flex-col gap-4">
            {!analytics?.runs?.length ? (
              <Card className="flex flex-col items-center gap-3 py-16 text-center">
                <FlaskConical size={40} className="text-text-disabled" />
                <p className="font-medium text-text-secondary">No test runs recorded yet</p>
              </Card>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border-default">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default bg-bg-surface">
                      {['Image', 'CVD', 'ΔE Impr', 'Res%', 'Drift', 'Score', ''].map(h => (
                        <th key={h} scope="col" className="px-3 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.runs.map(run => (
                      <RunRow key={run.run_id} run={run} onDelete={handleDeleteRun} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
