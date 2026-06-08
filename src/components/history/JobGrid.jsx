import React from 'react'
import { JobCard } from './JobCard'
import { Button } from '../ui/Button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const PAGE_SIZE = 12

export function JobGrid({ jobs, page, onPage }) {
  const totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE))
  const paged = jobs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {paged.map((job) => (
          <JobCard key={job.job_id} job={job} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPage(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </Button>
          <span className="text-sm text-text-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPage(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  )
}
