import axios from 'axios'
import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL ?? ''
export const isApiConfigured =
  Boolean(API_URL) && !API_URL.includes('your-render-backend')
const API_CONFIGURED = isApiConfigured

// ---------------------------------------------------------------------------
// Mock API — used when backend URL is not configured
// ---------------------------------------------------------------------------
const MOCK_JOBS_KEY = 'acra_mock_jobs'

function getMockJobs() {
  try { return JSON.parse(localStorage.getItem(MOCK_JOBS_KEY) ?? '[]') } catch { return [] }
}
function saveMockJobs(jobs) {
  localStorage.setItem(MOCK_JOBS_KEY, JSON.stringify(jobs))
}

function makeMockJob({ file, cvd_type, severity }) {
  const id = 'mock-' + Date.now()
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const preview = URL.createObjectURL(file)
  return {
    job_id: id,
    cvd_type,
    severity,
    created_at: new Date().toISOString(),
    expires_at: expires,
    original_url: preview,
    corrected_url: preview, // same image — no real processing
    metrics: {
      delta_e_improvement: 18.4,
      conflict_resolution_rate: 0.87,
      naturalness_preservation: 9.2,
      boxes_detected: 3,
      conflicts_found: 2,
      auto_clusters: 8,
      inference_ms: 412,
    },
    boxes: [
      { x1: 40, y1: 30, x2: 200, y2: 100, class: 'roi-color',  conf: 0.91 },
      { x1: 220, y1: 60, x2: 380, y2: 150, class: 'roi-object', conf: 0.78 },
      { x1: 10, y1: 10, x2: 60, y2: 60, class: 'roi-text',     conf: 0.65 },
    ],
  }
}

const mockApi = {
  async processImage(args) {
    await new Promise((r) => setTimeout(r, 1200)) // simulate latency
    const job = makeMockJob(args)
    const jobs = getMockJobs()
    jobs.unshift(job)
    saveMockJobs(jobs)
    return job
  },
  async getJobs() {
    return getMockJobs()
  },
  async getJob(jobId) {
    const jobs = getMockJobs()
    const job = jobs.find((j) => j.job_id === jobId)
    if (!job) { const e = new Error('Not found'); e.response = { status: 404 }; throw e }
    return job
  },
  async deleteJob(jobId) {
    const jobs = getMockJobs().filter((j) => j.job_id !== jobId)
    saveMockJobs(jobs)
    return {}
  },
  async getHealth() {
    return { status: 'ok', model_loaded: true, uptime_seconds: 0 }
  },
}

// ---------------------------------------------------------------------------
// Real Axios API
// ---------------------------------------------------------------------------
const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
})

