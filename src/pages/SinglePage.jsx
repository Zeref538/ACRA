import React, { useState, useRef } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { UploadZone } from '../components/upload/UploadZone'
import { CVDControls } from '../components/upload/CVDControls'
import { ProcessingStatus } from '../components/upload/ProcessingStatus'
import { FourPanelView } from '../components/results/FourPanelView'
import { MetricsPanel } from '../components/results/MetricsPanel'
import { DownloadButton } from '../components/results/DownloadButton'
import { ExpiryCountdown } from '../components/ui/ExpiryCountdown'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { processImage, deleteJob } from '../lib/api'
import { ScanSearch, RotateCcw, Trash2, AlertCircle } from 'lucide-react'

const DEFAULT_SETTINGS = { cvd_subtype: 'deuteranomaly', severity: 0.8 }

export default function SinglePage() {
  const toast = useToast()

  const [file,       setFile]       = useState(null)
  const [settings,   setSettings]   = useState(DEFAULT_SETTINGS)
  const [processing, setProcessing] = useState(false)
  const [elapsed,    setElapsed]    = useState(0)
  const [error,      setError]      = useState(null)
  const [result,     setResult]     = useState(null)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting,   setDeleting]   = useState(false)

  const elapsedRef = useRef(null)

  function reset() {
    setFile(null); setResult(null); setError(null); setElapsed(0)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) return
    setProcessing(true)
    setError(null)
    setResult(null)
    setElapsed(0)
    elapsedRef.current = setInterval(() => setElapsed((p) => p + 100), 100)

    try {
      const sv = settings.cvd_subtype === 'deuteranopia' ? 1.0 : settings.severity
      const job = await processImage({ file, cvd_type: 'deutan', severity: sv, conf_threshold: 0.25, seg_soft: 3.5 })
      setResult(job)
      toast('Analysis complete.', 'success')
    } catch (err) {
      const status = err.response?.status
      let msg = 'An unexpected error occurred.'
      if (status === 400) msg = err.response?.data?.detail ?? 'Invalid input.'
      if (status === 500) msg = 'Server error. Please try again.'
      if (!status)        msg = 'Network error. Check your connection.'
      setError(msg)
    } finally {
      clearInterval(elapsedRef.current)
      setProcessing(false)
    }
  }

  async function handleDelete() {
    if (!result) return
    setDeleting(true)
    try {
      await deleteJob(result.job_id)
      toast('Results deleted.', 'success')
      reset()
    } catch {
      toast('Failed to delete.', 'error')
    } finally {
      setDeleting(false)
      setShowDelete(false)
    }
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto flex flex-col gap-8">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-heading font-bold text-2xl text-text-primary flex items-center gap-2" tabIndex={-1}>
              <ScanSearch size={24} className="text-primary" aria-hidden="true" />
              Single Image Analysis
            </h1>
            <div className="spectrum-line w-16 mt-1.5" aria-hidden="true" />
            <p className="text-sm text-text-muted mt-1">
              Process one image with CVD-optimised re-encoding
            </p>
          </div>
          {result && (
            <Button variant="secondary" size="sm" onClick={reset}>
              <RotateCcw size={14} aria-hidden="true" />
              Process another
            </Button>
          )}
        </div>

        {/* Upload panel */}
        {!result && (
          <Card className="p-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-6" aria-busy={processing}>
              <UploadZone file={file} onFile={setFile} disabled={processing} />

              {file && !processing && (
                <CVDControls values={settings} onChange={setSettings} disabled={false} />
              )}

              {processing && <ProcessingStatus elapsed={elapsed} />}

              {processing && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Analysis running — do not navigate away or the process will be interrupted.</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-300 text-sm">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <p>{error}</p>
                </div>
              )}

              {file && !processing && (
                <Button type="submit" variant="primary" fullWidth>
                  Analyze Image
                </Button>
              )}
            </form>
          </Card>
        )}

        {/* Results */}
        {result && (
          <div className="flex flex-col gap-8 animate-fade-in">

            {/* Result header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                {result?.expires_at && (
                  <ExpiryCountdown expiresAt={result.expires_at} />
                )}
                <span className="font-mono text-xs text-text-muted">
                  {settings.cvd_subtype === 'deuteranopia' ? 'Deuteranopia' : `Deuteranomaly · ${settings.severity.toFixed(2)}`}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <DownloadButton
                  correctedUrl={result?.corrected_url}
                  label="Download"
                />
                <Button variant="danger" size="sm" onClick={() => setShowDelete(true)}>
                  <Trash2 size={14} aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </div>

            {/* Four-panel image view */}
            <Card className="p-5">
              <FourPanelView
                originalUrl={result.original_url}
                correctedUrl={result.corrected_url}
                boxes={result.boxes ?? []}
                cvdLabel={settings.cvd_subtype === 'deuteranopia' ? 'Deuteranopia' : 'Deuteranomaly'}
              />
            </Card>

            {/* Metrics */}
            <div className="flex flex-col gap-4">
              <h2 className="font-heading font-semibold text-lg text-text-primary">
                Quality Metrics
              </h2>
              <MetricsPanel metrics={result?.metrics} />
            </div>

            {/* Bottom actions */}
            <div className="flex flex-wrap gap-3 pb-4">
              <DownloadButton correctedUrl={result?.corrected_url} label="Download" />
              <Button variant="secondary" onClick={reset}>
                <RotateCcw size={15} aria-hidden="true" />
                Process another image
              </Button>
              <Button variant="ghost" className="text-orange-400 hover:text-orange-300" onClick={() => setShowDelete(true)}>
                <Trash2 size={15} aria-hidden="true" />
                Delete results
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete modal */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Delete results?">
        <p className="text-text-secondary text-sm mb-6">
          This will immediately delete the result images. This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowDelete(false)}>Cancel</Button>
          <Button variant="danger" loading={deleting} onClick={handleDelete}>Delete</Button>
        </div>
      </Modal>
    </AppShell>
  )
}
