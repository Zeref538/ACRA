import React, { createContext, useContext, useState, useRef } from 'react'
import { processImage } from './api'
import { useToast } from '../components/ui/Toast'

export const MAX_FILES        = 50
export const MAX_BYTES        = 10 * 1024 * 1024
export const WARN_TOTAL_BYTES = 200 * 1024 * 1024
export const ALLOWED          = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/bmp', 'image/tiff', 'image/avif', 'image/heic', 'image/heif',
]
export const DEFAULT_SETTINGS = { cvd_subtype: 'deuteranomaly', severity: 0.8 }

function fmtBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

let _idCounter = 0
function makeId() { return ++_idCounter }

const BulkContext = createContext(null)

export function BulkProvider({ children }) {
  const toast = useToast()

  // queueRef mirrors queue state so async closures always read the latest value
  const queueRef    = useRef([])
  const settingsRef = useRef(DEFAULT_SETTINGS)

  const [queue,   _setQueue]    = useState([])
  const [settings, _setSettings] = useState(DEFAULT_SETTINGS)
  const [running,  setRunning]  = useState(false)
  const [stopped,  setStopped]  = useState(false)
  const [eta,      setEta]      = useState(null)
  const stopRef    = useRef(false)
  const timingsRef = useRef([])

  function setQueue(updater) {
    _setQueue(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      queueRef.current = next
      return next
    })
  }

  function setSettings(updater) {
    _setSettings(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      settingsRef.current = next
      return next
    })
  }

  function validate(files) {
    const valid = [], errors = []
    for (const f of files) {
      if (!ALLOWED.includes(f.type)) { errors.push(`${f.name}: unsupported format`); continue }
      if (f.size > MAX_BYTES)        { errors.push(`${f.name}: exceeds 10 MB limit`); continue }
      valid.push(f)
    }
    return { valid, errors }
  }

  // Called by MultiDropZone with already-validated files + any validation error strings
  function addFiles(validFiles, errors = []) {
    if (errors.length) toast(errors[0], 'warning')

    const remaining = MAX_FILES - queueRef.current.length
    const toAdd = validFiles.slice(0, remaining).map((f) => ({
      id:      makeId(),
      file:    f,
      preview: URL.createObjectURL(f),
      status:  'pending',
      result:  null,
      error:   null,
    }))

    setQueue((q) => {
      const next = [...q, ...toAdd]
      const totalBytes = next.reduce((sum, i) => sum + i.file.size, 0)
      if (totalBytes > WARN_TOTAL_BYTES) {
        toast(`Total batch size is ${fmtBytes(totalBytes)} — uploads may take a while.`, 'warning')
      }
      return next
    })

    if (validFiles.length > remaining) {
      const extra = validFiles.length - remaining
      toast(`Maximum ${MAX_FILES} files. ${extra} file${extra !== 1 ? 's' : ''} ignored.`, 'warning')
    }
  }

  function removeItem(id) {
    setQueue((q) => q.filter((item) => item.id !== id))
  }

  function clearAll() {
    setQueue([])
    setStopped(false)
  }

  function updateItem(id, patch) {
    setQueue((q) => q.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  // Runs as a persistent async loop — survives BulkPage unmounting
  async function runAll() {
    const pending = queueRef.current.filter((i) => i.status === 'pending')
    if (!pending.length) return
    setRunning(true)
    setStopped(false)
    setEta(null)
    stopRef.current   = false
    timingsRef.current = []

    for (let idx = 0; idx < pending.length; idx++) {
      const item = pending[idx]
      if (stopRef.current) { setStopped(true); break }

      updateItem(item.id, { status: 'processing' })
      const t0 = Date.now()

      try {
        const { cvd_subtype, severity } = settingsRef.current
        const sv = cvd_subtype === 'deuteranopia' ? 1.0 : severity
        const result = await processImage({ file: item.file, cvd_type: 'deutan', severity: sv, conf_threshold: 0.30, seg_soft: 8.0 })
        updateItem(item.id, { status: 'done', result })
      } catch (err) {
        const msg = err.response?.data?.detail ?? err.message ?? 'Processing failed.'
        updateItem(item.id, { status: 'error', error: msg })
      }

      timingsRef.current.push(Date.now() - t0)
      const avgMs  = timingsRef.current.reduce((a, b) => a + b, 0) / timingsRef.current.length
      const remain = pending.length - (idx + 1)
      setEta(remain > 0 ? (avgMs * remain) / 1000 : null)
    }

    setEta(null)
    setRunning(false)
  }

  function stopAll() {
    stopRef.current = true
  }

  async function downloadAll() {
    const done = queueRef.current.filter((i) => i.status === 'done' && i.result?.corrected_url)
    for (const item of done) {
      const a = document.createElement('a')
      a.href = item.result.corrected_url
      a.download = `deutan_${item.file.name}`
      a.click()
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  return (
    <BulkContext.Provider value={{
      queue, settings, setSettings,
      running, stopped, eta,
      validate,
      addFiles, removeItem, clearAll, updateItem,
      runAll, stopAll, downloadAll,
    }}>
      {children}
    </BulkContext.Provider>
  )
}

export function useBulk() {
  const ctx = useContext(BulkContext)
  if (!ctx) throw new Error('useBulk must be used inside BulkProvider')
  return ctx
}
