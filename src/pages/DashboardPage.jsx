import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { UploadZone } from '../components/upload/UploadZone'
import { CVDControls } from '../components/upload/CVDControls'
import { ProcessingStatus } from '../components/upload/ProcessingStatus'
import { FourPanelView } from '../components/results/FourPanelView'
import { MetricsPanel } from '../components/results/MetricsPanel'
import { DownloadButton } from '../components/results/DownloadButton'
import { JobCard } from '../components/history/JobCard'
import { useToast } from '../components/ui/Toast'
import { processImage, getJobs } from '../lib/api'
import {
  ImageOff, AlertCircle, TrendingUp, CheckCircle2,
  Activity, Layers, RotateCcw, ScanSearch, ArrowRight,
} from 'lucide-react'

const DEFAULT_SETTINGS = { cvd_subtype: 'deuteranomaly', severity: 0.8 }

// ── Section heading with accent bar ──────────────────────────────────────────
function SectionHeading({ title, sub }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <div className="w-0.5 h-4 rounded-full bg-primary/60 shrink-0" aria-hidden="true" />
        <h2 className="font-heading font-semibold text-base text-text-primary">{title}</h2>
      </div>
      {sub && <p className="text-sm text-text-muted mt-0.5 ml-3">{sub}</p>}
    </div>
  )
}

// ── Stat item — accent left border + big number ───────────────────────────────
function StatItem({ label, value, sub, accentColor }) {
  return (
    <div
      className="flex flex-col p-3 rounded-lg"
      style={{
        background: 'rgba(255,255,255,0.025)',
        borderLeft: `2px solid ${accentColor}`,
      }}
    >
      <span className="text-[10px] text-text-muted uppercase tracking-wide">{label}</span>
      <span className="font-heading font-bold text-2xl text-text-primary leading-tight mt-0.5">{value}</span>
      {sub && <span className="text-[10px] text-text-secondary mt-0.5">{sub}</span>}
    </div>
  )
}

// ── Stats overview panel ──────────────────────────────────────────────────────
function StatsPanel({ jobs, passRate, avgDe }) {
  if (jobs.length === 0) return null
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 rounded-full bg-primary/60 shrink-0" aria-hidden="true" />
        <h2 className="font-heading font-semibold text-sm text-text-primary">Overview</h2>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5">
        <StatItem
          label="Total Analyses"
          value={jobs.length}
          accentColor="rgba(6,148,185,0.7)"
        />
        <StatItem
          label="Pass Rate"
          value={passRate != null ? `${(passRate * 100).toFixed(0)}%` : '—'}
          sub="conflict resolution"
          accentColor="rgba(56,189,248,0.7)"
        />
        <StatItem
          label="Avg ΔE Gain"
          value={avgDe != null ? avgDe.toFixed(1) : '—'}
          sub="higher is better"
          accentColor="rgba(52,211,153,0.7)"
        />
        <StatItem
          label="Active Jobs"
          value={jobs.filter((j) => new Date(j.expires_at) > new Date()).length}
          sub="last 24 h"
          accentColor="rgba(251,191,36,0.7)"
        />
      </div>
    </Card>
  )
}

