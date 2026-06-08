import React, { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { JobCard } from '../components/history/JobCard'
import { JobGrid } from '../components/history/JobGrid'
import { useToast } from '../components/ui/Toast'
import { getJobs, deleteJob } from '../lib/api'
import { Clock, LayoutDashboard, Trash2, CheckSquare, Square, X } from 'lucide-react'

const PAGE_SIZE = 12

function isExpired(expiresAt) {
  return new Date(expiresAt) < new Date()
}

export default function HistoryPage() {
  const toast = useToast()
  const [jobs, setJobs]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [cvdFilter, setCvdFilter]     = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortOrder, setSortOrder]     = useState('newest')
  const [page, setPage]               = useState(1)

  // Selection state
  const [selectMode, setSelectMode]   = useState(false)
  const [selected, setSelected]       = useState(new Set())
  const [deleting, setDeleting]       = useState(false)
  const [confirmAll, setConfirmAll]   = useState(false)

  useEffect(() => {
    getJobs()
      .then(setJobs)
      .catch(() => toast('Failed to load storage.', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = [...jobs]
    if (cvdFilter !== 'all') list = list.filter((j) => j.cvd_type === cvdFilter)
    if (statusFilter === 'active')  list = list.filter((j) => !isExpired(j.expires_at))
    if (statusFilter === 'expired') list = list.filter((j) => isExpired(j.expires_at))
    list.sort((a, b) => {
      const ta = new Date(a.created_at)
      const tb = new Date(b.created_at)
      return sortOrder === 'newest' ? tb - ta : ta - tb
    })
    return list
  }, [jobs, cvdFilter, statusFilter, sortOrder])

  function handleFilterChange(setter) {
    return (val) => { setter(val); setPage(1) }
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(filtered.map((j) => j.job_id)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  async function deleteSelected() {
    const ids = [...selected]
    if (!ids.length) return
    setDeleting(true)
    let failed = 0
    for (const id of ids) {
      try {
        await deleteJob(id)
        setJobs((prev) => prev.filter((j) => j.job_id !== id))
      } catch {
        failed++
      }
    }
    setSelected(new Set())
    setSelectMode(false)
    setDeleting(false)
    if (failed > 0) toast(`${failed} deletion(s) failed.`, 'error')
    else toast(`${ids.length} item${ids.length !== 1 ? 's' : ''} deleted.`, 'success')
  }

  async function deleteAll() {
    setConfirmAll(false)
    setDeleting(true)
    let failed = 0
    for (const job of jobs) {
      try {
        await deleteJob(job.job_id)
        setJobs((prev) => prev.filter((j) => j.job_id !== job.job_id))
      } catch {
        failed++
      }
    }
    setSelected(new Set())
    setSelectMode(false)
    setDeleting(false)
    if (failed > 0) toast(`${failed} deletion(s) failed.`, 'error')
    else toast('All items deleted.', 'success')
  }

  const pagedFiltered = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages    = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const allSelected   = filtered.length > 0 && filtered.every((j) => selected.has(j.job_id))

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-heading font-bold text-2xl text-text-primary" tabIndex={-1}>
              Storage
            </h1>
            <div className="spectrum-line w-16 mt-1.5" aria-hidden="true" />
            <p className="text-sm text-text-muted mt-1">Results are available for 24 hours</p>
          </div>

          {/* Toolbar buttons */}
          {!loading && jobs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {selectMode ? (
                <>
                  <button
                    onClick={allSelected ? clearSelection : selectAll}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
                  >
                    {allSelected
                      ? <CheckSquare size={15} aria-hidden="true" />
                      : <Square size={15} aria-hidden="true" />}
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={deleteSelected}
                    disabled={selected.size === 0 || deleting}
                    loading={deleting}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete {selected.size > 0 ? `(${selected.size})` : ''}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={exitSelectMode} disabled={deleting}>
                    <X size={14} aria-hidden="true" />
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setSelectMode(true)}>
                    <CheckSquare size={14} aria-hidden="true" />
                    Select
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmAll(true)}
                    disabled={deleting}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Delete all
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterGroup
            label="CVD type"
            value={cvdFilter}
            onChange={handleFilterChange(setCvdFilter)}
            options={[
              { value: 'all',    label: 'All' },
              { value: 'deutan', label: 'Deuteranomaly / Deuteranopia' },
            ]}
          />
          <FilterGroup
            label="Status"
            value={statusFilter}
            onChange={handleFilterChange(setStatusFilter)}
            options={[
              { value: 'all',     label: 'All' },
              { value: 'active',  label: 'Active' },
              { value: 'expired', label: 'Expired' },
            ]}
          />
          <FilterGroup
            label="Sort"
            value={sortOrder}
            onChange={handleFilterChange(setSortOrder)}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
            ]}
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-bg-surface border border-border-default rounded-lg h-48 animate-pulse" aria-hidden="true" />
            ))}
          </div>
        ) : filtered.length === 0 && jobs.length === 0 ? (
          <Card className="flex flex-col items-center gap-4 py-16 text-center">
            <Clock size={40} className="text-text-disabled" aria-hidden="true" />
            <p className="font-medium text-text-secondary">No analysis history</p>
            <p className="text-sm text-text-muted">Start by uploading an image on the Dashboard</p>
            <Link to="/dashboard" className="flex items-center gap-2 text-sm text-primary hover:text-primary-hover mt-2 transition-colors">
              <LayoutDashboard size={15} aria-hidden="true" />
              Go to Dashboard
            </Link>
          </Card>
        ) : filtered.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-8">No results match the current filters.</p>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pagedFiltered.map((job) => (
                <JobCard
                  key={job.job_id}
                  job={job}
                  selectable={selectMode}
                  selected={selected.has(job.job_id)}
                  onSelect={toggleSelect}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 1} aria-label="Previous page">
                  ‹
                </Button>
                <span className="text-sm text-text-muted">Page {page} of {totalPages}</span>
                <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages} aria-label="Next page">
                  ›
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm delete all */}
      <Modal open={confirmAll} onClose={() => setConfirmAll(false)} title="Delete all results?">
        <p className="text-text-secondary text-sm mb-6">
          This will permanently delete all {jobs.length} stored result{jobs.length !== 1 ? 's' : ''} and their images. This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmAll(false)}>Cancel</Button>
          <Button variant="danger" loading={deleting} onClick={deleteAll}>Delete all</Button>
        </div>
      </Modal>
    </AppShell>
  )
}

function FilterGroup({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1 bg-bg-surface border border-border-default rounded-lg p-1" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={[
            'px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150',
            value === opt.value
              ? 'bg-primary/15 text-primary border border-primary/25'
              : 'text-text-muted hover:text-text-primary',
          ].join(' ')}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
