import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { ExpiryCountdown } from '../components/ui/ExpiryCountdown'
import { ImageComparison } from '../components/results/ImageComparison'
import { MetricsPanel } from '../components/results/MetricsPanel'
import { DownloadButton } from '../components/results/DownloadButton'
import { Skeleton, SkeletonText } from '../components/ui/Skeleton'
import { useToast } from '../components/ui/Toast'
import { getJob, deleteJob } from '../lib/api'
import { Trash2, AlertTriangle } from 'lucide-react'

function isExpired(expiresAt) {
  return expiresAt && new Date(expiresAt) < new Date()
}

export default function ResultsPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [expired, setExpired] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    getJob(jobId)
      .then((data) => {
        setJob(data)
        setExpired(isExpired(data.expires_at))
      })
      .catch((err) => {
        if (err.response?.status === 404) setNotFound(true)
        else toast('Failed to load job.', 'error')
      })
      .finally(() => setLoading(false))
  }, [jobId])

  // Poll for expiry while on page
  useEffect(() => {
    if (!job?.expires_at || expired) return
    const id = setInterval(() => {
      if (isExpired(job.expires_at)) setExpired(true)
    }, 5000)
    return () => clearInterval(id)
  }, [job, expired])

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteJob(jobId)
      toast('Analysis deleted.', 'success')
      navigate('/dashboard')
    } catch {
      toast('Failed to delete. Please try again.', 'error')
    } finally {
      setDeleting(false)
      setShowDeleteModal(false)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto flex flex-col gap-8" aria-busy="true">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
          </div>
        </div>
      </AppShell>
    )
  }

  if (notFound) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto mt-16 text-center">
          <Card className="p-8 flex flex-col items-center gap-4">
            <AlertTriangle size={40} className="text-orange-400" aria-hidden="true" />
            <h1 className="font-heading font-semibold text-xl text-text-primary">Result not found</h1>
            <p className="text-text-muted text-sm">This result has expired or does not exist.</p>
            <Button variant="secondary" onClick={() => navigate('/dashboard')}>
              Back to Dashboard
            </Button>
          </Card>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto flex flex-col gap-8">

        {/* Expiry banner */}
        {expired && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-sm">
            <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
            Images have expired and been deleted. Metrics are still available below.
          </div>
        )}

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-heading font-bold text-2xl text-text-primary" tabIndex={-1}>
              Analysis Results
            </h1>
            <p className="font-mono text-xs text-text-muted mt-1">{jobId}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {job?.expires_at && <ExpiryCountdown expiresAt={job.expires_at} />}
            <DownloadButton correctedUrl={job?.corrected_url} disabled={expired} />
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowDeleteModal(true)}
              aria-label="Delete this analysis"
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>

        {/* Image comparison */}
        <Card className="p-5">
          <ImageComparison
            originalUrl={job?.original_url}
            correctedUrl={job?.corrected_url}
            boxes={job?.boxes ?? []}
            expired={expired}
            cvdType={job?.cvd_type ?? 'deutan'}
          />
        </Card>

        {/* Metrics */}
        <section aria-labelledby="metrics-heading">
          <h2 id="metrics-heading" className="font-heading font-semibold text-lg text-text-primary mb-4">
            Quality Metrics
          </h2>
          <MetricsPanel metrics={job?.metrics} />
        </section>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pb-4">
          <DownloadButton correctedUrl={job?.corrected_url} disabled={expired} />
          <Button
            variant="ghost"
            onClick={() => setShowDeleteModal(true)}
            className="text-orange-400 hover:text-orange-300"
          >
            <Trash2 size={15} aria-hidden="true" />
            Delete This Result
          </Button>
        </div>
      </div>

      {/* Delete confirmation */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete analysis?"
      >
        <p className="text-text-secondary text-sm mb-6">
          This will immediately delete both images. This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={deleting} onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </Modal>
    </AppShell>
  )
}