// ── Quick actions card ────────────────────────────────────────────────────────
function QuickActionsCard() {
  const actions = [
    { to: '/single', icon: ScanSearch, label: 'Single Analysis', desc: 'Analyze one image' },
    { to: '/bulk',   icon: Layers,     label: 'Bulk Processing',  desc: 'Up to 20 images'  },
  ]
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 rounded-full bg-accent/60 shrink-0" aria-hidden="true" />
        <h2 className="font-heading font-semibold text-sm text-text-primary">Quick Start</h2>
      </div>
      <div className="flex flex-col gap-2">
        {actions.map(({ to, icon: Icon, label, desc }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 hover:-translate-y-0.5 group"
            style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <span className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0 group-hover:bg-primary/20 transition-colors">
              <Icon size={14} aria-hidden="true" />
            </span>
            <span className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-text-primary transition-colors">{label}</span>
              <span className="text-[10px] text-text-muted">{desc}</span>
            </span>
            <ArrowRight size={12} className="ml-auto text-text-muted group-hover:text-text-secondary transition-colors shrink-0" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </Card>
  )
}

// ── CVD type breakdown ────────────────────────────────────────────────────────
function CVDBreakdown({ jobs }) {
  const deutan = jobs.filter((j) => j.cvd_type === 'deutan')
  if (deutan.length === 0) return null
  const anopia     = deutan.filter((j) => j.severity >= 1.0).length
  const anomaly    = deutan.length - anopia
  const anomalyPct = deutan.length ? (anomaly / deutan.length) * 100 : 0

  return (
    <Card className="p-5">
      <SectionHeading title="CVD Type Breakdown" />
      <div className="flex flex-col gap-3">
        <div className="flex h-7 rounded-lg overflow-hidden gap-px">
          {anomaly > 0 && (
            <div
              className="flex items-center justify-center text-[10px] text-white font-semibold px-2"
              style={{ width: `${anomalyPct}%`, background: 'rgba(249,115,22,0.85)' }}
              title={`Deuteranomaly: ${anomaly}`}
            >
              {anomalyPct > 18 ? anomaly : ''}
            </div>
          )}
          {anopia > 0 && (
            <div
              className="flex-1 flex items-center justify-center text-[10px] text-white font-semibold px-2"
              style={{ background: 'rgb(var(--primary))' }}
              title={`Deuteranopia: ${anopia}`}
            >
              {anopia}
            </div>
          )}
        </div>
        <div className="flex gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'rgba(249,115,22,0.85)' }} />
            Deuteranomaly — {anomaly}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
            Deuteranopia — {anopia}
          </span>
        </div>
      </div>
    </Card>
  )
}

// ── Dashboard page ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const toast = useToast()

  const [file,         setFile]         = useState(null)
  const [settings,     setSettings]     = useState(DEFAULT_SETTINGS)
  const [processing,   setProcessing]   = useState(false)
  const [elapsed,      setElapsed]      = useState(0)
  const [processError, setProcessError] = useState(null)
  const [result,       setResult]       = useState(null)

  const [jobs,        setJobs]        = useState([])
  const [jobsLoading, setJobsLoading] = useState(true)

  const elapsedRef = useRef(null)

  useEffect(() => {
    getJobs()
      .then(setJobs)
      .catch(() => {})
      .finally(() => setJobsLoading(false))
  }, [])

  function reset() {
    setFile(null); setResult(null); setProcessError(null); setElapsed(0)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) return
    setProcessing(true)
    setProcessError(null)
    setResult(null)
    setElapsed(0)
    elapsedRef.current = setInterval(() => setElapsed((p) => p + 100), 100)
    try {
      const sv  = settings.cvd_subtype === 'deuteranopia' ? 1.0 : settings.severity
      const job = await processImage({ file, cvd_type: 'deutan', severity: sv, conf_threshold: 0.30, seg_soft: 8.0 })
      setResult(job)
      getJobs().then(setJobs).catch(() => {})
    } catch (err) {
      const status = err.response?.status
      let message = 'An unexpected error occurred.'
      if (status === 400) message = err.response?.data?.detail ?? 'Invalid input. Please check your file.'
      if (status === 500) message = 'Server error. Please try again in a moment.'
      if (!status)        message = 'Network error. Check your connection and try again.'
      setProcessError(message)
    } finally {
      clearInterval(elapsedRef.current)
      setProcessing(false)
    }
  }

  const recentJobs  = jobs.slice(0, 4)
  const withMetrics = jobs.filter((j) => j.metrics)
  const passRate    = withMetrics.length
    ? withMetrics.filter((j) => j.metrics.conflict_resolution_rate > 0.8).length / withMetrics.length
    : null
  const avgDe = withMetrics.length
    ? withMetrics.reduce((s, j) => s + (j.metrics.delta_e_improvement ?? 0), 0) / withMetrics.length
    : null

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto flex flex-col gap-6">

        {/* Page header */}
        <div className="animate-slide-up stagger-1">
          <h1 className="font-heading font-bold text-2xl text-text-primary" tabIndex={-1}>
            ACRA Lab
          </h1>
          <div className="spectrum-line w-16 mt-1.5" aria-hidden="true" />
        </div>

        {/* Two-column bento — upload + right panel */}
        <div className="animate-slide-up stagger-2 grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left: Upload / Result (2/3 width) */}
          <div className="lg:col-span-2 flex flex-col">
            {!result ? (
              <Card className="p-6 flex flex-col flex-1">
                <SectionHeading
                  title="New Analysis"
                  sub="Upload an image to generate a CVD-safe re-encoding"
                />

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-5" aria-busy={processing}>
                  <UploadZone file={file} onFile={setFile} disabled={processing} grow />

                  {file && (
                    <CVDControls values={settings} onChange={setSettings} disabled={processing} />
                  )}

                  {processing && <ProcessingStatus elapsed={elapsed} />}

                  {processError && (
                    <div className="flex items-start gap-3 p-4 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-300 text-sm">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="flex-1">
                        <p>{processError}</p>
                        <button
                          type="button"
                          onClick={() => setProcessError(null)}
                          className="underline mt-1 text-orange-400 hover:text-orange-300"
                        >
                          Try again
                        </button>
                      </div>
                    </div>
                  )}

                  {file && !processing && (
                    <Button type="submit" variant="primary" fullWidth>
                      Analyze Image
                    </Button>
                  )}
                </form>
              </Card>
            ) : (
              <Card className="p-6 flex flex-col gap-5 flex-1">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <SectionHeading title="Analysis Results" />
                  <div className="flex items-center gap-2">
                    <DownloadButton correctedUrl={result?.corrected_url} label="Download" />
                    <Button variant="secondary" size="sm" onClick={reset}>
                      <RotateCcw size={14} aria-hidden="true" />
                      New analysis
                    </Button>
                  </div>
                </div>
                <FourPanelView
                  originalUrl={result.original_url}
                  correctedUrl={result.corrected_url}
                  boxes={result.boxes ?? []}
                  cvdLabel={settings.cvd_subtype === 'deuteranopia' ? 'Deuteranopia' : 'Deuteranomaly'}
                />
                
                <div className="mt-2 pt-6 border-t border-border-default">
                  <SectionHeading title="Quality Metrics" />
                  <MetricsPanel metrics={result.metrics} />
                </div>
              </Card>
            )}
          </div>

          {/* Right: Stats + Quick Actions (1/3 width) */}
          <div className="flex flex-col gap-4">
            {!jobsLoading && <StatsPanel jobs={jobs} passRate={passRate} avgDe={avgDe} />}
            <QuickActionsCard />
          </div>
        </div>

        {/* CVD Breakdown */}
        {!jobsLoading && jobs.length > 0 && (
          <div className="animate-slide-up stagger-3">
            <CVDBreakdown jobs={jobs} />
          </div>
        )}

        {/* Recent Analyses */}
        <div className="animate-slide-up stagger-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-0.5 h-4 rounded-full bg-primary/60 shrink-0" aria-hidden="true" />
                <h2 className="font-heading font-semibold text-base text-text-primary">Recent Analyses</h2>
              </div>
              <p className="text-xs text-text-muted mt-0.5 ml-3">Last 24 hours</p>
            </div>
            {jobs.length > 4 && (
              <Link to="/history" className="text-sm text-primary hover:text-primary-hover transition-colors">
                View all
              </Link>
            )}
          </div>

          {jobsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-lg h-48 animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} aria-hidden="true" />
              ))}
            </div>
          ) : recentJobs.length === 0 ? (
            <Card className="flex flex-col items-center gap-4 py-14 px-6 text-center">
              <div className="flex items-center gap-2" aria-hidden="true">
                <span className="w-4 h-4 rounded-full opacity-30" style={{ background: 'rgba(249,115,22,0.9)' }} />
                <span className="w-5 h-5 rounded-full opacity-40" style={{ background: 'rgba(6,148,185,1)' }} />
                <span className="w-4 h-4 rounded-full opacity-30" style={{ background: 'rgba(245,158,11,0.9)' }} />
              </div>
              <div>
                <p className="font-heading font-semibold text-text-primary">No analyses yet</p>
                <p className="text-sm text-text-muted mt-1">Upload an image above to get started</p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {recentJobs.map((job) => (
                <JobCard key={job.job_id} job={job} compact />
              ))}
            </div>
          )}
        </div>

      </div>
    </AppShell>
  )
}
