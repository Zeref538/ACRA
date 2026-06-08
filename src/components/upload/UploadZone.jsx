import React, { useRef, useState, useCallback } from 'react'
import { UploadCloud, X, FileImage } from 'lucide-react'

const MAX_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/bmp', 'image/tiff', 'image/avif', 'image/heic', 'image/heif',
]

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function validate(file) {
  if (!ALLOWED_TYPES.includes(file.type)) return 'Unsupported file type. Use JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, or HEIC.'
  if (file.size > MAX_SIZE) return 'File size must be under 10MB'
  return null
}

export function UploadZone({ file, onFile, disabled = false, grow = false }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)

  const accept = useCallback((f) => {
    const err = validate(f)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    const url = URL.createObjectURL(f)
    setPreview(url)
    onFile(f)
  }, [onFile])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const f = e.dataTransfer.files[0]
    if (f) accept(f)
  }, [accept, disabled])

  const handleChange = useCallback((e) => {
    const f = e.target.files[0]
    if (f) accept(f)
  }, [accept])

  const handleClear = useCallback(() => {
    setPreview(null)
    setError(null)
    onFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }, [onFile])

  if (file && preview) {
    return (
      <div className={['animate-fade-in border border-border-default rounded-lg overflow-hidden bg-bg-elevated', grow ? 'flex flex-col flex-1' : ''].join(' ')}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default shrink-0">
          <FileImage size={18} className="text-primary shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
            <p className="text-xs text-text-muted">{formatBytes(file.size)}</p>
          </div>
          {!disabled && (
            <button
              onClick={handleClear}
              className="text-text-muted hover:text-text-primary transition-colors p-1"
              aria-label="Remove selected file"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className={['relative', grow ? 'flex-1' : ''].join(' ')}>
          <img
            src={preview}
            alt="Preview of selected file"
            className={['w-full object-contain bg-bg-base', grow ? 'absolute inset-0 h-full' : 'max-h-64'].join(' ')}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={grow ? 'flex flex-col flex-1' : ''}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload zone: drag and drop or click to select a JPEG or PNG image"
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click() }}
        className={[
          'relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg px-6 cursor-pointer transition-colors duration-150',
          grow ? 'flex-1 min-h-[180px]' : 'py-12',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border-default hover:border-primary/50 hover:bg-bg-elevated',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      >
        {dragging && (
          <div className="absolute inset-0 rounded-lg border-2 border-primary animate-pulse-ring pointer-events-none" aria-hidden="true" />
        )}
        <div className={dragging ? '' : 'animate-float'}>
          <UploadCloud
            size={36}
            className={dragging ? 'text-primary' : 'text-text-muted'}
            aria-hidden="true"
          />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">
            Drag & drop or click to select
          </p>
          <p className="text-xs text-text-muted mt-1">JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC — max 10MB</p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/avif,image/heic,image/heif"
        className="sr-only"
        onChange={handleChange}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
      />
      {error && (
        <p role="alert" className="text-xs text-orange-300 mt-2">
          {error}
        </p>
      )}
    </div>
  )
}
