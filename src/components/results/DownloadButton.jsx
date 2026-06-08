import React, { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../ui/Button'

export function DownloadButton({ correctedUrl, disabled = false }) {
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    if (!correctedUrl || disabled) return
    setLoading(true)
    try {
      const res = await fetch(correctedUrl)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'acra-corrected.jpg'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="primary"
      onClick={handleDownload}
      loading={loading}
      disabled={disabled || !correctedUrl}
      aria-label="Download corrected image"
    >
      <Download size={16} aria-hidden="true" />
      Download Corrected Image
    </Button>
  )
}
