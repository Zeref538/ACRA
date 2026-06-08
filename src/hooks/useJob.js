import { useState, useCallback } from 'react'
import { getJob } from '../lib/api'

export function useJob() {
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchJob = useCallback(async (jobId) => {
    setLoading(true)
    setError(null)
    try {
      const data = await getJob(jobId)
      setJob(data)
      return data
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const clearJob = useCallback(() => {
    setJob(null)
    setError(null)
  }, [])

  return { job, loading, error, fetchJob, clearJob }
}