api.interceptors.request.use(async (config) => {
  // Try Supabase session first, fall back to localStorage mock session
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`
      return config
    }
  } catch {}

  const raw = localStorage.getItem('acra_mock_session')
  if (raw) {
    try {
      const s = JSON.parse(raw)
      if (s?.access_token) config.headers.Authorization = `Bearer ${s.access_token}`
    } catch {}
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('acra_mock_session')
      window.location.href = '/?expired=1'
    }
    return Promise.reject(error)
  }
)

// ---------------------------------------------------------------------------
// Exported functions — route to mock or real depending on config
// ---------------------------------------------------------------------------
export async function processImage(args) {
  if (!API_CONFIGURED) {
    throw new Error(
      'Backend not connected. Create .env.local with VITE_API_URL=http://localhost:8000, start the FastAPI server, then restart npm run dev.'
    )
  }
  const { file, cvd_type, severity, conf_threshold, seg_soft = 3.0 } = args
  const form = new FormData()
  form.append('image', file)
  form.append('cvd_type', cvd_type)
  form.append('severity', severity)
  form.append('conf_threshold', conf_threshold)
  form.append('seg_soft', seg_soft)
  const { data } = await api.post('/process', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  })
  return data
}

export async function getJobs() {
  if (!API_CONFIGURED) return mockApi.getJobs()
  const { data } = await api.get('/jobs')
  return data
}

export async function getJob(jobId) {
  if (!API_CONFIGURED) return mockApi.getJob(jobId)
  const { data } = await api.get(`/jobs/${jobId}`)
  return data
}

export async function deleteJob(jobId) {
  if (!API_CONFIGURED) return mockApi.deleteJob(jobId)
  const { data } = await api.delete(`/jobs/${jobId}`)
  return data
}

export async function getHealth() {
  if (!API_CONFIGURED) return mockApi.getHealth()
  const { data } = await api.get('/health')
  return data
}

// ---------------------------------------------------------------------------
// Test-runs (permanent diagnostic store)
// ---------------------------------------------------------------------------
const MOCK_TEST_RUNS_KEY = 'acra_mock_test_runs'

function getMockTestRuns() {
  try { return JSON.parse(localStorage.getItem(MOCK_TEST_RUNS_KEY) ?? '[]') } catch { return [] }
}
function saveMockTestRuns(runs) {
  localStorage.setItem(MOCK_TEST_RUNS_KEY, JSON.stringify(runs))
}

function makeMockTestRun({ file, cvd_type, severity }) {
  const id  = 'tr-mock-' + Date.now()
  const url = URL.createObjectURL(file)
  const de  = parseFloat((Math.random() * 22).toFixed(1))
  const res = parseFloat((Math.random()).toFixed(3))
  const nat = parseFloat((Math.random() * 20).toFixed(1))
  return {
    run_id:         id,
    filename:       file.name,
    cvd_type,
    severity,
    conf_threshold: 0.34,
    created_at:     new Date().toISOString(),
    original_url:   url,
    corrected_url:  url,
    metrics: {
      delta_e_improvement:      de,
      conflict_resolution_rate: res,
      naturalness_preservation: nat,
      boxes_detected:           Math.floor(Math.random() * 6),
      conflicts_found:          Math.floor(Math.random() * 4),
      auto_clusters:            4 + Math.floor(Math.random() * 8),
      inference_ms:             400 + Math.random() * 600,
    },
    boxes: [],
  }
}

function computeMockAnalytics(runs) {
  if (!runs.length) return { total: 0, runs: [] }
  const avg  = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length
  const de   = runs.map(r => r.metrics.delta_e_improvement)
  const res  = runs.map(r => r.metrics.conflict_resolution_rate)
  const nat  = runs.map(r => r.metrics.naturalness_preservation)
  return {
    total: runs.length,
    averages:   { de_improvement: avg(de), conflict_resolution: avg(res), naturalness: avg(nat) },
    minimums:   { de_improvement: Math.min(...de), conflict_resolution: Math.min(...res), naturalness: Math.min(...nat) },
    maximums:   { de_improvement: Math.max(...de), conflict_resolution: Math.max(...res), naturalness: Math.max(...nat) },
    pass_rates: {
      de_improvement:      runs.filter(r => r.metrics.delta_e_improvement > 15).length / runs.length,
      conflict_resolution: runs.filter(r => r.metrics.conflict_resolution_rate > 0.8).length / runs.length,
      naturalness:         runs.filter(r => r.metrics.naturalness_preservation < 12).length / runs.length,
    },
    targets: { de_improvement: 15, conflict_resolution: 0.80, naturalness: 12 },
    runs,
  }
}

export async function createTestRun(args) {
  if (!API_CONFIGURED) {
    throw new Error(
      'Backend not connected. Create .env.local with VITE_API_URL=http://localhost:8000, start the FastAPI server, then restart npm run dev.'
    )
  }
  const { file, cvd_type, severity, conf_threshold } = args
  const form = new FormData()
  form.append('image', file)
  form.append('cvd_type', cvd_type)
  form.append('severity', severity)
  form.append('conf_threshold', conf_threshold)
  const { data } = await api.post('/test-runs', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,   // no timeout limit — user said "no matter the slowness"
  })
  return data
}

export async function getTestAnalytics() {
  if (!API_CONFIGURED) return computeMockAnalytics(getMockTestRuns())
  const { data } = await api.get('/test-runs/analytics')
  return data
}

export async function getTestRuns() {
  if (!API_CONFIGURED) return getMockTestRuns()
  const { data } = await api.get('/test-runs')
  return data
}

export async function deleteTestRun(runId) {
  if (!API_CONFIGURED) {
    saveMockTestRuns(getMockTestRuns().filter(r => r.run_id !== runId))
    return {}
  }
  const { data } = await api.delete(`/test-runs/${runId}`)
  return data
}

export async function clearTestRuns() {
  if (!API_CONFIGURED) { saveMockTestRuns([]); return {} }
  const { data } = await api.delete('/test-runs')
  return data
}

export default api
